"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { getLesson, getStudent } from "@/lib/data/crm";
import {
  createAssignment as insertAssignmentDraft,
  getAssignment,
  updateDraft,
} from "@/lib/data/homework";
import { logActivity, runCritical } from "@/lib/data/activity";
import { getSiteContent } from "@/lib/data/content";
import { sendNotification } from "@/lib/notify/send";
import { renderTemplate } from "@/lib/notify/templates";
import type { CrmActionResult } from "@/components/admin/crm/types";
import { isReviewResult, reviewResultLabel } from "./constants";

// 과제 도메인 서버 액션 (H-01~H-07) — 정본: docs/flow-canon/01_atlas_03_learning.md.
//
// 감사 규칙(정본 ① — 과제 배부·피드백은 성적 계열):
//   - 상태 전환(배부·철회·검토 판정·피드백 승인·답변 게시·종료·취소)은 runCritical(category "grade")
//     로 fail-closed — 감사 선기록 없이는 실행하지 않는다.
//   - 비노출 초안 저장(과제 초안·피드백 초안·답변 초안)은 logActivity로 충분하다.
// 업무/전달 분리: 배부 알림 실패는 배부를 되돌리지 않는다 — notifications 큐가 재시도로 수렴한다.

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";
// 학생 상세 포털 링크 카드·reports/actions.ts sendReport와 같은 값 — 알림에 실은 링크가 일치해야 한다.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://axiommathlab.kr";

function revalidateHomework(id?: string) {
  revalidatePath("/admin/homework");
  if (id) revalidatePath(`/admin/homework/${id}`);
}

/* ---------- 과제 초안 (H-01: 초안은 학생·보호자 비노출) ---------- */

interface AssignmentFormPayload {
  studentId: string;
  lessonId: string | null;
  title: string;
  description: string;
  dueDate: string | null;
}

function parseAssignmentForm(
  formData: FormData,
): AssignmentFormPayload | { error: string } {
  const studentId = String(formData.get("studentId") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  if (!studentId) return { error: "학생을 선택해 주세요." };
  if (!title) return { error: "과제 제목을 입력해 주세요." };
  const dueDateRaw = String(formData.get("dueDate") ?? "").trim();
  if (dueDateRaw && !/^\d{4}-\d{2}-\d{2}$/.test(dueDateRaw)) {
    return { error: "기한 형식이 올바르지 않습니다." };
  }
  return {
    studentId,
    lessonId: String(formData.get("lessonId") ?? "").trim() || null,
    title,
    description: String(formData.get("description") ?? "").trim(),
    dueDate: dueDateRaw || null,
  };
}

/**
 * lesson_id는 사용자 입력 — 현재 테넌트의 수업이고 과제 대상 학생의 수업일 때만 연결한다
 * (materials 관례의 교차 테넌트 FK 연결 차단 + 학생 일치 확인: 질문의 원 기록 대조 근거·H-01).
 */
async function verifiedLessonId(
  tenantId: string,
  studentId: string,
  lessonIdRaw: string | null,
): Promise<string | null> {
  if (!lessonIdRaw) return null;
  const lesson = await getLesson(tenantId, lessonIdRaw);
  return lesson && lesson.studentId === studentId ? lesson.id : null;
}

export async function createAssignment(
  formData: FormData,
): Promise<CrmActionResult & { id?: string }> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const parsed = parseAssignmentForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const student = await getStudent(session.tenantId, parsed.studentId);
  if (!student) return { ok: false, error: "학생 정보를 찾을 수 없습니다." };
  const lessonId = await verifiedLessonId(session.tenantId, parsed.studentId, parsed.lessonId);

  const created = await insertAssignmentDraft(session.tenantId, {
    studentId: parsed.studentId,
    lessonId,
    title: parsed.title,
    description: parsed.description,
    dueDate: parsed.dueDate,
  });
  if (!created.ok) return created;

  // 초안은 비노출 상태의 단순 저장 — 게시·배부 같은 노출 전환만 runCritical로 감싼다.
  await logActivity(
    session.tenantId,
    session.email,
    "homework_draft_create",
    "homework_assignment",
    created.id,
    `과제 초안 생성: ${parsed.title} (${student.name})`,
  );

  revalidateHomework();
  return { ok: true, id: created.id };
}

