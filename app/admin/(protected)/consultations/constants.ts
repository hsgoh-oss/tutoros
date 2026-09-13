import type { ConsentItem, ConsultationStatus } from "@/lib/types";

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
  terms: "이용약관(필수)",
  privacy: "상담 개인정보 처리(필수)",
  overseas_ai: "AI 처리·국외이전(선택)",
  marketing: "마케팅 수신(선택)",
  review: "후기·사례 공개(건별)",
  review_image: "사례 이미지 공개",
  guardian: "법정대리인 동의",
  student_phone: "학생 연락처 수집",
};

export function consentItemLabel(item: ConsentItem): string {
  return CONSENT_ITEM_LABEL[item] ?? item;
}
