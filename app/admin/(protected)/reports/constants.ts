import type { AiReport, ReportAudience, ReportType } from "@/lib/types";
import type { NotifyType } from "@/lib/notify/templates";

// badge.tsx가 BadgeTone을 export하지 않아 로컬 재정의.
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

// 업무 상태(초안→승인→발송완료, 철회)와 전달 상태(delivery_status)를 분리 표시한다(N-02).
// 발송 실패는 업무 상태가 아니라 전달 상태 — 승인된 리포트는 실패해도 승인 뱃지를 유지한다.
// retracted(G-03)는 삭제가 아니라 "새 열람 차단 + 철회 이력 보존" — 행은 남고 포털 비노출.
const STATUS_LABEL: Record<AiReport["status"], string> = {
  draft: "초안",
  approved: "승인됨",
  sent: "발송완료",
  retracted: "철회됨",
};

const STATUS_TONE: Record<AiReport["status"], BadgeTone> = {
  draft: "soft",
  approved: "brand",
  sent: "success",
  retracted: "danger",
};

export function reportStatusLabel(status: AiReport["status"]): string {
  return STATUS_LABEL[status];
}

export function reportStatusTone(status: AiReport["status"]): BadgeTone {
  return STATUS_TONE[status];
}

const DELIVERY_LABEL: Record<AiReport["deliveryStatus"], string> = {
  none: "미발송",
  queued: "발송 대기",
  sent: "전달 완료",
  failed: "발송 실패",
};

const DELIVERY_TONE: Record<AiReport["deliveryStatus"], BadgeTone> = {
  none: "soft",
  queued: "warning",
  sent: "success",
  failed: "danger",
};

export function reportDeliveryLabel(status: AiReport["deliveryStatus"]): string {
  return DELIVERY_LABEL[status];
}

export function reportDeliveryTone(status: AiReport["deliveryStatus"]): BadgeTone {
  return DELIVERY_TONE[status];
}

/**
 * ai_reports.type → 알림 type 키 매핑(consult_brief는 발송 대상 없어 제외).
 * 값 타입은 반드시 NotifyType — string이면 템플릿에 없는 키도 컴파일을 통과한다(과거 exam_report 누락 사고).
 */
export const REPORT_NOTIFY_TYPE: Record<Exclude<ReportType, "consult_brief">, NotifyType> = {
  lesson: "lesson_report",
  weekly: "weekly_report",
  monthly: "monthly_report",
  exam: "exam_report",
};

export const AI_REPORT_DISCLAIMER = "\n\n※ 본 리포트는 AI가 생성한 참고용 자료입니다.";