export async function updateAssignment(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  const parsed = parseAssignmentForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const student = await getStudent(session.tenantId, parsed.studentId);
  if (!student) return { ok: false, error: "학생 정보를 찾을 수 없습니다." };
  const lessonId = await verifiedLessonId(session.tenantId, parsed.studentId, parsed.lessonId);

  // draft만 수정된다 — 게시(assigned) 후 내용 변경은 데이터 계층이 거부하고
  // "새 과제본으로 만들어 주세요" 안내를 돌려준다(H-01: 게시 후 변경은 새 과제본→재검토·재게시).
  const updated = await updateDraft(session.tenantId, id, {
    studentId: parsed.studentId,
    lessonId,
    title: parsed.title,
    description: parsed.description,
    dueDate: parsed.dueDate,
  });
  if (!updated.ok) return updated;

  await logActivity(
    session.tenantId,
    session.email,
    "homework_draft_update",
    "homework_assignment",
    id,
    `과제 초안 수정: ${parsed.title} (${student.name})`,
  );

  revalidateHomework(id);
  return { ok: true };
}

/* ---------- 배부·철회 (H-01) ---------- */

export async function assignAssignment(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const assignment = await getAssignment(session.tenantId, id);
  if (!assignment) return { ok: false, error: "과제를 찾을 수 없습니다." };
  if (assignment.status !== "draft") {
    return { ok: false, error: "초안 상태의 과제만 배부할 수 있습니다." };
  }
  const student = await getStudent(session.tenantId, assignment.studentId);
  if (!student) return { ok: false, error: "학생 정보를 찾을 수 없습니다." };

  const db = createServiceClient()!;
  // 게시·배부는 학생·보호자 노출로 이어지는 성적 계열 중요 전환 — 감사 선기록 실패 시 배부하지 않는다.
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "homework_assign",
      targetType: "homework_assignment",
      targetId: id,
      summary: `${student.name} 과제 배부: ${assignment.title}`,
      category: "grade",
      before: { status: assignment.status },
      after: { status: "assigned" },
    },
    async (): Promise<CrmActionResult> => {
      const { data, error } = await db
        .from("homework_assignments")
        .update({ status: "assigned", assigned_at: new Date().toISOString() })
        .eq("tenant_id", session.tenantId)
        .eq("id", id)
        .eq("status", "draft") // 동시 요청 경합에도 초안→배부 전환은 한 번만
        .select("id");
      if (error) {
        console.error("[homework] assign failed", error);
        return { ok: false, error: "배부 처리 중 오류가 발생했습니다." };
      }
      if ((data ?? []).length === 0) {
        return { ok: false, error: "초안 상태의 과제만 배부할 수 있습니다." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  // 학부모 알림 — 업무(배부)와 전달(알림)을 분리한다: 알림 실패가 배부를 되돌리지 않는다.
  // 실패·야간 대기 건은 notifications 큐(failed→재시도 크론→소진 시 오늘 업무)로 수렴한다.
  const { settings } = await getSiteContent(session.tenantId);
  const portalUrl = student.portalToken ? `${SITE_URL}/portal/${student.portalToken}` : null;
  const message = `[${settings.brandName}] ${renderTemplate("homework_assigned", {
    name: student.name,
  })}${portalUrl ? `\n${portalUrl}` : ""}`;
  const sent = await sendNotification({
    tenantId: session.tenantId,
    studentId: student.id,
    type: "homework_assigned",
    phone: student.parentPhone,
    message,
    isAd: false,
  });
  if (!sent.ok && !sent.skipped) {
    console.error("[homework] 배부 알림 발송 실패 — 배부는 유지, 알림 큐 재시도로 수렴", sent.error);
  }

  revalidateHomework(id);
  return result;
}

export async function retractAssignment(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const assignment = await getAssignment(session.tenantId, id);
  if (!assignment) return { ok: false, error: "과제를 찾을 수 없습니다." };
  if (assignment.status !== "assigned") {
    return { ok: false, error: "배부된 과제만 철회할 수 있습니다." };
  }
  // 제출 이력이 하나라도 있으면(철회분 포함) 배부 철회 불가 — 제출물이 딸린 과제를 초안으로 되돌려
  // 감추지 않는다. 대상 취소·전체 종료 경로로 수렴시킨다(H-07: 취소도 제출물·피드백을 삭제하지 않는다).
  if (assignment.submissions.length > 0) {
    return {
      ok: false,
      error:
        "제출물이 있는 과제는 배부를 철회할 수 없습니다. 대상 취소 또는 전체 종료로 처리해 주세요(제출물·피드백은 보존됩니다).",
    };
  }

  const db = createServiceClient()!;
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "homework_retract",
      targetType: "homework_assignment",
      targetId: id,
      summary: `${assignment.studentName ?? "학생"} 과제 배부 철회: ${assignment.title}`,
      category: "grade",
      before: { status: assignment.status },
      after: { status: "draft" },
      reason: "잘못된 배부 철회 — 초안으로 되돌려 재검토(H-01)",
    },
    async (): Promise<CrmActionResult> => {
      // 원자적 철회(00015 retract_homework_assignment) — "제출 이력 없음" 조건을 UPDATE의
      // WHERE로 판정한다. 위 스냅샷 검사와 이 문장 사이에 도착한 제출도 철회를 막는다.
      const { data: retracted, error } = await db.rpc("retract_homework_assignment", {
        p_tenant_id: session.tenantId,
        p_id: id,
      });
      if (error) {
        console.error("[homework] retract failed", error);
        return { ok: false, error: "배부 철회 중 오류가 발생했습니다." };
      }
      if (!retracted) {
        return {
          ok: false,
          error:
            "철회할 수 없습니다 — 배부 상태가 아니거나 그 사이 제출이 도착했습니다. 제출물이 있으면 대상 취소 또는 전체 종료로 처리해 주세요(제출물·피드백은 보존됩니다).",
        };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidateHomework(id);
  return result;
}

/* ---------- 제출 검토·피드백 (H-02·H-03 · 검수 27·28) ---------- */

interface SubmissionGuardRow {
  id: string;
  assignment_id: string;
  attempt_no: number;
  review_status: "pending" | "reviewed";
  review_result: "complete" | "resubmit" | null;
  feedback: string | null;
  feedback_status: "draft" | "approved" | null;
  withdrawn_at: string | null;
}

/** 제출 행을 테넌트 스코프로 조회 — 검토·피드백 액션의 공통 관문(현재 관계 재확인). */
async function getSubmissionRow(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  submissionId: string,
): Promise<SubmissionGuardRow | null> {
  const { data } = await db
    .from("homework_submissions")
    .select(
      "id, assignment_id, attempt_no, review_status, review_result, feedback, feedback_status, withdrawn_at",
    )
    .eq("tenant_id", tenantId)
    .eq("id", submissionId)
    .maybeSingle();
  return (data as SubmissionGuardRow | null) ?? null;
}

export async function reviewSubmission(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const submissionId = String(formData.get("submissionId") ?? "").trim();
  const resultValue = String(formData.get("result") ?? "").trim();
  if (!submissionId) return { ok: false, error: "잘못된 요청입니다." };
  if (!isReviewResult(resultValue)) {
    return { ok: false, error: "검토 판정(완료/재제출 요청)을 선택해 주세요." };
  }

  const db = createServiceClient()!;
  const submission = await getSubmissionRow(db, session.tenantId, submissionId);
  if (!submission) return { ok: false, error: "제출물을 찾을 수 없습니다." };
  if (submission.withdrawn_at) {
    return { ok: false, error: "철회된 제출은 검토 대상이 아닙니다(H-02)." };
  }
  if (submission.review_status !== "pending") {
    return {
      ok: false,
      error: "이미 검토된 제출입니다. 판정 정정은 새 피드백본으로 처리해 주세요(H-03).",
    };
  }

  // 검토 판정은 완료/재제출 분기(H-03)를 확정하는 성적 계열 전환 — fail-closed 감사.
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "homework_review",
      targetType: "homework_submission",
      targetId: submissionId,
      summary: `제출 검토(${submission.attempt_no}회차): ${reviewResultLabel(resultValue)}`,
      category: "grade",
      before: { review_status: submission.review_status, review_result: submission.review_result },
      after: { review_status: "reviewed", review_result: resultValue },
    },
    async (): Promise<CrmActionResult> => {
      const { data, error } = await db
        .from("homework_submissions")
        .update({ review_status: "reviewed", review_result: resultValue })
        .eq("tenant_id", session.tenantId)
        .eq("id", submissionId)
        .eq("review_status", "pending") // 경합 시 이중 판정 차단
        .is("withdrawn_at", null)
        .select("id");
      if (error) {
        console.error("[homework] review failed", error);
        return { ok: false, error: "검토 처리 중 오류가 발생했습니다." };
      }
      if ((data ?? []).length === 0) {
        return { ok: false, error: "이미 검토됐거나 철회된 제출입니다." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidateHomework(submission.assignment_id);
  return result;
}

export async function saveFeedback(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const submissionId = String(formData.get("submissionId") ?? "").trim();
  const feedback = String(formData.get("feedback") ?? "").trim();
  if (!submissionId) return { ok: false, error: "잘못된 요청입니다." };
  if (!feedback) return { ok: false, error: "피드백 내용을 입력해 주세요." };

  const db = createServiceClient()!;
  const submission = await getSubmissionRow(db, session.tenantId, submissionId);
  if (!submission) return { ok: false, error: "제출물을 찾을 수 없습니다." };
  if (submission.withdrawn_at) {
    return { ok: false, error: "철회된 제출에는 피드백을 남길 수 없습니다." };
  }

  // 초안 저장은 항상 feedback_status='draft' — 미승인 피드백은 알림·포털 비노출(검수 28).
  // 게시된(approved) 피드백의 수정은 '게시 철회 + 새 초안'이라는 노출 상태 전환이므로
  // fail-closed 감사로 남기고, 학생이 이미 열람한 이전 게시 본문을 before에 보존한다
  // (H-03 "철회한 피드백을 그대로 재게시하지 않고 새 본으로" — 이전 본 이력이 전제).
  const applyDraft = async (): Promise<CrmActionResult> => {
    const { error } = await db
      .from("homework_submissions")
      .update({ feedback, feedback_status: "draft", feedback_approved_at: null })
      .eq("tenant_id", session.tenantId)
      .eq("id", submissionId);
    if (error) {
      console.error("[homework] feedback draft save failed", error);
      return { ok: false, error: "피드백 저장 중 오류가 발생했습니다." };
    }
    return { ok: true };
  };

  if (submission.feedback_status === "approved") {
    const result = await runCritical(
      {
        tenantId: session.tenantId,
        actorEmail: session.email,
        action: "homework_feedback_retract",
        targetType: "homework_submission",
        targetId: submissionId,
        summary: `게시 피드백 철회·새 초안 교체(${submission.attempt_no}회차)`,
        category: "grade",
        before: { feedback_status: "approved", feedback: submission.feedback },
        after: { feedback_status: "draft", feedback },
      },
      applyDraft,
    );
    if (!result.ok) return result;
  } else {
    const applied = await applyDraft();
    if (!applied.ok) return applied;
    await logActivity(
      session.tenantId,
      session.email,
      "homework_feedback_draft",
      "homework_submission",
      submissionId,
      `피드백 초안 저장(${submission.attempt_no}회차)`,
    );
  }

  revalidateHomework(submission.assignment_id);
  return { ok: true };
}

export async function approveFeedback(submissionId: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const submission = await getSubmissionRow(db, session.tenantId, submissionId);
  if (!submission) return { ok: false, error: "제출물을 찾을 수 없습니다." };
  if (submission.withdrawn_at) {
    return { ok: false, error: "철회된 제출의 피드백은 승인할 수 없습니다." };
  }
  if (!submission.feedback || submission.feedback_status !== "draft") {
    return { ok: false, error: "승인할 피드백 초안이 없습니다." };
  }
  // 판정(완료/재제출) 없이 피드백만 게시하지 않는다 — 포털은 피드백 게시와 함께 판정을 표시한다(H-03).
  if (submission.review_status !== "reviewed") {
    return { ok: false, error: "제출 검토(판정 확정)를 먼저 완료해 주세요." };
  }

  // 승인 시점부터 포털 노출(검수 28) — 성적 계열 게시 전환이므로 fail-closed 감사.
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "homework_feedback_approve",
      targetType: "homework_submission",
      targetId: submissionId,
      summary: `피드백 승인·게시(${submission.attempt_no}회차, 판정: ${
        submission.review_result ? reviewResultLabel(submission.review_result) : "-"
      })`,
      category: "grade",
      before: { feedback_status: submission.feedback_status },
      after: { feedback_status: "approved" },
    },
    async (): Promise<CrmActionResult> => {
      const { data, error } = await db
        .from("homework_submissions")
        .update({
          feedback_status: "approved",
          feedback_approved_at: new Date().toISOString(),
        })
        .eq("tenant_id", session.tenantId)
        .eq("id", submissionId)
        .eq("feedback_status", "draft") // 경합 시 이중 승인 차단
        .select("id");
      if (error) {
        console.error("[homework] feedback approve failed", error);
        return { ok: false, error: "피드백 승인 중 오류가 발생했습니다." };
      }
      if ((data ?? []).length === 0) {
        return { ok: false, error: "승인할 피드백 초안이 없습니다." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidateHomework(submission.assignment_id);
  return result;
}

/* ---------- 종료·취소 (H-07 · 검수 126) ---------- */

/** 미검토 제출 수 — review_status=pending이고 철회되지 않은 것(검수 126 판정 근거). */
async function countUnreviewed(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  assignmentId: string,
): Promise<number> {
  const { count } = await db
    .from("homework_submissions")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("assignment_id", assignmentId)
    .eq("review_status", "pending")
    .is("withdrawn_at", null);
  return count ?? 0;
}

export async function closeAssignment(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const assignment = await getAssignment(session.tenantId, id);
  if (!assignment) return { ok: false, error: "과제를 찾을 수 없습니다." };
  if (assignment.status !== "assigned") {
    return { ok: false, error: "배부된 과제만 전체 종료할 수 있습니다." };
  }

  const db = createServiceClient()!;
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "homework_close",
      targetType: "homework_assignment",
      targetId: id,
      summary: `${assignment.studentName ?? "학생"} 과제 전체 종료: ${assignment.title}`,
      category: "grade",
      before: { status: assignment.status },
      after: { status: "closed" },
    },
    async (): Promise<CrmActionResult> => {
      // 원자적 종료(00015 close_homework_assignment) — "미검토(pending·비철회) 제출 없음"
      // 조건을 UPDATE의 WHERE로 판정한다(검수 126). 계수→갱신 사이에 도착하는 제출 경합이 없다.
      const { data: closed, error } = await db.rpc("close_homework_assignment", {
        p_tenant_id: session.tenantId,
        p_id: id,
      });
      if (error) {
        console.error("[homework] close failed", error);
        return { ok: false, error: "종료 처리 중 오류가 발생했습니다." };
      }
      if (!closed) {
        const unreviewed = await countUnreviewed(db, session.tenantId, id);
        return {
          ok: false,
          error:
            unreviewed > 0
              ? `미검토 제출이 ${unreviewed}건 남아 있습니다. 검토를 마친 뒤 종료해 주세요(검수 126).`
              : "배부된 과제만 전체 종료할 수 있습니다.",
        };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidateHomework(id);
  return result;
}

export async function cancelAssignment(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const assignment = await getAssignment(session.tenantId, id);
  if (!assignment) return { ok: false, error: "과제를 찾을 수 없습니다." };
  if (assignment.status === "closed" || assignment.status === "canceled") {
    return { ok: false, error: "이미 종료·취소된 과제입니다." };
  }

  const db = createServiceClient()!;
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "homework_cancel",
      targetType: "homework_assignment",
      targetId: id,
      summary: `${assignment.studentName ?? "학생"} 과제 취소: ${assignment.title}`,
      category: "grade",
      before: { status: assignment.status },
      after: { status: "canceled" },
      reason: "대상 취소 — 제출물·피드백은 자동 삭제하지 않고 보존(H-07)",
    },
    async (): Promise<CrmActionResult> => {
      // 취소는 미검토 제출이 있어도 가능한 수렴 경로(검수 126의 '취소')지만,
      // 잔존분은 close_note에 남겨 별도 검토가 필요함을 드러낸다.
      const unreviewed = await countUnreviewed(db, session.tenantId, id);
      const closeNote =
        unreviewed > 0
          ? `대상 취소 — 제출물·피드백 보존(H-07), 미검토 제출 ${unreviewed}건 별도 검토 필요(검수 126)`
          : "대상 취소 — 제출물·피드백 보존(H-07)";
      const { data, error } = await db
        .from("homework_assignments")
        .update({
          status: "canceled",
          closed_at: new Date().toISOString(),
          close_note: closeNote,
        })
        .eq("tenant_id", session.tenantId)
        .eq("id", id)
        .in("status", ["draft", "assigned"])
        .select("id");
      if (error) {
        console.error("[homework] cancel failed", error);
        return { ok: false, error: "취소 처리 중 오류가 발생했습니다." };
      }
      if ((data ?? []).length === 0) {
        return { ok: false, error: "이미 종료·취소된 과제입니다." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidateHomework(id);
  return result;
}

/** 보관(H-07) — 종료·취소된 과제를 현재 목록에서 접는다. 파기가 아니며 이력 접근은 유지된다. */
export async function archiveAssignment(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const { data, error } = await db
    .from("homework_assignments")
    .update({ archived_at: new Date().toISOString() })
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    .in("status", ["closed", "canceled"]) // 진행 중 과제는 보관 대상이 아니다
    .is("archived_at", null)
    .select("id");
  if (error) {
    console.error("[homework] archive failed", error);
    return { ok: false, error: "보관 처리 중 오류가 발생했습니다." };
  }
  if ((data ?? []).length === 0) {
    return { ok: false, error: "종료·취소된 과제만 보관할 수 있습니다." };
  }
  await logActivity(
    session.tenantId,
    session.email,
    "homework_archive",
    "homework_assignment",
    id,
    "과제 보관 — 현재 목록에서 접음(파기 아님, 이력 접근 유지 — H-07)",
  );
  revalidateHomework(id);
  return { ok: true };
}

/* ---------- 질의응답 (H-04 · 검수 29) ---------- */

interface QuestionGuardRow {
  id: string;
  assignment_id: string | null;
  student_id: string;
  status: "open" | "resolved";
  answer: string | null;
  answer_status: "draft" | "approved" | null;
}

/** 질문 행을 테넌트 스코프로 조회 — 답변·승인·해결 액션의 공통 관문. */
async function getQuestionRow(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  questionId: string,
): Promise<QuestionGuardRow | null> {
  const { data } = await db
    .from("homework_questions")
    .select("id, assignment_id, student_id, status, answer, answer_status")
    .eq("tenant_id", tenantId)
    .eq("id", questionId)
    .maybeSingle();
  return (data as QuestionGuardRow | null) ?? null;
}

export async function answerQuestion(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const questionId = String(formData.get("questionId") ?? "").trim();
  const answer = String(formData.get("answer") ?? "").trim();
  if (!questionId) return { ok: false, error: "잘못된 요청입니다." };
  if (!answer) return { ok: false, error: "답변 내용을 입력해 주세요." };

  const db = createServiceClient()!;
  const question = await getQuestionRow(db, session.tenantId, questionId);
  if (!question) return { ok: false, error: "질문을 찾을 수 없습니다." };
  if (question.status === "resolved") {
    return { ok: false, error: "해결 완료로 닫힌 질문입니다(검수 29)." };
  }

  // 답변 초안은 승인 전 비노출(검수 28·H-04). 게시된(approved) 답변의 수정은
  // '게시 철회 + 새 초안' — 노출 상태 전환이므로 fail-closed 감사 + 이전 게시 본문 보존.
  const applyAnswerDraft = async (): Promise<CrmActionResult> => {
    const { error } = await db
      .from("homework_questions")
      .update({ answer, answer_status: "draft", answered_at: null })
      .eq("tenant_id", session.tenantId)
      .eq("id", questionId)
      .eq("status", "open");
    if (error) {
      console.error("[homework] answer draft save failed", error);
      return { ok: false, error: "답변 저장 중 오류가 발생했습니다." };
    }
    return { ok: true };
  };

  if (question.answer_status === "approved") {
    const result = await runCritical(
      {
        tenantId: session.tenantId,
        actorEmail: session.email,
        action: "homework_answer_retract",
        targetType: "homework_question",
        targetId: questionId,
        summary: "게시 답변 철회·새 초안 교체",
        category: "grade",
        before: { answer_status: "approved", answer: question.answer },
        after: { answer_status: "draft", answer },
      },
      applyAnswerDraft,
    );
    if (!result.ok) return result;
  } else {
    const applied = await applyAnswerDraft();
    if (!applied.ok) return applied;
    await logActivity(
      session.tenantId,
      session.email,
      "homework_answer_draft",
      "homework_question",
      questionId,
      "질문 답변 초안 저장",
    );
  }

  revalidateHomework(question.assignment_id ?? undefined);
  return { ok: true };
}

/** 답변 게시 공통 처리 — resolve=true면 게시와 함께 해결 완료로 닫는다(검수 29). */
async function publishAnswer(id: string, resolve: boolean): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const question = await getQuestionRow(db, session.tenantId, id);
  if (!question) return { ok: false, error: "질문을 찾을 수 없습니다." };
  if (question.status === "resolved") {
    return { ok: false, error: "이미 해결 완료로 닫힌 질문입니다." };
  }
  if (!question.answer || question.answer_status !== "draft") {
    return { ok: false, error: "승인할 답변 초안이 없습니다." };
  }

  // 답변 게시부터 포털 노출(검수 28) — 학습 기록 게시 전환이므로 fail-closed 감사.
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: resolve ? "homework_answer_approve_resolve" : "homework_answer_approve",
      targetType: "homework_question",
      targetId: id,
      summary: resolve ? "질문 답변 게시 + 해결 완료" : "질문 답변 게시",
      category: "grade",
      before: { answer_status: question.answer_status, status: question.status },
      after: { answer_status: "approved", status: resolve ? "resolved" : question.status },
    },
    async (): Promise<CrmActionResult> => {
      const { data, error } = await db
        .from("homework_questions")
        .update({
          answer_status: "approved",
          answered_at: new Date().toISOString(),
          ...(resolve ? { status: "resolved" } : {}),
        })
        .eq("tenant_id", session.tenantId)
        .eq("id", id)
        .eq("answer_status", "draft") // 경합 시 이중 게시 차단
        .eq("status", "open")
        .select("id");
      if (error) {
        console.error("[homework] answer approve failed", error);
        return { ok: false, error: "답변 게시 중 오류가 발생했습니다." };
      }
      if ((data ?? []).length === 0) {
        return { ok: false, error: "승인할 답변 초안이 없습니다." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidateHomework(question.assignment_id ?? undefined);
  return result;
}

export async function approveAnswer(id: string): Promise<CrmActionResult> {
  return publishAnswer(id, false);
}

export async function approveAndResolveQuestion(id: string): Promise<CrmActionResult> {
  return publishAnswer(id, true);
}

export async function resolveQuestion(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const question = await getQuestionRow(db, session.tenantId, id);
  if (!question) return { ok: false, error: "질문을 찾을 수 없습니다." };
  if (question.status === "resolved") {
    return { ok: false, error: "이미 해결 완료로 닫힌 질문입니다." };
  }

  // 답변 게시 없이도 해결 완료로 닫을 수 있다 — 질문 닫기, 학습 이력은 유지(검수 29·H-04).
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "homework_question_resolve",
      targetType: "homework_question",
      targetId: id,
      summary: "질문 해결 완료로 닫음(학습 이력 유지)",
      category: "grade",
      before: { status: question.status },
      after: { status: "resolved" },
    },
    async (): Promise<CrmActionResult> => {
      const { data, error } = await db
        .from("homework_questions")
        .update({ status: "resolved" })
        .eq("tenant_id", session.tenantId)
        .eq("id", id)
        .eq("status", "open")
        .select("id");
      if (error) {
        console.error("[homework] question resolve failed", error);
        return { ok: false, error: "해결 처리 중 오류가 발생했습니다." };
      }
      if ((data ?? []).length === 0) {
        return { ok: false, error: "이미 해결 완료로 닫힌 질문입니다." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidateHomework(question.assignment_id ?? undefined);
  return result;
}
