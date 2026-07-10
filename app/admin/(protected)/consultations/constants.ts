import type { ConsentItem, ConsultationStatus } from "@/lib/types";

// components/ui/badge.tsx가 BadgeTone을 export하지 않아 동일한 값 집합을 로컬로 정의.
type BadgeTone = "brand" | "soft" | "success" | "warning" | "danger";

export const CONSULTATION_STATUS_OPTIONS: { value: ConsultationStatus; label: string }[] = [
  { value: "new", label: "신규" },
  { value: "contacted", label: "연락" },
  { value: "trial", label: "시범" },
  { value: "registered", label: "등록" },
  { value: "hold", label: "보류" },
];

const STATUS_TONE: Record<ConsultationStatus, BadgeTone> = {
  new: "brand",
  contacted: "soft",
  trial: "warning",
  registered: "success",
  hold: "danger",
};

export function consultationStatusLabel(status: ConsultationStatus): string {
  return CONSULTATION_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
}

export function consultationStatusTone(status: ConsultationStatus): BadgeTone {
  return STATUS_TONE[status];
}

const CONSENT_ITEM_LABEL: Record<ConsentItem, string> = {
  privacy: "개인정보 처리방침",
  overseas_ai: "해외 AI 처리 위탁",
  marketing: "마케팅 정보 수신",
  review: "후기 활용",
  student_phone: "학생 연락처 수집",
};

export function consentItemLabel(item: ConsentItem): string {
  return CONSENT_ITEM_LABEL[item] ?? item;
}
