"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { getStudent, listGrades, listLessons } from "@/lib/data/crm";
import { createReportRow, getReport } from "@/lib/data/reports";
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

  const created = await createReportRow({
    tenantId: session.tenantId,
    studentId,
    type,
    audience,
    depth,
    content: generated.content + AI_REPORT_DISCLAIMER,
    modelUsed: generated.modelUsed ?? null,
    tokenUsage: generated.tokenUsage ?? null,
  });
  if (!created.ok) return created;

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

  const db = createServiceClient()!;
  const { error } = await db
    .from("ai_reports")
    .update({ content })
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[reports] content update failed", error);
    return { ok: false, error: "리포트 저장 중 오류가 발생했습니다." };
  }

  revalidateReport(id);
  return { ok: true };
}

export async function approveReport(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const report = await getReport(session.tenantId, id);
  if (!report) return { ok: false, error: "리포트를 찾을 수 없습니다." };
  if (report.status !== "draft") return { ok: false, error: "초안 상태만 승인할 수 있습니다." };

  const db = createServiceClient()!;
  const { error } = await db
    .from("ai_reports")
    .update({ status: "approved" })
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[reports] approve failed", error);
    return { ok: false, error: "승인 처리 중 오류가 발생했습니다." };
  }

  revalidateReport(id);
  return { ok: true };
}

export async function sendReport(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const report = await getReport(session.tenantId, id);
  if (!report) return { ok: false, error: "리포트를 찾을 수 없습니다." };
  // 승인 상태 또는 이전 발송 실패(재시도) 상태에서만 발송 가능.
  if (report.status !== "approved" && report.status !== "failed") {
    return { ok: false, error: "승인된 리포트만 발송할 수 있습니다." };
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

  const result = await sendNotification({
    tenantId: session.tenantId,
    studentId: student.id,
    type: notifyType,
    phone,
    message,
    isAd: false,
  });

  if (!result.ok) {
    console.error("[reports] send failed", result.error);
    await db
      .from("ai_reports")
      .update({ status: "failed" })
      .eq("tenant_id", session.tenantId)
      .eq("id", id);
    revalidateReport(id);
    return { ok: false, error: result.error ?? "발송에 실패했습니다." };
  }

  const { error } = await db
    .from("ai_reports")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[reports] sent status update failed", error);
    return { ok: false, error: "발송은 완료됐으나 상태 갱신에 실패했습니다." };
  }

  revalidateReport(id);
  return { ok: true };
}
