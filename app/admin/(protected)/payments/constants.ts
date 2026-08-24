import type { PaymentMethod, PaymentStatus } from "@/lib/types";

type BadgeTone = "brand" | "soft" | "success" | "warning" | "danger";

/**
 * 00014에서 payments.status에 'refunded'가 추가됐다(검수 45 — 환불 완료는 paid의 소멸이
 * 아니라 별도 업무 상태). lib/types.ts PaymentStatus 유니온에는 아직 없어 화면 계층에서
 * 확장 타입으로 다룬다 — DB 원본이 'refunded'를 돌려줘도 라벨·톤이 깨지지 않아야 한다.
 */
export type PaymentStatusEx = PaymentStatus | "refunded";

export const PAYMENT_STATUS_OPTIONS: { value: PaymentStatusEx; label: string }[] = [
  { value: "draft", label: "작성 중" },
  { value: "pending", label: "청구" },
  { value: "paid", label: "완납" },
  { value: "overdue", label: "미납" },
  { value: "refunded", label: "환불" },
];

const STATUS_TONE: Record<PaymentStatusEx, BadgeTone> = {
  draft: "soft",
  pending: "warning",
  paid: "success",
  overdue: "danger",
  refunded: "soft",
};

export function paymentStatusLabel(status: PaymentStatusEx): string {
  return PAYMENT_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
}

export function paymentStatusTone(status: PaymentStatusEx): BadgeTone {
  return STATUS_TONE[status] ?? "soft";
}

export const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "bank", label: "계좌이체(무통장입금)" },
  { value: "payssaem", label: "결제선생" },
];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  payssaem: "결제선생",
  bank: "계좌이체(무통장입금)",
};

export function paymentMethodLabel(method: PaymentMethod): string {
  return PAYMENT_METHOD_LABEL[method] ?? method;
}

/* ---------- 결제선생 외부 승인 스냅샷(appr_state) 라벨·톤 ----------
   F/W/C/D는 결제선생이 알려준 외부 사실의 스냅샷이며 업무 상태(status)와 분리 표기한다
   (flow-canon M0 분리 원칙 — 두 계열을 한 뱃지로 섞으면 /bill/read 대조가 무의미해진다). */

export const PAYSSAM_APPR_STATE_LABEL: Record<string, string> = {
  W: "발송됨·미결제",
  F: "결제완료",
  C: "취소",
  D: "파기",
};

const PAYSSAM_APPR_STATE_TONE: Record<string, BadgeTone> = {
  W: "warning",
  F: "success",
  C: "danger",
  D: "soft",
};

export function payssamApprStateLabel(state: string | null | undefined): string {
  if (!state) return "-";
  return PAYSSAM_APPR_STATE_LABEL[state] ?? state;
}

export function payssamApprStateTone(state: string | null | undefined): BadgeTone {
  if (!state) return "soft";
  return PAYSSAM_APPR_STATE_TONE[state] ?? "soft";
}

/** 현금영수증 발급 구분 라벨 — 스펙 trader: 개인(소득공제) "0" | 사업자(지출증빙) "1" */
export const PAYSSAM_CASH_TRADER_LABEL: Record<string, string> = {
  "0": "개인(소득공제)",
  "1": "사업자(지출증빙)",
};

export function payssamCashTraderLabel(trader: string | null | undefined): string {
  if (!trader) return "-";
  return PAYSSAM_CASH_TRADER_LABEL[trader] ?? trader;
}

/** 결제선생 발송 재화 — 카카오톡 청구서 1건당 차감 포인트(재발송도 재차감). */
export const PAYSSAM_POINT_PER_SEND = 55;
/** 잔액 경고 기준 — 100건(5,500P) 미만이면 충전을 안내한다(검수 38 잔액 소진 대비). */
export const PAYSSAM_POINT_WARN_THRESHOLD = 5500;
