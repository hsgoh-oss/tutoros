import type {
  HomeworkAnswerStatus,
  HomeworkFeedbackStatus,
  HomeworkQuestionStatus,
  HomeworkReviewResult,
  HomeworkReviewStatus,
  HomeworkStatus,
} from "@/lib/types";

// 과제 상태·검토·피드백·질의응답 라벨/톤 — reports/constants.ts 관례를 따른다.
// 정본: docs/flow-canon/01_atlas_03_learning.md H-01~H-07.

// badge.tsx가 BadgeTone을 export하지 않아 로컬 재정의(reports/constants.ts와 동일).
type BadgeTone = "brand" | "soft" | "success" | "warning" | "danger";

/* ---------- 과제 상태 (H-01·H-07) ---------- */

export const HOMEWORK_STATUS_OPTIONS: { value: HomeworkStatus; label: string }[] = [
  { value: "draft", label: "초안" },
  { value: "assigned", label: "배부됨" },
  { value: "closed", label: "종료" },
  { value: "canceled", label: "취소" },
];

// draft는 학생·보호자 비노출(H-01) — soft 톤으로 "아직 외부에 없는 상태"임을 드러낸다.
const STATUS_LABEL: Record<HomeworkStatus, string> = {
  draft: "초안",
  assigned: "배부됨",
  closed: "종료",
  canceled: "취소",
};

const STATUS_TONE: Record<HomeworkStatus, BadgeTone> = {
  draft: "soft",
  assigned: "brand",
  closed: "success",
  canceled: "danger",
};

export function homeworkStatusLabel(status: HomeworkStatus): string {
  return STATUS_LABEL[status];
}

export function homeworkStatusTone(status: HomeworkStatus): BadgeTone {
  return STATUS_TONE[status];
}

export function isHomeworkStatus(value: string | undefined): value is HomeworkStatus {
  return HOMEWORK_STATUS_OPTIONS.some((o) => o.value === value);
}

/* ---------- 제출 검토 (H-02·H-03 · 검수 126) ---------- */

const REVIEW_STATUS_LABEL: Record<HomeworkReviewStatus, string> = {
  pending: "검토 대기",
  reviewed: "검토 완료",
};

const REVIEW_STATUS_TONE: Record<HomeworkReviewStatus, BadgeTone> = {
  pending: "warning",
  reviewed: "success",
};

export function reviewStatusLabel(status: HomeworkReviewStatus): string {
  return REVIEW_STATUS_LABEL[status];
}

export function reviewStatusTone(status: HomeworkReviewStatus): BadgeTone {
  return REVIEW_STATUS_TONE[status];
}

export const REVIEW_RESULT_OPTIONS: { value: HomeworkReviewResult; label: string }[] = [
  { value: "complete", label: "완료" },
  { value: "resubmit", label: "재제출 요청(보완 필요)" },
];

const REVIEW_RESULT_LABEL: Record<HomeworkReviewResult, string> = {
  complete: "완료",
  resubmit: "재제출 요청",
};

const REVIEW_RESULT_TONE: Record<HomeworkReviewResult, BadgeTone> = {
  complete: "success",
  resubmit: "warning",
};

export function reviewResultLabel(result: HomeworkReviewResult): string {
  return REVIEW_RESULT_LABEL[result];
}

export function reviewResultTone(result: HomeworkReviewResult): BadgeTone {
  return REVIEW_RESULT_TONE[result];
}

export function isReviewResult(value: string): value is HomeworkReviewResult {
  return REVIEW_RESULT_OPTIONS.some((o) => o.value === value);
}

/* ---------- 피드백 상태 (검수 28 — 미승인 비노출) ---------- */

const FEEDBACK_STATUS_LABEL: Record<HomeworkFeedbackStatus, string> = {
  draft: "피드백 초안(비노출)",
  approved: "피드백 게시됨",
};

const FEEDBACK_STATUS_TONE: Record<HomeworkFeedbackStatus, BadgeTone> = {
  draft: "soft",
  approved: "success",
};

export function feedbackStatusLabel(status: HomeworkFeedbackStatus): string {
  return FEEDBACK_STATUS_LABEL[status];
}

export function feedbackStatusTone(status: HomeworkFeedbackStatus): BadgeTone {
  return FEEDBACK_STATUS_TONE[status];
}

/* ---------- 질의응답 (H-04 · 검수 29) ---------- */

const QUESTION_STATUS_LABEL: Record<HomeworkQuestionStatus, string> = {
  open: "답변 대기",
  resolved: "해결 완료",
};

const QUESTION_STATUS_TONE: Record<HomeworkQuestionStatus, BadgeTone> = {
  open: "warning",
  resolved: "soft",
};

export function questionStatusLabel(status: HomeworkQuestionStatus): string {
  return QUESTION_STATUS_LABEL[status];
}

export function questionStatusTone(status: HomeworkQuestionStatus): BadgeTone {
  return QUESTION_STATUS_TONE[status];
}

const ANSWER_STATUS_LABEL: Record<HomeworkAnswerStatus, string> = {
  draft: "답변 초안(비노출)",
  approved: "답변 게시됨",
};

const ANSWER_STATUS_TONE: Record<HomeworkAnswerStatus, BadgeTone> = {
  draft: "soft",
  approved: "success",
};

export function answerStatusLabel(status: HomeworkAnswerStatus): string {
  return ANSWER_STATUS_LABEL[status];
}

export function answerStatusTone(status: HomeworkAnswerStatus): BadgeTone {
  return ANSWER_STATUS_TONE[status];
}
