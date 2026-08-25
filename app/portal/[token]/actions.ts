"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { getStudentByPortalToken } from "@/lib/data/crm";
import { logActivity } from "@/lib/data/activity";
import { createWorkItem } from "@/lib/data/work";
import { kstToday } from "@/components/portal/format";

// 포털 서버 액션 — 과제 제출·철회·질의응답 (H-02·H-04, docs/flow-canon/01_atlas_03_learning.md).
//
// 인증: 관리자 세션이 아니라 포털 토큰이다. 모든 액션이 token을 받아
// getStudentByPortalToken으로 학생·테넌트를 해석하고 그 스코프로만 동작한다.
// 타 학생의 과제·제출·질문은 존재 자체를 노출하지 않으므로(H-04·H-06)
// 토큰 불일치·소유 불일치·비노출 상태는 전부 같은 일반 오류(ACCESS_ERROR)로 수렴한다.
//
// 정본 규칙:
//  - 재제출은 append-only(검수 27): attempt_no를 올린 새 행. 이전 제출은 그대로 보존
//    (원문 불변·직접 삭제 거부는 00015 트리거가 DB에서 강제).
//  - 마감 후 제출은 차단하지 않는다(H-02): late=true로 지연 사실과 실제 시각을 연결.
//  - 제출 완료는 운영자 검토 업무(work_items homework_submitted)로 수렴 — H-02 주 전환의 종점.
//  - 질문은 원 기록(과제 또는 리포트)과 연결되어야 접수된다(검수 29) → question_asked 업무.
//  - 검토 전(review_status=pending) 최신 제출만 철회 가능(H-02). 검토 후 정정은 운영자 흐름 —
//    검토 진행 여부는 포털에 비노출이므로 오류 문구도 이를 드러내지 않는다.
//  - 파일: materials 액션과 동일한 10MB·확장자·MIME 검증, 비공개 homework 버킷,
//    tenant/student/assignment 계층 경로, 열람은 요청 시 1시간 만료 서명 URL(자기 제출만).
//  - 연속 제출·질문 폭주는 간단한 시간 간격 가드로 막는다(과설계 금지).
// AI 호출 없음 — 검토·피드백·답변은 전부 사람이 한다.

const DB_ERROR = "일시적으로 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.";
const ACCESS_ERROR = "접근할 수 없습니다.";

const HOMEWORK_BUCKET = "homework"; // scripts/setup-supabase.sh가 비공개로 생성
const SIGNED_URL_TTL_S = 60 * 60; // 서명 URL 1시간 만료
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB — materials 액션과 동일
const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "webp"];
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];
const RATE_INTERVAL_MS = 30 * 1000; // 같은 토큰 연속 제출·질문 최소 간격
const MAX_CONTENT_LENGTH = 20000;
const MAX_QUESTION_LENGTH = 2000;

export interface PortalActionResult {
  ok: boolean;
  error?: string;
  /**
   * 파일 업로드만 실패하고 텍스트는 유효한 상태 — 클라이언트가
   * "텍스트만 먼저 제출" 선택지를 안내한다(부분 실패 시 성공분 유지 — 검수 26 정신).
   */
  fileFailed?: boolean;
}

export type PortalFileUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

function fileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : "";
}

/* ---------- 과제 제출 (H-02) ---------- */

