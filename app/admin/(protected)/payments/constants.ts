import type { PaymentMethod, PaymentStatus } from "@/lib/types";

// components/ui/badge.tsx가 BadgeTone을 export하지 않아 동일한 값 집합을 로컬로 정의.
type BadgeTone = "brand" | "soft" | "success" | "warning" | "danger";

export const PAYMENT_STATUS_OPTIONS: { value: PaymentStatus; label: string }[] = [
  { value: "draft", label: "작성 중" },
  { value: "pending", label: "청구" },
  { value: "paid", label: "완납" },
  { value: "overdue", label: "미납" },
];

const STATUS_TONE: Record<PaymentStatus, BadgeTone> = {
  draft: "soft",
  pending: "warning",
  paid: "success",
  overdue: "danger",
};

export function paymentStatusLabel(status: PaymentStatus): string {
  return PAYMENT_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
}

export function paymentStatusTone(status: PaymentStatus): BadgeTone {
  return STATUS_TONE[status];
}

export const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "toss", label: "토스 링크" },
  { value: "payssaem", label: "결제선생" },
  { value: "bank", label: "계좌이체" },
];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  toss: "토스 링크",
  payssaem: "결제선생",
  bank: "계좌이체",
};

export function paymentMethodLabel(method: PaymentMethod): string {
  return PAYMENT_METHOD_LABEL[method] ?? method;
}
