import type { Review, ReviewInvitationStatus, ReviewKind, ReviewStatus } from "@/lib/types";
import {
  REVIEW_INVITATION_STATUS_LABEL,
  REVIEW_KIND_LABEL,
  REVIEW_STATUS_LABEL,
} from "@/lib/data/reviews";

type BadgeTone = "brand" | "soft" | "success" | "warning" | "danger";

export const REVIEWER_TYPE_OPTIONS: { value: Review["reviewerType"]; label: string }[] = [
  { value: "student", label: "학생 본인" },
  { value: "parent", label: "보호자" },
];

export function reviewerTypeLabel(type: Review["reviewerType"]): string {
  return REVIEWER_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

/** 상태 라벨 — 단일 원천은 lib/data/reviews.ts. 화면은 여기서만 읽는다. */
export function reviewStatusLabel(status: ReviewStatus | undefined): string {
  return status ? REVIEW_STATUS_LABEL[status] : "-";
}

export function reviewKindLabel(kind: ReviewKind): string {
  return REVIEW_KIND_LABEL[kind];
}

/** 배지 톤 — 제출·수정 요청은 "손이 필요하다"(warning), 검토 중·승인은 "진행 중"(brand). */
const STATUS_TONE: Record<ReviewStatus, BadgeTone> = {
  draft: "warning",
  submitted: "warning",
  in_review: "brand",
  revision_requested: "warning",
  rejected: "danger",
  approved: "brand",
  published: "success",
  retracted: "soft",
};

export function reviewStatusTone(status: ReviewStatus | undefined): BadgeTone {
  return status ? STATUS_TONE[status] : "soft";
}

export function invitationStatusLabel(status: ReviewInvitationStatus): string {
  return REVIEW_INVITATION_STATUS_LABEL[status];
}

export function invitationStatusTone(status: ReviewInvitationStatus): BadgeTone {
  if (status === "sent") return "brand";
  if (status === "submitted") return "success";
  return "soft";
}

/** 목록 필터 — 상태 묶음. open(기본)은 운영자가 손을 대야 하는 것들. */
export const REVIEW_FILTERS: { value: string; label: string; statuses: ReviewStatus[] | null }[] = [
  { value: "open", label: "검토 대기", statuses: ["draft", "submitted", "in_review", "approved"] },
  { value: "published", label: "게시 중", statuses: ["published"] },
  { value: "revision_requested", label: "수정 요청", statuses: ["revision_requested"] },
  { value: "rejected", label: "반려", statuses: ["rejected"] },
  { value: "retracted", label: "철회", statuses: ["retracted"] },
  { value: "all", label: "전체", statuses: null },
];