export async function submitHomework(
  formData: FormData,
): Promise<PortalActionResult> {
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const token = String(formData.get("token") ?? "").trim();
  const assignmentId = String(formData.get("assignmentId") ?? "").trim();
  const student = token ? await getStudentByPortalToken(token) : null;
  if (!student || !assignmentId) return { ok: false, error: ACCESS_ERROR };

  const content = String(formData.get("content") ?? "").trim();
  if (content.length > MAX_CONTENT_LENGTH) {
    return { ok: false, error: "제출 내용이 너무 깁니다. 2만 자 이내로 줄여 주세요." };
  }
  // skipFile=1: 파일 업로드 실패 후 "텍스트만 제출"을 선택한 재시도 — 파일을 무시한다.
  const skipFile = String(formData.get("skipFile") ?? "") === "1";
  const fileRaw = formData.get("file");
  const file =
    !skipFile && fileRaw instanceof File && fileRaw.size > 0 ? fileRaw : null;
  if (!content && !file) {
    return { ok: false, error: "제출 내용을 입력하거나 파일을 첨부해 주세요." };
  }

  const db = createServiceClient()!;

  // 본인 과제인지 확인 — 타 학생 과제·초안(draft)·취소본(canceled)은 존재 자체 비노출(H-01·H-04·H-07).
  const { data: assignmentRow } = await db
    .from("homework_assignments")
    .select("id, title, due_date, status")
    .eq("tenant_id", student.tenantId)
    .eq("student_id", student.id)
    .eq("id", assignmentId)
    .maybeSingle();
  const assignment = assignmentRow as {
    id: string;
    title: string;
    due_date: string | null;
    status: string;
  } | null;
  if (!assignment || assignment.status === "draft" || assignment.status === "canceled") {
    return { ok: false, error: ACCESS_ERROR };
  }
  if (assignment.status === "closed") {
    // 전체 종료된 과제는 새 제출 중단(H-07). 기한 경과와는 다르다 — 기한은 차단 사유가 아니다(H-02).
    return { ok: false, error: "종료된 과제에는 새로 제출할 수 없습니다. 선생님께 문의해 주세요." };
  }

  // 최신 제출 1건 — 연속 제출 폭주 가드 + 다음 회차(attempt_no) 산정에 함께 쓴다.
  const { data: lastRows } = await db
    .from("homework_submissions")
    .select("attempt_no, submitted_at")
    .eq("tenant_id", student.tenantId)
    .eq("assignment_id", assignment.id)
    .order("attempt_no", { ascending: false })
    .limit(1);
  const last = (lastRows ?? [])[0] as
    | { attempt_no: number; submitted_at: string }
    | undefined;
  if (last && Date.now() - new Date(last.submitted_at).getTime() < RATE_INTERVAL_MS) {
    return { ok: false, error: "제출 간격이 너무 짧습니다. 잠시 후 다시 시도해 주세요." };
  }

  // 파일 검증·업로드 — materials 액션과 동일한 검증 목록, 비공개 homework 버킷,
  // 경로는 tenant/student/assignment 계층 + 랜덤 UUID(원본 파일명은 file_name 컬럼에 보존).
  let filePath: string | null = null;
  let fileName: string | null = null;
  if (file) {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return { ok: false, error: "파일 크기는 10MB 이하여야 합니다." };
    }
    const extension = fileExtension(file.name);
    const mimeOk =
      typeof file.type !== "string" ||
      file.type === "" ||
      ALLOWED_MIME_TYPES.includes(file.type);
    if (!ALLOWED_EXTENSIONS.includes(extension) || !mimeOk) {
      return { ok: false, error: "pdf, jpg, png, webp 파일만 업로드할 수 있습니다." };
    }
    const objectPath = `${student.tenantId}/${student.id}/${assignment.id}/${randomUUID()}.${extension}`;
    const { error: uploadError } = await db.storage
      .from(HOMEWORK_BUCKET)
      .upload(objectPath, file, { contentType: file.type || undefined });
    if (uploadError) {
      console.error("[portal/homework] storage upload failed", uploadError);
      if (content) {
        // 부분 실패 — 살릴 수 있는 텍스트는 제출할지 선택 안내(검수 26 정신). 자동 제출하지 않는다.
        return {
          ok: false,
          fileFailed: true,
          error:
            "파일 업로드에 실패했습니다. 텍스트만 먼저 제출하고, 파일은 나중에 다시 제출할 수 있어요.",
        };
      }
      return { ok: false, error: "파일 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요." };
    }
    filePath = objectPath;
    fileName = file.name;
  }

  // 마감 후 제출은 차단하지 않고 지연 사실만 연결한다(H-02). 실제 시각은 submitted_at(DB default).
  const late = Boolean(assignment.due_date && kstToday() > assignment.due_date);

  // 재제출은 append-only(검수 27): attempt_no+1 새 행. 동시 제출로 회차가 겹치면(23505) 한 번 재산정.
  let attemptNo = (last?.attempt_no ?? 0) + 1;
  let inserted = false;
  for (let retry = 0; retry < 2 && !inserted; retry++) {
    const { error: insertError } = await db.from("homework_submissions").insert({
      tenant_id: student.tenantId,
      assignment_id: assignment.id,
      attempt_no: attemptNo,
      content,
      file_path: filePath,
      file_name: fileName,
      late,
    });
    if (!insertError) {
      inserted = true;
      break;
    }
    if (insertError.code === "23505") {
      const { data: again } = await db
        .from("homework_submissions")
        .select("attempt_no")
        .eq("tenant_id", student.tenantId)
        .eq("assignment_id", assignment.id)
        .order("attempt_no", { ascending: false })
        .limit(1);
      const latest = (again ?? [])[0] as { attempt_no: number } | undefined;
      attemptNo = (latest?.attempt_no ?? attemptNo) + 1;
      continue;
    }
    console.error("[portal/homework] submission insert failed", insertError);
    break;
  }
  if (!inserted) {
    // 업로드만 성공한 파일은 회수(고아 방지) — 회수 실패는 로그만.
    if (filePath) {
      const { error: removeError } = await db.storage
        .from(HOMEWORK_BUCKET)
        .remove([filePath]);
      if (removeError) {
        console.error("[portal/homework] orphan file cleanup failed", removeError);
      }
    }
    return { ok: false, error: "제출 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." };
  }

  // H-02 주 전환의 종점 — 운영자 검토 업무로 수렴. 재제출이면 기존 열린 업무에 합류(한 사건 한 업무 —
  // 최신 제출본이 검토 대상이므로 새 업무를 만들지 않아도 된다).
  await createWorkItem(student.tenantId, {
    kind: "homework_submitted",
    title: `과제 제출 검토: ${student.name} — ${assignment.title}`,
    sourceType: "homework_assignment",
    sourceId: assignment.id,
    nextAction: "최신 제출본 검토 후 피드백 작성·승인",
    detail: late
      ? `${attemptNo}회차 · 기한(${assignment.due_date}) 경과 후 제출`
      : `${attemptNo}회차 제출`,
    priority: "normal",
  });
  await logActivity(
    student.tenantId,
    `portal:${student.id}`,
    "create",
    "homework_submission",
    assignment.id,
    `과제 제출 ${attemptNo}회차: ${assignment.title}${late ? " (기한 경과)" : ""}`,
  );

  revalidatePath(`/portal/${token}`);
  return { ok: true };
}

