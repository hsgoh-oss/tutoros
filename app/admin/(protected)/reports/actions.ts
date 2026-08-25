"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { getStudent, listGrades, listLessons } from "@/lib/data/crm";
import { createReportRow, getReport, type AiReportWithHistory } from "@/lib/data/reports";
import { generateReport } from "@/lib/ai/generate";
import { pseudonymize } from "@/lib/ai/pseudonym";
import { getSiteContent } from "@/lib/data/content";
import {
  REPORT_PROMPT_RULES,
  hasBlockingIssue,
  validateReportContent,
} from "@/lib/ai/validate";
import { sendNotification } from "@/lib/notify/send";
import { renderTemplate, type NotifyType } from "@/lib/notify/templates";
import { runCritical } from "@/lib/data/activity";
import { createWorkItem } from "@/lib/data/work";
import type {
  GradeRecord,
  Lesson,
  ReportAudience,
  ReportType,
  Student,
} from "@/lib/types";
import type { CrmActionResult } from "@/components/admin/crm/types";
import { AI_REPORT_DISCLAIMER, REPORT_NOTIFY_TYPE } from "./constants";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";
// 학생 상세의 포털 링크 카드와 같은 값을 써야 문자로 간 링크와 관리자가 복사한 링크가 일치한다.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://axiommathlab.kr";
const REPORT_TYPES: ReportType[] = ["lesson", "weekly", "monthly", "exam", "consult_brief"];
const REPORT_AUDIENCES: ReportAudience[] = ["parent", "student", "internal"];

const AUDIENCE_LABEL: Record<ReportAudience, string> = {
  parent: "학부모",
  student: "학생 본인",
  internal: "선생님(내부용)",
};

const TYPE_LABEL: Record<ReportType, string> = {
  lesson: "수업",
  weekly: "주간",
  monthly: "월간",
  exam: "시험",
  consult_brief: "상담 브리핑",
};

function revalidateReport(id: string) {
  revalidatePath("/admin/reports");
  revalidatePath(`/admin/reports/${id}`);
}

/** lib/notify/send.ts MAX_RETRY와 동일 값 — 회수한 알림이 notifyRetry 크론(retry_count<3 재큐잉)에 다시 잡히지 않게 하는 상한. */
const NOTIFY_MAX_RETRY = 3;

/**
 * 철회 전환 본체(G-03) — retractReport(단독 철회)와 createReport(정정본 생성 시 이전 본 대체)가 공유한다.
 *
 * 순서 계약: ① 발송 대기(queued) 알림 회수 → ② 상태 전환. ①만 성공하고 ②가 실패하면
 * 알림만 회수된 approved 본이 남아 수동 재발송으로 복구할 수 있지만, 반대 순서면 철회된 본의
 * 열람 안내 문자가 나갈 수 있다 — 회수를 먼저 확정한다.
 *
 * 이미 retracted인 본에 supersededBy만 연결하는 호출(철회 후 정정본 생성)에서는 철회 시각·사유를
 * 덮어쓰지 않는다 — 철회된 행이 곧 철회 이력이고, 이력은 덮어쓰지 않는다.
 *
 * 알려진 한계: 크론이 이미 sending으로 클레임한 알림은 회수하지 않는다(이중 발송 방지 클레임과
 * 경합 금지). 그 문자에는 열람 링크만 실리고 본문이 없으며, 포털은 retracted를 걸러 새 열람을
 * 차단하므로 노출은 링크 안내 문구에 그친다.
 */
