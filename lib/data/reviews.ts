import { createServiceClient } from "@/lib/supabase/server";
import type {
  Review,
  ReviewInvitation,
  ReviewInvitationStatus,
  ReviewKind,
  ReviewStatus,
} from "@/lib/types";

// 후기·성적사례 워크플로 데이터(00025 · S-01·S-03) — 작성 초대(review_invitations)와
// 검토 이력이 붙은 후기 행(ReviewRecord)의 유일한 조회·매핑 모듈.
//
// 공개 로더(lib/data/content.ts)는 published만, 관리자 CRUD 조회(lib/data/crm.ts)는 Review까지만
// 안다. 상태 전환·초대·작성 화면은 전부 여기서 읽는다 — 매핑이 갈라지면 같은 행을 두 화면이
// 다르게 보여 주게 되므로 새 호출부는 이 파일을 쓴다.

/* ---------- 라벨 ---------- */

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  draft: "제출됨(대필)",
  submitted: "제출됨",
  in_review: "검토 중",
  revision_requested: "수정 요청됨",
  rejected: "반려됨",
  approved: "승인됨",
  published: "게시 중",
  retracted: "철회됨",
};

export const REVIEW_KIND_LABEL: Record<ReviewKind, string> = {
  review: "후기",
  case: "성적 향상 사례",
};

export const REVIEW_INVITATION_STATUS_LABEL: Record<ReviewInvitationStatus, string> = {
  sent: "발송됨",
  submitted: "제출 완료",
  closed: "닫힘",
  expired: "만료",
};

/** 검토 대기열에 들어가는 상태 — 운영자가 손을 대야 하는 것들. */
export const REVIEW_OPEN_STATUSES: ReviewStatus[] = [
  "draft",
  "submitted",
  "in_review",
  "approved",
];

/* ---------- 후기 행(검토 이력 포함) ---------- */

export interface ReviewRecord extends Review {
  status: ReviewStatus;
  studentId: string | null;
  authorName: string | null;
  authorPhone: string | null;
  isMinor: boolean;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianVerifiedAt: string | null;
  guardianVerifiedBy: string | null;
  invitationId: string | null;
  submittedAt: string | null;
  reviewStartedAt: string | null;
  revisionRequestedAt: string | null;
  revisionNote: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  approvedAt: string | null;
  maskingConfirmedAt: string | null;
  maskingConfirmedBy: string | null;
  publishedAt: string | null;
  retractedAt: string | null;
  retractReason: string | null;
  retractedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewRecordRow {
  id: string;
  kind: ReviewKind | null;
  reviewer_type: Review["reviewerType"];
  content: string;
  rating: number;
  before_grade: string | null;
  after_grade: string | null;
  meta: {
    region?: string;
    grade?: string;
    track?: string;
    source?: string;
    reviewed_at?: string;
    before_label?: string;
    after_label?: string;
  } | null;
  screenshots: string[] | null;
  ai_tags: string[] | null;
  is_pinned: boolean;
  status: ReviewStatus;
  student_id: string | null;
  public_name: string | null;
  images_public: boolean | null;
  author_name: string | null;
  author_phone: string | null;
  is_minor: boolean | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  guardian_verified_at: string | null;
  guardian_verified_by: string | null;
  invitation_id: string | null;
  submitted_at: string | null;
  review_started_at: string | null;
  revision_requested_at: string | null;
  revision_note: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  approved_at: string | null;
  masking_confirmed_at: string | null;
  masking_confirmed_by: string | null;
  published_at: string | null;
  retracted_at: string | null;
  retract_reason: string | null;
  retracted_by: string | null;
  created_at: string;
  updated_at: string;
}

export function mapReviewRecord(row: ReviewRecordRow): ReviewRecord {
  return {
    id: row.id,
    kind: row.kind ?? "review",
    reviewerType: row.reviewer_type,
    content: row.content,
    rating: row.rating,
    beforeGrade: row.before_grade,
    afterGrade: row.after_grade,
    beforeLabel: row.meta?.before_label ?? null,
    afterLabel: row.meta?.after_label ?? null,
    region: row.meta?.region ?? null,
    grade: row.meta?.grade ?? null,
    track: row.meta?.track ?? null,
    source: row.meta?.source ?? null,
    reviewedAt: row.meta?.reviewed_at ?? null,
    publicName: row.public_name ?? null,
    imagesPublic: row.images_public ?? true,
    // 관리자 검토 근거 — 공개 동의와 무관하게 전부 싣는다(공개면은 content.ts가 따로 거른다).
    screenshots: row.screenshots ?? [],
    aiTags: row.ai_tags ?? [],
    isPinned: row.is_pinned,
    status: row.status,
    studentId: row.student_id,
    authorName: row.author_name,
    authorPhone: row.author_phone,
    isMinor: row.is_minor ?? false,
    guardianName: row.guardian_name,
    guardianPhone: row.guardian_phone,
    guardianVerifiedAt: row.guardian_verified_at,
    guardianVerifiedBy: row.guardian_verified_by,
    invitationId: row.invitation_id,
    submittedAt: row.submitted_at,
    reviewStartedAt: row.review_started_at,
    revisionRequestedAt: row.revision_requested_at,
    revisionNote: row.revision_note,
    rejectedAt: row.rejected_at,
    rejectReason: row.reject_reason,
    approvedAt: row.approved_at,
    maskingConfirmedAt: row.masking_confirmed_at,
    maskingConfirmedBy: row.masking_confirmed_by,
    publishedAt: row.published_at,
    retractedAt: row.retracted_at,
    retractReason: row.retract_reason,
    retractedBy: row.retracted_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listReviewRecords(
  tenantId: string,
  filter: { status?: ReviewStatus | ReviewStatus[]; kind?: ReviewKind } = {},
): Promise<ReviewRecord[]> {
  const db = createServiceClient();
  if (!db) return [];
  let query = db
    .from("reviews")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("is_pinned", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (filter.status) {
    query = Array.isArray(filter.status)
      ? query.in("status", filter.status)
      : query.eq("status", filter.status);
  }
  if (filter.kind) query = query.eq("kind", filter.kind);
  const { data, error } = await query;
  if (error) {
    console.error("[reviews] 목록 조회 실패", error);
    return [];
  }
  return ((data ?? []) as ReviewRecordRow[]).map(mapReviewRecord);
}

export async function getReviewRecord(
  tenantId: string,
  id: string,
): Promise<ReviewRecord | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data, error } = await db
    .from("reviews")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[reviews] 조회 실패", error);
    return null;
  }
  return data ? mapReviewRecord(data as ReviewRecordRow) : null;
}

/* ---------- 작성 초대 ---------- */

interface InvitationRow {
  id: string;
  student_id: string | null;
  student_name: string;
  author_role: ReviewInvitation["authorRole"];
  author_name: string;
  author_phone: string;
  status: ReviewInvitationStatus;
  review_id: string | null;
  sent_at: string;
  expires_at: string | null;
  submitted_at: string | null;
  closed_at: string | null;
  close_reason: string | null;
  created_by: string | null;
}

const INVITATION_COLUMNS =
  "id, student_id, student_name, author_role, author_name, author_phone, status, review_id, sent_at, expires_at, submitted_at, closed_at, close_reason, created_by";

function mapInvitation(row: InvitationRow, now = Date.now()): ReviewInvitation {
  const expired = row.expires_at ? new Date(row.expires_at).getTime() <= now : false;
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    authorRole: row.author_role,
    authorName: row.author_name,
    authorPhone: row.author_phone,
    status: row.status,
    reviewId: row.review_id,
    sentAt: row.sent_at,
    expiresAt: row.expires_at,
    submittedAt: row.submitted_at,
    closedAt: row.closed_at,
    closeReason: row.close_reason,
    createdBy: row.created_by,
    isOpen: row.status === "sent" && !expired,
  };
}