/* ---------- 제출 철회 (H-02 — 검토 전, 최신 제출본만) ---------- */

export async function withdrawSubmission(
  token: string,
  submissionId: string,
): Promise<PortalActionResult> {
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  const student = token ? await getStudentByPortalToken(token) : null;
  if (!student || !submissionId) return { ok: false, error: ACCESS_ERROR };

  const db = createServiceClient()!;

  const { data: subRow } = await db
    .from("homework_submissions")
    .select("id, assignment_id, attempt_no")
    .eq("tenant_id", student.tenantId)
    .eq("id", submissionId)
    .maybeSingle();
  const sub = subRow as {
    id: string;
    assignment_id: string;
    attempt_no: number;
  } | null;
  if (!sub) return { ok: false, error: ACCESS_ERROR };

  // 본인 과제의 제출인지 확인 — 타 학생 제출은 존재 자체 비노출(H-04·H-06).
  const { data: assignmentRow } = await db
    .from("homework_assignments")
    .select("id")
    .eq("tenant_id", student.tenantId)
    .eq("student_id", student.id)
    .eq("id", sub.assignment_id)
    .maybeSingle();
  if (!assignmentRow) return { ok: false, error: ACCESS_ERROR };

  // 최신 제출본만 철회 대상 — 이전 회차는 이미 새 제출본으로 대체된 보존 이력이다(검수 27).
  const { data: latestRows } = await db
    .from("homework_submissions")
    .select("id")
    .eq("tenant_id", student.tenantId)
    .eq("assignment_id", sub.assignment_id)
    .is("withdrawn_at", null)
    .order("attempt_no", { ascending: false })
    .limit(1);
  const latestId = ((latestRows ?? [])[0] as { id: string } | undefined)?.id;
  if (latestId !== sub.id) {
    return { ok: false, error: "최신 제출본만 철회할 수 있습니다." };
  }

  // 검토 전(pending)일 때만 — 조건부 갱신이라 경합에도 검토 시작 후 철회는 0건 갱신으로 걸러진다(H-02).
  const { data: updated, error } = await db
    .from("homework_submissions")
    .update({ withdrawn_at: new Date().toISOString() })
    .eq("tenant_id", student.tenantId)
    .eq("id", sub.id)
    .eq("review_status", "pending")
    .is("withdrawn_at", null)
    .select("id");
  if (error) {
    console.error("[portal/homework] withdraw failed", error);
    return { ok: false, error: "철회 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." };
  }
  if ((updated ?? []).length === 0) {
    // 검토 진행 여부는 포털 비노출 — 사유를 특정하지 않고 운영자(정정) 흐름으로 안내한다(H-02).
    return { ok: false, error: "지금은 철회할 수 없습니다. 선생님께 문의해 주세요." };
  }

  await logActivity(
    student.tenantId,
    `portal:${student.id}`,
    "update",
    "homework_submission",
    sub.id,
    `과제 제출 철회 (${sub.attempt_no}회차)`,
  );
  revalidatePath(`/portal/${token}`);
  return { ok: true };
}