async function retractReportRow(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  report: AiReportWithHistory,
  reason: string,
  supersededBy?: string,
): Promise<CrmActionResult> {
  // ① 아직 나가지 않은 열람 안내 회수 — queued(발송 대기)뿐 아니라 failed(재시도 대기)도
  //    함께 잠근다: notifyRetry 크론은 failed·retry_count<상한 전 건을 리포트 상태와 무관하게
  //    재큐잉하므로, 상한으로 올려 두지 않으면 철회 후 재발송이 나간다. 사유는 error 컬럼에.
  const { error: cancelError } = await db
    .from("notifications")
    .update({
      status: "failed",
      retry_count: NOTIFY_MAX_RETRY,
      error: "리포트 철회로 발송 회수",
    })
    .eq("tenant_id", tenantId)
    .eq("report_id", report.id)
    .in("status", ["queued", "failed"]);
  if (cancelError) {
    console.error("[reports] 철회 시 대기 알림 회수 실패", cancelError);
    return {
      ok: false,
      error: "발송 대기 알림 회수에 실패해 철회를 중단했습니다. 다시 시도해 주세요.",
    };
  }

  // ② 상태 전환 — 행은 보존한다(철회는 삭제가 아니다 — 새 열람 차단 + 철회 이력 보존).
  const patch: Record<string, unknown> = {};
  if (report.status !== "retracted") {
    patch.status = "retracted";
    patch.retracted_at = new Date().toISOString();
    patch.retract_reason = reason;
    // 발송 대기였다면 ①에서 회수됐다 — 전달 상태도 미발송으로 되돌린다(거짓 "발송 대기" 표시 방지).
    if (report.deliveryStatus === "queued") patch.delivery_status = "none";
  }
  if (supersededBy) patch.superseded_by = supersededBy;
  let update = db
    .from("ai_reports")
    .update(patch)
    .eq("tenant_id", tenantId)
    .eq("id", report.id);
  // TOCTOU 가드: 철회 전환은 선조회 시점 상태와 같을 때만(이중 철회가 철회 이력을 덮어쓰지 않게),
  // 대체 연결은 아직 대체되지 않은 본에만(정정본 이중 생성 경합 차단).
  if (report.status !== "retracted") update = update.eq("status", report.status);
  if (supersededBy) update = update.is("superseded_by", null);
  const { data: updated, error } = await update.select("id");
  if (error) {
    console.error("[reports] retract failed", error);
    return { ok: false, error: "철회 처리 중 오류가 발생했습니다." };
  }
  if ((updated ?? []).length === 0) {
    return {
      ok: false,
      error: "그 사이 상태가 바뀌어 처리하지 않았습니다(이미 철회·대체됐을 수 있음). 새로고침 후 다시 확인해 주세요.",
    };
  }
  return { ok: true };
}

/** ai_reports.type → 알림 발송 type 키. consult_brief(내부용)는 발송 대상이 없어 null. */
function notifyTypeFor(type: ReportType): NotifyType | null {
  if (type === "consult_brief") return null;
  return REPORT_NOTIFY_TYPE[type];
}

function buildStudentContext(
  student: Pick<Student, "name" | "school" | "grade">,
  lessons: Lesson[],
  grades: GradeRecord[],
): string {
  const lessonLines =
    lessons
      .slice(0, 5)
      .map(
        (l) =>
          `- ${l.lessonDate} ${l.sessionNumber}회차: ${l.content}${l.homework ? ` (숙제: ${l.homework})` : ""}${l.absent ? " [결석]" : ""}`,
      )
      .join("\n") || "최근 수업 기록 없음";
  const gradeLines =
    grades
      .slice(0, 5)
      .map((g) =>
        `- ${g.examName}${g.examDate ? `(${g.examDate})` : ""}: ${
          g.rawScore != null ? `${g.rawScore}점 ` : ""
        }${g.percentile != null ? `백분위 ${g.percentile} ` : ""}${g.grade ? `${g.grade}등급` : ""}`.trim(),
      )
      .join("\n") || "최근 성적 기록 없음";

  return `학생: ${student.name}\n학교/학년: ${student.school ?? "-"} ${student.grade ?? "-"}\n\n[최근 수업 기록]\n${lessonLines}\n\n[최근 성적]\n${gradeLines}`;
}

function buildPrompt(
  type: ReportType,
  audience: ReportAudience,
  depth: "basic" | "deep",
  context: string,
): string {
  const depthNote =
    depth === "deep"
      ? "심화 분석(약점 진단·학습 전략·다음 달 목표를 상세히) 형식으로 작성해 주세요."
      : "간략한 요약(핵심만 3~5문장) 형식으로 작성해 주세요.";
  return [
    `다음은 한 학생의 학습 데이터입니다. ${AUDIENCE_LABEL[audience]}에게 전달할 ${TYPE_LABEL[type]} 리포트를 한국어로 작성해 주세요.`,
    depthNote,
    REPORT_PROMPT_RULES,
    "",
    context,
  ].join("\n");
}

