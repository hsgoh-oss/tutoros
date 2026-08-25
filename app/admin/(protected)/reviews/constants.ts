import type { Review, ReviewStatus } from "@/lib/types";

export const REVIEWER_TYPE_OPTIONS: { value: Review["reviewerType"]; label: string }[] = [
  { value: "student", label: "학생" },
  { value: "parent", label: "학부모" },
];

export function reviewerTypeLabel(type: Review["reviewerType"]): string {
  return REVIEWER_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

export const RATING_OPTIONS = [5, 4, 3, 2, 1];

/** 게시 상태 라벨(S-01 승인 게시 흐름 — draft는 승인 전 비공개). */
export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  draft: "승인 대기",
  approved: "게시 대기",
  published: "게시 중",
  retracted: "철회됨",
};

export function reviewStatusLabel(status: ReviewStatus | undefined): string {
  return status ? REVIEW_STATUS_LABELS[status] : "-";
}