/* ---------- 질문 접수 (H-04 · 검수 29) ---------- */

export async function askQuestion(
  formData: FormData,
): Promise<PortalActionResult> {
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const token = String(formData.get("token") ?? "").trim();
  const student = token ? await getStudentByPortalToken(token) : null;
  if (!student) return { ok: false, error: ACCESS_ERROR };

  const question = String(formData.get("question") ?? "").trim();
  if (!question) return { ok: false, error: "질문 내용을 입력해 주세요." };
  if (question.length > MAX_QUESTION_LENGTH) {
    return { ok: false, error: "질문이 너무 깁니다. 2,000자 이내로 줄여 주세요." };
  }

  const assignmentId = String(formData.get("assignmentId") ?? "").trim() || null;
  const reportId = String(formData.get("reportId") ?? "").trim() || null;
  // 질문은 원 기록과 연결되어야 접수된다(검수 29) — 포털에서는 과제 또는 리포트 카드에서만 열린다.
  if (!assignmentId && !reportId) return { ok: false, error: ACCESS_ERROR };
  // 원 기록은 하나만 연결한다 — 둘 다 오면 과제를 원 기록으로 삼는다.
  // (아래 검증이 else-if라 두 번째 id가 미검증인 채 저장되는 경로를 원천 차단)
  const originReportId = assignmentId ? null : reportId;

  const db = createServiceClient()!;

  // 원 기록이 본인에게 실제 노출되는 것인지 확인 — 아니면 존재 비노출 일반 오류(H-04).
  let originLabel = "";
  if (assignmentId) {
    const { data } = await db
      .from("homework_assignments")
      .select("id, title, status")
      .eq("tenant_id", student.tenantId)
      .eq("student_id", student.id)
      .eq("id", assignmentId)
      .maybeSingle();
    const row = data as { id: string; title: string; status: string } | null;
    if (!row || row.status === "draft" || row.status === "canceled") {
      return { ok: false, error: ACCESS_ERROR };
    }
    originLabel = `과제: ${row.title}`;
  } else if (reportId) {
    // 포털 노출 리포트만(승인·발송 + 학부모·학생 대상) — lib/data/crm.ts listPortalReports와 동일 스코프.
    const { data } = await db
      .from("ai_reports")
      .select("id, type")
      .eq("tenant_id", student.tenantId)
      .eq("student_id", student.id)
      .eq("id", reportId)
      .in("status", ["approved", "sent"])
      .in("audience", ["parent", "student"])
      .maybeSingle();
    const row = data as { id: string; type: string } | null;
    if (!row) return { ok: false, error: ACCESS_ERROR };
    originLabel = `리포트(${row.type})`;
  }

  // 연속 질문 폭주 가드 — 같은 학생의 직전 질문과 최소 간격.
  const { data: lastRows } = await db
    .from("homework_questions")
    .select("created_at")
    .eq("tenant_id", student.tenantId)
    .eq("student_id", student.id)
    .order("created_at", { ascending: false })
    .limit(1);
  const lastAt = ((lastRows ?? [])[0] as { created_at: string } | undefined)
    ?.created_at;
  if (lastAt && Date.now() - new Date(lastAt).getTime() < RATE_INTERVAL_MS) {
    return { ok: false, error: "질문 간격이 너무 짧습니다. 잠시 후 다시 시도해 주세요." };
  }

  const { data: insertedRow, error: insertError } = await db
    .from("homework_questions")
    .insert({
      tenant_id: student.tenantId,
      student_id: student.id,
      assignment_id: assignmentId,
      report_id: originReportId,
      question,
      status: "open",
    })
    .select("id")
    .single();
  if (insertError || !insertedRow) {
    console.error("[portal/homework] question insert failed", insertError);
    return { ok: false, error: "질문 접수 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." };
  }
  const questionId = (insertedRow as { id: string }).id;

  // 열린 질문은 오늘 업무로 수렴 — 답변 게시 또는 해결 완료로 닫힌다(H-04 · 검수 29).
  await createWorkItem(student.tenantId, {
    kind: "question_asked",
    title: `학생 질문 답변: ${student.name}`,
    sourceType: "homework_question",
    sourceId: questionId,
    nextAction: "원 기록 확인 후 답변 작성 → 승인 게시 또는 해결 완료 처리",
    detail: `${originLabel} — ${question.slice(0, 80)}`,
    priority: "normal",
  });
  await logActivity(
    student.tenantId,
    `portal:${student.id}`,
    "create",
    "homework_question",
    questionId,
    `학생 질문 접수 (${originLabel})`,
  );

  revalidatePath(`/portal/${token}`);
  return { ok: true };
}