export async function createReport(
  formData: FormData,
): Promise<CrmActionResult & { id?: string }> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const type = String(formData.get("type") ?? "") as ReportType;
  const audience = String(formData.get("audience") ?? "") as ReportAudience;
  const rawDepth = String(formData.get("depth") ?? "basic") === "deep" ? "deep" : "basic";

  if (!studentId) return { ok: false, error: "학생을 선택해 주세요." };
  if (!REPORT_TYPES.includes(type)) return { ok: false, error: "올바르지 않은 유형입니다." };
  if (type === "consult_brief") {
    return { ok: false, error: "상담 브리핑은 상담 상세 페이지에서 생성해 주세요." };
  }
  if (!REPORT_AUDIENCES.includes(audience)) return { ok: false, error: "올바르지 않은 대상입니다." };
  if (audience === "internal") return { ok: false, error: "올바르지 않은 대상입니다." };

  // 기획: 깊이(심화)는 월간 리포트에만 적용, 그 외 유형은 기본으로 처리.
  const depth = type === "monthly" ? rawDepth : "basic";

  // G-03 정정 — "이전 본 대체" 선택(supersedes=기존 리포트 id, 상세 페이지의 정정본 생성 폼이 전달).
  // 새 본은 항상 draft로 태어나 재승인 전에는 포털에 노출되지 않고(정본: 새 보고서본 → 운영자
  // 재승인 → 최신본 게시), 이전 본은 생성과 동시에 철회 처리해 오류 본의 새 열람을 즉시 차단한다.
  const supersedesId = String(formData.get("supersedes") ?? "").trim();
  let previous: AiReportWithHistory | null = null;
  if (supersedesId) {
    previous = await getReport(session.tenantId, supersedesId);
    if (!previous) return { ok: false, error: "대체할 이전 리포트를 찾을 수 없습니다." };
    if (
      previous.studentId !== studentId ||
      previous.type !== type ||
      previous.audience !== audience
    ) {
      // 정정본은 같은 보고의 새 본이다 — 다른 학생·유형·대상의 본을 "최신본"으로 연결하는 오염을 막는다.
      return { ok: false, error: "이전 본과 학생·유형·대상이 같은 리포트만 대체할 수 있습니다." };
    }
    if (previous.supersededBy) {
      return { ok: false, error: "이미 대체된 리포트입니다. 최신본에서 정정본을 생성해 주세요." };
    }
    if (previous.status === "draft") {
      return { ok: false, error: "초안은 대체 대상이 아닙니다 — 초안을 직접 수정해 주세요." };
    }
  }

  const student = await getStudent(session.tenantId, studentId);
  if (!student) return { ok: false, error: "학생 정보를 찾을 수 없습니다." };

  const [lessons, grades] = await Promise.all([
    listLessons(session.tenantId, studentId),
    listGrades(session.tenantId, studentId),
  ]);

  const context = pseudonymize(buildStudentContext(student, lessons, grades), student.name);
  const prompt = buildPrompt(type, audience, depth, context);

  const generated = await generateReport(type, depth, prompt);
  if (!generated.ok || !generated.content) {
    return { ok: false, error: generated.error ?? "리포트 생성에 실패했습니다." };
  }

  const db = createServiceClient()!;
  // 성적 데이터 기반 리포트 생성은 중요행위(category=grade) — 감사 선기록 실패 시 저장하지 않는다(fail-closed).
  // 정정본 생성(supersedes)은 "새 본 생성 + 이전 본 철회·대체 연결"이 한 사건이므로 감사도 한 건으로 묶는다.
  const created = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: previous ? "report_supersede" : "report_create",
      targetType: "ai_report",
      // 대체 생성이면 전환 대상은 이전 본. 단독 생성은 생성 전이라 id 미정 — 원본 학생을 summary로 남긴다.
      targetId: previous?.id ?? null,
      summary: previous
        ? `${student.name} ${TYPE_LABEL[type]} 정정 리포트 생성 — 이전 본 철회·대체(${AUDIENCE_LABEL[audience]})`
        : `${student.name} ${TYPE_LABEL[type]} 리포트 생성(${AUDIENCE_LABEL[audience]}·${depth === "deep" ? "심화" : "기본"})`,
      category: "grade",
      ...(previous
        ? {
            before: { status: previous.status, supersededBy: null },
            after: { status: "retracted", supersededBy: "신규 정정본(draft)" },
            reason: "정정본 생성으로 이전 본 대체",
          }
        : {}),
    },
    async () => {
      const inserted = await createReportRow({
        tenantId: session.tenantId,
        studentId,
        type,
        audience,
        depth,
        content: generated.content + AI_REPORT_DISCLAIMER,
        modelUsed: generated.modelUsed ?? null,
        tokenUsage: generated.tokenUsage ?? null,
      });
      if (!inserted.ok || !previous) return inserted;

      // 이전 본 철회 + superseded_by 연결. 실패하면 방금 만든 초안을 회수(삭제)해
      // "대체 표시 없는 정정본"이 남지 않게 한다 — 초안은 게시 전(포털 비노출)이라
      // 삭제해도 승인된 사실을 지우는 것이 아니고, 감사 기록은 abort로 실패가 남는다.
      const linked = await retractReportRow(
        db,
        session.tenantId,
        previous,
        "정정본 생성으로 대체",
        inserted.id,
      );
      if (!linked.ok) {
        const { error: rollbackError } = await db
          .from("ai_reports")
          .delete()
          .eq("tenant_id", session.tenantId)
          .eq("id", inserted.id);
        if (rollbackError) {
          console.error("[reports] 대체 실패 후 초안 회수 실패 — 연결 없는 초안 잔존", rollbackError);
        }
        return {
          ok: false as const,
          error: `이전 본 대체 처리에 실패해 정정본 생성을 취소했습니다. (${linked.error})`,
        };
      }
      return inserted;
    },
  );
  if (!created.ok) return created;

  if (previous) revalidateReport(previous.id);
  revalidatePath("/admin/reports");
  return { ok: true, id: created.id };
}

