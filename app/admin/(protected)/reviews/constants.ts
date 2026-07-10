import type { Review } from "@/lib/types";

export const REVIEWER_TYPE_OPTIONS: { value: Review["reviewerType"]; label: string }[] = [
  { value: "student", label: "학생" },
  { value: "parent", label: "학부모" },
];

export function reviewerTypeLabel(type: Review["reviewerType"]): string {
  return REVIEWER_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

export const RATING_OPTIONS = [5, 4, 3, 2, 1];