export async function listReviewInvitations(
  tenantId: string,
  filter: { studentId?: string; reviewId?: string; status?: ReviewInvitationStatus } = {},
): Promise<ReviewInvitation[]> {
  const db = createServiceClient();
  if (!db) return [];
  let query = db
    .from("review_invitations")
    .select(INVITATION_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("sent_at", { ascending: false });
  if (filter.studentId) query = query.eq("student_id", filter.studentId);
  if (filter.reviewId) query = query.eq("review_id", filter.reviewId);
  if (filter.status) query = query.eq("status", filter.status);
  const { data, error } = await query;
  if (error) {
    console.error("[reviews] 초대 목록 조회 실패", error);
    return [];
  }
  const now = Date.now();
  return ((data ?? []) as unknown as InvitationRow[]).map((r) => mapInvitation(r, now));
}

export async function getReviewInvitation(
  tenantId: string,
  id: string,
): Promise<ReviewInvitation | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data, error } = await db
    .from("review_invitations")
    .select(INVITATION_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[reviews] 초대 조회 실패", error);
    return null;
  }
  return data ? mapInvitation(data as unknown as InvitationRow) : null;
}

/**
 * 토큰 해시로 초대를 찾는다(공개 작성 화면·제출 액션). 못 찾아도 이유를 만들지 않는다(null 하나로 수렴).
 * 수정 요청 재발급(review_id 있음)이면 기존 본을 함께 돌려줘 작성 화면이 채워 넣게 한다.
 */
export async function getInvitationByTokenHash(
  tenantId: string,
  tokenHash: string,
): Promise<(ReviewInvitation & { review: ReviewRecord | null }) | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data, error } = await db
    .from("review_invitations")
    .select(INVITATION_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) {
    console.error("[reviews] 초대 토큰 조회 실패", error);
    return null;
  }
  if (!data) return null;
  const invitation = mapInvitation(data as unknown as InvitationRow);
  const review = invitation.reviewId
    ? await getReviewRecord(tenantId, invitation.reviewId)
    : null;
  return { ...invitation, review };
}