export async function updateReportContent(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "");
  const content = String(formData.get("content") ?? "");
  if (!id) return { ok: false, error: "잘못된 요청입니다." };
  if (!content.trim()) return { ok: false, error: "내용을 입력해 주세요." };

  const report = await getReport(session.tenantId, id);
  if (!report) return { ok: false, error: "리포트를 찾을 수 없습니다." };
  if (report.status === "sent") return { ok: false, error: "발송 완료된 리포트는 수정할 수 없습니다." };
  // G-03 — 철회된 행이 곧 철회 이력이다: 본문을 덮어쓰지 않는다. 정정은 새 리포트(정정본 생성)로.
  if (report.status === "retracted") {
    return { ok: false, error: "철회된 리포트는 수정할 수 없습니다. 정정은 정정본 생성으로 진행해 주세요." };
  }

  const db = createServiceClient()!;
  // 성적 리포트 본문 수정도 중요행위(category=grade) — 감사 선기록 실패 시 수정하지 않는다(fail-closed).
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "report_update_content",
      targetType: "ai_report",
      targetId: id,
      summary: `리포트 본문 수정(${TYPE_LABEL[report.type]}·${AUDIENCE_LABEL[report.audience]})`,
      category: "grade",
    },
    async (): Promise<CrmActionResult> => {
      const { error } = await db
        .from("ai_reports")
        .update({ content })
        .eq("tenant_id", session.tenantId)
        .eq("id", id);
      if (error) {
        console.error("[reports] content update failed", error);
        return { ok: false, error: "리포트 저장 중 오류가 발생했습니다." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidateReport(id);
  return result;
}

export async function approveReport(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const report = await getReport(session.tenantId, id);
  if (!report) return { ok: false, error: "리포트를 찾을 수 없습니다." };
  // draft만 승인 — 철회본(retracted) 재승인 금지(재활성 금지): 재공개는 이전 본을 되돌리는 게
  // 아니라 정정본(새 리포트)을 생성해 검토·승인·게시하는 경로뿐이다(G-03).
  if (report.status !== "draft") return { ok: false, error: "초안 상태만 승인할 수 있습니다." };

  const db = createServiceClient()!;
  // 승인은 학부모 포털 노출(approved부터 열람 가능)로 이어지는 성적 전환 — 감사 선기록 실패 시 승인하지 않는다.
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "report_approve",
      targetType: "ai_report",
      targetId: id,
      summary: `리포트 승인(${TYPE_LABEL[report.type]}·${AUDIENCE_LABEL[report.audience]})`,
      category: "grade",
      before: { status: report.status },
      after: { status: "approved" },
    },
    async (): Promise<CrmActionResult> => {
      const { error } = await db
        .from("ai_reports")
        .update({ status: "approved" })
        .eq("tenant_id", session.tenantId)
        .eq("id", id);
      if (error) {
        console.error("[reports] approve failed", error);
        return { ok: false, error: "승인 처리 중 오류가 발생했습니다." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidateReport(id);
  return result;
}

export async function sendReport(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const report = await getReport(session.tenantId, id);
  if (!report) return { ok: false, error: "리포트를 찾을 수 없습니다." };
  // G-03 — 철회본 발송 금지: 철회 = 새 열람 차단이며, 재공개는 이전 본을 되돌리지 않고
  // 정정본(새 리포트)을 승인·발송하는 경로만 있다.
  if (report.status === "retracted") {
    return { ok: false, error: "철회된 리포트는 발송할 수 없습니다. 정정본을 생성해 승인·발송해 주세요." };
  }
  // 승인 이후에만 발송 가능. 발송 실패는 업무 상태가 아니라 전달 상태이므로(N-02)
  // approved(첫 발송·실패 재발송)와 sent(전달 실패 후 역전파 전 재발송) 모두 허용하되,
  // queued(야간 대기·Solapi 미설정 대기)는 크론 발송 예정 — 중복 발송을 막는다.
  if (report.status !== "approved" && report.status !== "sent") {
    return { ok: false, error: "승인된 리포트만 발송할 수 있습니다." };
  }
  if (report.deliveryStatus === "queued") {
    return { ok: false, error: "발송 대기 중인 리포트입니다. 다음 발송 슬롯에서 자동 발송됩니다." };
  }
  if (report.audience === "internal") return { ok: false, error: "내부용 리포트는 발송 대상이 없습니다." };
  if (!report.studentId) return { ok: false, error: "연결된 학생 정보가 없습니다." };

  const notifyType = notifyTypeFor(report.type);
  if (!notifyType) return { ok: false, error: "발송 대상 알림 유형이 없습니다." };

  const student = await getStudent(session.tenantId, report.studentId);
  if (!student) return { ok: false, error: "학생 정보를 찾을 수 없습니다." };

  const phone = report.audience === "student" ? student.studentPhone : student.parentPhone;
  if (!phone) return { ok: false, error: "발송할 연락처가 없습니다." };

  // 발송 클린 검사(기획안 §8) — 내부 표기·빈 섹션·실명이 남은 본문은 외부로 내보내지 않는다.
  // 승인 이후에도 본문을 수정할 수 있으므로 승인 시점이 아니라 발송 직전에 다시 본다.
  const issues = validateReportContent(report.content, {
    studentName: student.name,
    audience: report.audience,
  });
  if (hasBlockingIssue(issues)) {
    const reasons = issues
      .filter((i) => i.level === "block")
      .map((i) => (i.excerpt ? `${i.message} (${i.excerpt})` : i.message))
      .join(" / ");
    return { ok: false, error: `발송 전 확인이 필요합니다 — ${reasons}` };
  }

  if (!student.portalToken) {
    return {
      ok: false,
      error: "열람 링크가 없습니다. 학생 상세에서 리포트 링크를 재발급해 주세요.",
    };
  }

  // 리포트 전문을 문자로 보내지 않는다. 성적·학습 기록이 평문으로 단말·통신사 로그에 남고,
  // 카카오 알림톡은 사전 심사 고정 템플릿이라 가변 장문을 실을 수도 없다.
  // 고정 문구 + 열람 링크만 보내고 본문은 포털에서 읽게 한다(기획 7-10 · 알림 12종 ⑤⑥).
  const { settings } = await getSiteContent(session.tenantId);
  const portalUrl = `${SITE_URL}/portal/${student.portalToken}`;
  const message = `[${settings.brandName}] ${renderTemplate(notifyType, {
    name: student.name,
  })}\n${portalUrl}`;

  const db = createServiceClient()!;

  // 성적 리포트의 외부 발송은 중요행위(category=grade) — 감사 선기록 실패 시 발송하지 않는다(fail-closed).
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "report_send",
      targetType: "ai_report",
      targetId: id,
      summary: `${student.name} ${TYPE_LABEL[report.type]} 리포트 외부 발송(${AUDIENCE_LABEL[report.audience]})`,
      category: "grade",
    },
    async (): Promise<CrmActionResult> => {
      const sendResult = await sendNotification({
        tenantId: session.tenantId,
        studentId: student.id,
        type: notifyType,
        phone,
        message,
        isAd: false,
        reportId: id, // notifications.report_id — 큐 재발송의 지연 성공·실패도 delivery_status로 역전파된다.
      });

      if (!sendResult.ok) {
        if (sendResult.skipped) {
          // flush 크론이 같은 알림을 먼저 클레임한 경합 — 실패가 아니라 발송 진행 중이다.
          // delivery_status·오늘 업무를 건드리면 거짓 실패 신호가 되므로 그대로 두고 안내만 한다.
          return {
            ok: false,
            error: "이미 발송이 진행 중입니다 — 잠시 후 전달 상태를 확인해 주세요.",
          };
        }
        // 발송 실패 — 게시 상태(status)는 유지하고 전달 상태만 실패로 남긴다(N-02).
        // 승인된 리포트는 포털(approved·sent 노출)에서 계속 열람 가능해야 한다.
        console.error("[reports] send failed", sendResult.error);
        const { error } = await db
          .from("ai_reports")
          .update({ delivery_status: "failed" })
          .eq("tenant_id", session.tenantId)
          .eq("id", id);
        if (error) console.error("[reports] delivery_status failed 갱신 실패", error);
        // 열린 실패에는 담당자의 다음 행동이 있어야 한다 — 오늘 업무 큐로 수렴(한 사건 한 업무는 dedup이 보장).
        await createWorkItem(session.tenantId, {
          kind: "report_send_failed",
          title: `리포트 발송 실패 — ${student.name} ${TYPE_LABEL[report.type]}`,
          sourceType: "ai_report",
          sourceId: id,
          nextAction: "발송 실패 확인 후 재발송",
          detail: sendResult.error ?? null,
          priority: "normal",
        });
        return { ok: false, error: sendResult.error ?? "발송에 실패했습니다." };
      }

      if (sendResult.queued) {
        // Solapi 미설정·야간 대기 — 실발송 전이므로 sent로 확정하지 않는다(결과 불명은 성공이 아니다).
        // 업무 상태는 approved 그대로, 전달 상태만 queued. 실발송 성공 시 dispatchQueued가 sent로 역전파한다.
        const { error } = await db
          .from("ai_reports")
          .update({ delivery_status: "queued" })
          .eq("tenant_id", session.tenantId)
          .eq("id", id);
        if (error) console.error("[reports] delivery_status queued 갱신 실패", error);
        return { ok: true };
      }

      // 실발송 성공 — 이때만 업무 상태를 sent로 확정한다.
      const { error } = await db
        .from("ai_reports")
        .update({ status: "sent", delivery_status: "sent", sent_at: new Date().toISOString() })
        .eq("tenant_id", session.tenantId)
        .eq("id", id);
      if (error) {
        // 발송 자체는 성공(외부 API 응답 확인) — 여기서 실패로 되돌리면 실제 발송과 기록이 어긋난다.
        // 직전에 dispatchQueued의 역전파(propagateReportDelivery)가 같은 갱신을 이미 시도했으므로
        // 보통은 반영돼 있다. 성공은 유지하고 로그만 남긴다(업무 성공과 기록 갱신을 분리).
        console.error("[reports] sent status update failed", error);
      }
      return { ok: true };
    },
  );

  revalidateReport(id);
  return result;
}

/**
 * G-03 철회 — "새 열람 차단 → 철회 이력 보존".
 * 게시(승인·발송)된 본만 대상이며, 포털은 listPortalReports의 approved·sent 필터로
 * retracted를 자동 제외한다(공유 경로 접근 회수). 행·사유·시각은 보존되고,
 * 재공개는 정정본(새 리포트) 생성·재승인·게시로만 가능하다(재활성 금지).
 */
export async function retractReport(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!id) return { ok: false, error: "잘못된 요청입니다." };
  // 사유 없는 철회는 없다(00016 retract_reason — 철회 이력의 일부).
  if (!reason) return { ok: false, error: "철회 사유를 입력해 주세요." };

  const report = await getReport(session.tenantId, id);
  if (!report) return { ok: false, error: "리포트를 찾을 수 없습니다." };
  if (report.status === "retracted") return { ok: false, error: "이미 철회된 리포트입니다." };
  if (report.status !== "approved" && report.status !== "sent") {
    return {
      ok: false,
      error: "게시(승인·발송)된 리포트만 철회할 수 있습니다. 초안은 승인하지 않으면 노출되지 않습니다.",
    };
  }

  const db = createServiceClient()!;
  // 철회는 포털 노출 차단·발송 회수로 이어지는 성적 전환 — 감사 선기록 실패 시 철회하지 않는다(fail-closed).
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "report_retract",
      targetType: "ai_report",
      targetId: id,
      summary: `리포트 철회(${TYPE_LABEL[report.type]}·${AUDIENCE_LABEL[report.audience]})`,
      category: "grade",
      before: { status: report.status },
      after: { status: "retracted" },
      reason,
    },
    () => retractReportRow(db, session.tenantId, report, reason),
  );
  if (!result.ok) return result;

  revalidateReport(id);
  return result;
}