/* ---------- 제출 파일 재열람 (H-06 — 자기 제출 파일만, 요청 시 발급·1시간 만료) ---------- */

export async function getSubmissionFileUrl(
  token: string,
  submissionId: string,
): Promise<PortalFileUrlResult> {
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  const student = token ? await getStudentByPortalToken(token) : null;
  if (!student || !submissionId) return { ok: false, error: ACCESS_ERROR };

  const db = createServiceClient()!;

  const { data: subRow } = await db
    .from("homework_submissions")
    .select("id, assignment_id, file_path")
    .eq("tenant_id", student.tenantId)
    .eq("id", submissionId)
    .maybeSingle();
  const sub = subRow as {
    id: string;
    assignment_id: string;
    file_path: string | null;
  } | null;
  if (!sub) return { ok: false, error: ACCESS_ERROR };

  // 자기 제출 파일만 — 다른 학생 파일은 존재 자체 비노출(H-06). 파일 없음도 같은 오류로 수렴.
  const { data: assignmentRow } = await db
    .from("homework_assignments")
    .select("id")
    .eq("tenant_id", student.tenantId)
    .eq("student_id", student.id)
    .eq("id", sub.assignment_id)
    .maybeSingle();
  if (!assignmentRow || !sub.file_path) return { ok: false, error: ACCESS_ERROR };

  const { data, error } = await db.storage
    .from(HOMEWORK_BUCKET)
    .createSignedUrl(sub.file_path, SIGNED_URL_TTL_S);
  if (error || !data?.signedUrl) {
    console.error("[portal/homework] signed url failed", error);
    return { ok: false, error: "파일 열람 링크 발급에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }
  return { ok: true, url: data.signedUrl };
}
