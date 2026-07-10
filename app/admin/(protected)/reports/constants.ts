import type { AiReport, ReportAudience, ReportType } from "@/lib/types";
import type { NotifyType } from "@/lib/notify/templates";

// components/ui/badge.tsx가 BadgeTone을 export하지 않아 동일한 값 집합을 로컬로 정의(consultations/constants.ts와 동일 패턴).
type BadgeTone = "brand" | "soft" | "success" | "warning" | "danger";

export const REPORT_TYPE_OPTIONS: { value: ReportType; label: string }[] = [
  { value: "lesson", label: "수업" },
  { value: "weekly", label: "주간" },
  { value: "monthly", label: "월간" },
  { value: "exam", label: "시험" },
  { value: "consult_brief", label: "상담 브리핑" },
];

export function reportTypeLabel(type: ReportType): string {
  return REPORT_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

export const REPORT_AUDIENCE_OPTIONS: { value: ReportAudience; label: string }[] = [
  { value: "parent", label: "학부모" },
  { value: "student", label: "학생" },
  { value: "internal", label: "내부" },
];

export function reportAudienceLabel(audience: ReportAudience): string {
  return REPORT_AUDIENCE_OPTIONS.find((o) => o.value === audience)?.label ?? audience;
}

const STATUS_LABEL: Record<AiReport["status"], string> = {
  draft: "초안",
  approved: "승인됨",
  sent: "발송완료",
  failed: "발송실패",
};

const STATUS_TONE: Record<AiReport["status"], BadgeTone> = {
  draft: "soft",
  approved: "brand",
  sent: "success",
  failed: "danger",
};

export function reportStatusLabel(status: AiReport["status"]): string {
  return STATUS_LABEL[status];
}

export function reportStatusTone(status: AiReport["status"]): BadgeTone {
  return STATUS_TONE[status];
}

/**
 * ai_reports.type → 알림 발송 type 키 매핑. consult_brief(내부용)는 발송 대상이 없어 제외.
 * 값 타입은 반드시 NotifyType — string으로 두면 템플릿에 없는 키를 넣어도 컴파일이 통과한다
 * (실제로 exam_report가 그렇게 누락돼 시험 리포트가 알림톡으로 나가지 못했다).
 */
export const REPORT_NOTIFY_TYPE: Record<Exclude<ReportType, "consult_brief">, NotifyType> = {
  lesson: "lesson_report",
  weekly: "weekly_report",
  monthly: "monthly_report",
  exam: "exam_report",
};

export const AI_REPORT_DISCLAIMER = "\n\n※ 본 리포트는 AI가 생성한 참고용 자료입니다.";
