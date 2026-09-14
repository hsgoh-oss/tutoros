"use server";

import { restoreBackupAtomically } from "@/lib/data/backup";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSession, type AdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { recordBackup } from "@/lib/data/backup";
import { logActivity, runCritical } from "@/lib/data/activity";
import {
  getReviewInvitation,
  getReviewRecord,
  REVIEW_KIND_LABEL,
  type ReviewRecord,
} from "@/lib/data/reviews";
import { hashReviewToken, newReviewToken, reviewFormPath } from "@/lib/review/token";
import { sendNotification } from "@/lib/notify/send";
import { renderTemplate, type NotifyType } from "@/lib/notify/templates";
import { resolveTenant } from "@/lib/tenant";
import type { CrmActionResult } from "@/components/admin/crm/types";
import type { ReviewStatus } from "@/lib/types";
import { publishEvidenceCopies, removePublicCopies } from "./storage";

// 후기·성적사례 운영자 액션 — 정본 S-01·S-03 (00025).
//
// 운영자는 본문을 쓰거나 고치지 못한다. 할 수 있는 일은 다음 일곱 전환뿐이다:
//   검토 시작 · 반려 · 작성자에게 수정 요청 · 승인 · 공개용 마스킹·최소정보 확인 · 게시 · 철회
// 본문이 바뀌어야 하면 "수정 요청"으로 작성자에게 돌려보내고, 새 제출본이 submitted로 다시 들어온다.
// 물리 삭제는 없다 — 반려·철회 모두 행을 남긴다(S-03 "철회 증명만 최소 보존").
//
// 상태 전환은 전부 같은 모양이다: 행을 읽어 현 상태를 확인 → fail-closed 감사(runCritical · privacy)
// → `.eq("status", 기대값)` 조건부 UPDATE(조회와 갱신 사이에 다른 탭이 먼저 옮겼으면 0행 → 실패로 알린다).

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";
const BACKUP_TARGET = "reviews";
const DEFAULT_INVITE_TTL_DAYS = 14;
const MAX_INVITE_TTL_DAYS = 90;
const PHONE_REGEX = /^01[016789]-\d{3,4}-\d{4}$/;

function revalidateReviews(id?: string) {
  revalidatePath("/admin/reviews");
  if (id) revalidatePath(`/admin/reviews/${id}`);
  revalidatePath("/reviews");
  revalidatePath("/case");
  revalidatePath("/");
}

async function backupReviews(db: SupabaseClient, tenantId: string): Promise<void> {
  const { data } = await db.from("reviews").select("*").eq("tenant_id", tenantId);
  await recordBackup(tenantId, BACKUP_TARGET, data ?? []);
}

/** 작성 링크의 출처 — 상담 신청폼(intakeOrigin)·포털 초대(portalOrigin)와 같은 규칙. */
async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-tenant-host") ?? h.get("host") ?? "";
  if (!host) return process.env.NEXT_PUBLIC_SITE_URL ?? "https://axiommathlab.kr";
  const forwarded = h.get("x-forwarded-proto");
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const proto = forwarded ?? (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}

/** 010-1234-5678 로 정규화. 숫자만 온 경우도 받는다. 형식이 아니면 null. */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 11) return null;
  const tail = digits.length - 4;
  const formatted = `${digits.slice(0, 3)}-${digits.slice(3, tail)}-${digits.slice(tail)}`;
  return PHONE_REGEX.test(formatted) ? formatted : null;
}

function statusLabelFor(status: ReviewStatus): string {
  const labels: Record<ReviewStatus, string> = {
    draft: "제출됨(대필)",
    submitted: "제출됨",
    in_review: "검토 중",
    revision_requested: "수정 요청됨",
    rejected: "반려됨",
    approved: "승인됨",
    published: "게시 중",
    retracted: "철회됨",
  };
  return labels[status];
}

async function loadReview(
  session: AdminSession,
  id: string,
): Promise<ReviewRecord | { error: string }> {
  if (!id) return { error: "잘못된 요청입니다." };
  const review = await getReviewRecord(session.tenantId, id);
  if (!review) return { error: "후기 정보를 찾을 수 없습니다." };
  return review;
}

function expectStatus(
  review: ReviewRecord,
  allowed: ReviewStatus[],
  what: string,
): string | null {
  if (allowed.includes(review.status)) return null;
  return `지금 상태(${statusLabelFor(review.status)})에서는 ${what}할 수 없습니다. 새로고침 후 다시 확인해 주세요.`;
}

/**
 * 상태 전환의 공통 몸통 — 감사 선기록 → 조건부 UPDATE. 0행이면 경합으로 상태가 바뀐 것이다.
 * patch에는 status를 포함해 넘긴다.
 */
async function transition(
  session: AdminSession,
  review: ReviewRecord,
  params: {
    action: string;
    summary: string;
    reason: string;
    from: ReviewStatus[];
    to: ReviewStatus;
    patch: Record<string, unknown>;
    /** UPDATE 직전에 실행 — 실패하면 전환하지 않는다(공개 사본 생성·제거 등). */
    before?: () => Promise<CrmActionResult>;
  },
): Promise<CrmActionResult & { auditWarning?: string }> {
  const db = createServiceClient()!;
  await backupReviews(db, session.tenantId);

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: params.action,
      targetType: "review",
      targetId: review.id,
      summary: params.summary,
      category: "privacy",
      before: { status: review.status },
      after: { status: params.to },
      reason: params.reason,
    },
    async (): Promise<CrmActionResult> => {
      if (params.before) {
        const pre = await params.before();
        if (!pre.ok) return pre;
      }
      const { data: updated, error } = await db
        .from("reviews")
        .update({ ...params.patch, status: params.to, updated_at: new Date().toISOString() })
        .eq("tenant_id", session.tenantId)
        .eq("id", review.id)
        .in("status", params.from)
        .select("id");
      if (error) {
        console.error(`[reviews] ${params.action} failed`, error);
        return { ok: false, error: "상태 변경 중 오류가 발생했습니다." };
      }
      if (!updated || updated.length === 0) {
        return {
          ok: false,
          error: "후기 상태가 그 사이 바뀌어 처리하지 못했습니다. 새로고침 후 다시 확인해 주세요.",
        };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;
  revalidateReviews(review.id);
  return result;
}

/** 작성자 안내 발송 — 전달 실패는 전환을 되돌리지 않는다(업무와 전달은 다른 계층). 결과를 경고로 돌려준다. */
async function notifyAuthor(
  review: ReviewRecord,
  type: NotifyType,
  extra?: string,
): Promise<string | null> {
  if (!review.authorPhone) return null;
  try {
    const tenant = await resolveTenant();
    const body = `[${tenant.brandName}] ${renderTemplate(type, { name: review.authorName ?? "고객" })}${extra ? `\n${extra}` : ""}`;
    const sent = await sendNotification({
      tenantId: tenant.id,
      studentId: review.studentId,
      type,
      phone: review.authorPhone,
      message: body,
      isAd: false,
    });
    if (!sent.ok) return `작성자 안내 발송에 실패했습니다(${sent.error ?? "사유 미상"}).`;
    if (sent.queued) return "작성자 안내가 발송 대기열에 적재되었습니다.";
    return null;
  } catch (err) {
    console.error("[reviews] 작성자 안내 발송 오류", err);
    return "작성자 안내 발송 중 오류가 났습니다.";
  }
}

/* ==================================================================
   ① 검토 시작
   ================================================================== */

export async function startReview(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const review = await loadReview(session, id);
  if ("error" in review) return { ok: false, error: review.error };
  const blocked = expectStatus(review, ["draft", "submitted"], "검토를 시작");
  if (blocked) return { ok: false, error: blocked };

  return transition(session, review, {
    action: "review_start",
    summary: `${REVIEW_KIND_LABEL[review.kind]} 검토 시작`,
    reason: "운영자가 제출본 검토를 시작 — 개인정보·표현·동의·사실 근거 검토(S-03)",
    from: ["draft", "submitted"],
    to: "in_review",
    patch: { review_started_at: new Date().toISOString() },
  });
}

/* ==================================================================
   ② 작성자에게 수정 요청 — 보완 요청 → 작성자에게 반환 → 새 제출본
   ================================================================== */

export interface ReviewLinkResult extends CrmActionResult {
  /** 발급된 작성 링크. 알림 발송이 실패해도 발급은 유지되므로 운영자가 직접 전달할 수 있게 돌려준다. */
  link?: string;
  warnings?: string[];
}

/** 초대 한 건을 만들고 링크를 발송한다 — 신규 발급·재발급·수정 요청이 모두 이 몸통을 쓴다. */
async function createInvitationAndSend(
  session: AdminSession,
  input: {
    studentId: string | null;
    studentName: string;
    authorRole: "student" | "parent";
    authorName: string;
    authorPhone: string;
    reviewId: string | null;
    expiresDays: number;
    notifyType: "review_invite" | "review_revision_request";
    extraLine?: string;
  },
): Promise<{ ok: true; link: string; invitationId: string; warnings: string[] } | { ok: false; error: string }> {
  const db = createServiceClient()!;
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + input.expiresDays * 86_400_000).toISOString();
  const rawToken = newReviewToken();
  const link = `${await siteOrigin()}${reviewFormPath(rawToken)}`;

  const { data: inserted, error } = await db
    .from("review_invitations")
    .insert({
      tenant_id: session.tenantId,
      student_id: input.studentId,
      student_name: input.studentName,
      author_role: input.authorRole,
      author_name: input.authorName,
      author_phone: input.authorPhone,
      token_hash: hashReviewToken(rawToken),
      status: "sent",
      review_id: input.reviewId,
      sent_at: nowIso,
      expires_at: expiresAt,
      created_by: session.email,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    console.error("[reviews] 초대 insert 실패", error);
    return { ok: false, error: "작성 초대 발급 중 오류가 발생했습니다." };
  }
  const invitationId = (inserted as { id: string }).id;

  const warnings: string[] = [];
  // 문구에는 학생 이름·성적·수업 정보를 담지 않는다 — 링크 자체가 작성 권한이라 오수신 피해를 줄인다.
  try {
    const tenant = await resolveTenant();
    const message = `[${tenant.brandName}] ${renderTemplate(input.notifyType, { name: input.authorName })}\n${link}${input.extraLine ? `\n${input.extraLine}` : ""}`;
    const sent = await sendNotification({
      tenantId: session.tenantId,
      studentId: input.studentId,
      type: input.notifyType,
      phone: input.authorPhone,
      message,
      isAd: false,
    });
    if (!sent.ok) {
      warnings.push(`링크 발송에 실패했습니다(${sent.error ?? "사유 미상"}). 아래 링크를 직접 전달해 주세요.`);
    } else if (sent.queued) {
      warnings.push("발송이 대기열에 적재되었습니다. 전달 여부를 알림 내역에서 확인해 주세요.");
    }
  } catch (err) {
    console.error("[reviews] 초대 발송 오류", err);
    warnings.push("링크 발송 중 오류가 났습니다. 아래 링크를 직접 전달해 주세요.");
  }

  return { ok: true, link, invitationId, warnings };
}

/** 이 후기에 열려 있는 초대를 닫는다(수정 요청 재발급·반려·철회 전). 이번 호출이 닫은 id를 돌려준다. */
async function closeOpenInvitationsFor(
  db: SupabaseClient,
  tenantId: string,
  reviewId: string,
  reason: string,
): Promise<{ ok: true; closed: string[] } | { ok: false; error: string }> {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("review_invitations")
    .update({ status: "closed", closed_at: nowIso, close_reason: reason })
    .eq("tenant_id", tenantId)
    .eq("review_id", reviewId)
    .eq("status", "sent")
    .select("id");
  if (error) {
    console.error("[reviews] 열린 초대 닫기 실패", error);
    return { ok: false, error: "이전 작성 링크를 닫는 중 오류가 발생했습니다." };
  }
  return { ok: true, closed: ((data ?? []) as { id: string }[]).map((r) => r.id) };
}

export async function requestRevision(formData: FormData): Promise<ReviewLinkResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!note) return { ok: false, error: "무엇을 보완해야 하는지 사유를 적어 주세요." };
  if (note.length > 1000) return { ok: false, error: "사유는 1,000자 이내로 적어 주세요." };

  const review = await loadReview(session, id);
  if ("error" in review) return { ok: false, error: review.error };
  const blocked = expectStatus(review, ["in_review"], "수정을 요청");
  if (blocked) return { ok: false, error: blocked };

  // 작성자 정보 — 후기 행에 없으면(옛 대필 등록분) 원 초대에서 되찾는다. 둘 다 없으면 보낼 곳이 없다.
  let authorName = review.authorName;
  let authorPhone = review.authorPhone;
  // 초대의 학생 이름은 작성 화면의 관계 확인 문장("OO 학생의 보호자로서")에 쓰인다 — 원 초대의 실명을
  // 이어받는다. 후기 행에는 마스킹 이름만 있어서, 원 초대가 없을 때만 그것으로 대신한다.
  let studentName = review.publicName ?? "";
  let authorRole = review.reviewerType;
  if (review.invitationId) {
    const prev = await getReviewInvitation(session.tenantId, review.invitationId);
    if (prev) {
      authorName = authorName ?? prev.authorName;
      authorPhone = authorPhone ?? prev.authorPhone;
      studentName = prev.studentName;
      authorRole = prev.authorRole;
    }
  }
  if (!authorName || !authorPhone) {
    return {
      ok: false,
      error:
        "작성자 연락처가 없어 수정 요청 링크를 보낼 수 없습니다(운영자 대필 등록분). 반려하거나 새 작성 초대를 보내 주세요.",
    };
  }

  const db = createServiceClient()!;
  const issued: { current: { link: string; warnings: string[] } | null } = { current: null };
  const result = await transition(session, review, {
    action: "review_request_revision",
    summary: `${REVIEW_KIND_LABEL[review.kind]} 수정 요청 — 새 작성 링크 발송`,
    reason: `보완 요청(S-03) — ${note}`,
    from: ["in_review"],
    to: "revision_requested",
    patch: { revision_requested_at: new Date().toISOString(), revision_note: note },
    before: async () => {
      const closed = await closeOpenInvitationsFor(
        db,
        session.tenantId,
        review.id,
        "수정 요청 재발급 — 이전 링크 종료",
      );
      if (!closed.ok) return closed;
      const created = await createInvitationAndSend(session, {
        studentId: review.studentId,
        studentName: studentName || "학생",
        authorRole,
        authorName: authorName!,
        authorPhone: authorPhone!,
        reviewId: review.id,
        expiresDays: DEFAULT_INVITE_TTL_DAYS,
        notifyType: "review_revision_request",
        extraLine: `사유: ${note}`,
      });
      if (!created.ok) return created;
      issued.current = { link: created.link, warnings: created.warnings };
      return { ok: true };
    },
  });
  if (!result.ok) return result;

  const warnings = [...(issued.current?.warnings ?? [])];
  if (result.auditWarning) warnings.push(result.auditWarning);
  return { ok: true, link: issued.current?.link, warnings };
}

/* ==================================================================
   ③ 반려 — 공개 금지 · 사유 안내
   ================================================================== */

export async function rejectReview(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: "반려 사유를 적어 주세요. 작성자에게 그대로 안내됩니다." };
  if (reason.length > 1000) return { ok: false, error: "사유는 1,000자 이내로 적어 주세요." };

  const review = await loadReview(session, id);
  if ("error" in review) return { ok: false, error: review.error };
  const blocked = expectStatus(review, ["in_review"], "반려");
  if (blocked) return { ok: false, error: blocked };

  const db = createServiceClient()!;
  const result = await transition(session, review, {
    action: "review_reject",
    summary: `${REVIEW_KIND_LABEL[review.kind]} 반려`,
    reason: `거절(S-03) — ${reason}`,
    from: ["in_review"],
    to: "rejected",
    patch: { rejected_at: new Date().toISOString(), reject_reason: reason },
    before: async () => {
      const closed = await closeOpenInvitationsFor(db, session.tenantId, review.id, "반려 — 링크 종료");
      return closed.ok ? { ok: true } : closed;
    },
  });
  if (!result.ok) return result;

  const warning = await notifyAuthor(review, "review_rejected", `사유: ${reason}`);
  return { ok: true, warning: [warning, result.auditWarning].filter(Boolean).join(" ") || undefined };
}

/* ==================================================================
   ④ 승인 — 동의 누락·미성년 법정대리인 동의 누락이면 승인 금지
   ================================================================== */

async function hasConsent(
  db: SupabaseClient,
  tenantId: string,
  reviewId: string,
  item: "review" | "guardian" | "review_image",
): Promise<boolean> {
  const { data } = await db
    .from("consents")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("subject_type", "review")
    .eq("subject_id", reviewId)
    .eq("item", item)
    .limit(1);
  return Boolean(data && data.length > 0);
}

export async function approveReview(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const review = await loadReview(session, id);
  if ("error" in review) return { ok: false, error: review.error };
  const blocked = expectStatus(review, ["in_review"], "승인");
  if (blocked) return { ok: false, error: blocked };

  const db = createServiceClient()!;
  // S-03 "동의 누락·대상 관계 종료·증빙 불명확: 승인 금지".
  if (!(await hasConsent(db, session.tenantId, review.id, "review"))) {
    return {
      ok: false,
      error: "이 건에는 공개 동의(후기·사례 공개) 기록이 없어 승인할 수 없습니다. 작성자에게 수정 요청으로 돌려보내 동의를 다시 받아 주세요.",
    };
  }
  if (review.isMinor && !(await hasConsent(db, session.tenantId, review.id, "guardian"))) {
    return {
      ok: false,
      error: "미성년 학생 건인데 법정대리인 동의 기록이 없어 승인할 수 없습니다. 작성자에게 수정 요청으로 돌려보내 보호자 동의를 받아 주세요.",
    };
  }

  const result = await transition(session, review, {
    action: "review_approve",
    summary: `${REVIEW_KIND_LABEL[review.kind]} 승인 — 공개용 최소 본 확인 대기`,
    reason: "개인정보·표현·동의·사실 근거 검토 통과(S-03) — 게시는 마스킹·최소정보 확인 후",
    from: ["in_review"],
    to: "approved",
    patch: { approved_at: new Date().toISOString() },
  });
  if (!result.ok) return result;
  return { ok: true, warning: result.auditWarning };
}

/* ==================================================================
   ⑤ 공개용 마스킹·최소정보 확인 — 운영자는 본문·마스킹 이름을 고치지 못한다. 확인만 한다.
   ================================================================== */

export async function confirmMasking(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "");
  const review = await loadReview(session, id);
  if ("error" in review) return { ok: false, error: review.error };
  const blocked = expectStatus(review, ["approved"], "마스킹·최소정보 확인을");
  if (blocked) return { ok: false, error: blocked };
  if (review.maskingConfirmedAt) {
    return { ok: false, error: "이미 확인된 건입니다. 게시 버튼으로 진행해 주세요." };
  }

  const checked = (key: string) => formData.get(key) === "on";
  if (!checked("publicNameOk")) {
    return { ok: false, error: "공개용 마스킹 이름을 확인했는지 체크해 주세요." };
  }
  if (!checked("noIdentifiers")) {
    return { ok: false, error: "본문에 학교명·지역 등 식별 정보가 없는지 확인해 주세요." };
  }
  const hasImages = review.screenshots.length > 0;
  if (hasImages && review.imagesPublic && !checked("imagesOk")) {
    return { ok: false, error: "이미지 공개 동의와 이미지 안의 타인 정보 여부를 확인해 주세요." };
  }
  if (review.isMinor && !checked("guardianVerified")) {
    return { ok: false, error: "미성년 학생 건은 법정대리인 동의를 확인했다고 체크해야 합니다." };
  }
  if (!review.publicName && review.status !== "draft") {
    // 옛 대필 등록분(draft 출신)은 마스킹 이름이 없을 수 있다 — 그 외 제출본에 없다면 데이터 이상이다.
    console.warn("[reviews] public_name 없는 제출본 확인", review.id);
  }

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    masking_confirmed_at: nowIso,
    masking_confirmed_by: session.email,
  };
  if (review.isMinor) {
    patch.guardian_verified_at = nowIso;
    patch.guardian_verified_by = session.email;
  }

  const result = await transition(session, review, {
    action: "review_confirm_masking",
    summary: `${REVIEW_KIND_LABEL[review.kind]} 공개용 마스킹·최소정보 확인`,
    reason: `운영자 확인 — 마스킹 이름(${review.publicName ?? "없음"})·식별정보 없음${hasImages ? "·이미지 공개 동의" : ""}${review.isMinor ? "·법정대리인 동의 확인" : ""}`,
    from: ["approved"],
    to: "approved",
    patch,
  });
  if (!result.ok) return result;
  return { ok: true, warning: result.auditWarning };
}

/* ==================================================================
   ⑥ 게시 — 확인된 승인본만. 이미지 공개 동의가 있을 때만 공개 사본을 만든다.
   ================================================================== */

export async function publishReview(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const review = await loadReview(session, id);
  if ("error" in review) return { ok: false, error: review.error };
  const blocked = expectStatus(review, ["approved"], "게시");
  if (blocked) return { ok: false, error: blocked };
  if (!review.maskingConfirmedAt) {
    return { ok: false, error: "공개용 마스킹·최소정보 확인을 먼저 완료해야 게시할 수 있습니다." };
  }

  const db = createServiceClient()!;
  const result = await transition(session, review, {
    action: "review_publish",
    summary: `${REVIEW_KIND_LABEL[review.kind]} 게시`,
    reason: "승인·마스킹 확인 완료본 게시(S-03) — 공개 페이지에 노출 시작",
    from: ["approved"],
    to: "published",
    patch: { published_at: new Date().toISOString() },
    before: async () => {
      // 이미지 공개 동의가 없으면 공개 사본을 만들지 않는다 — 증빙은 검토 근거로만 남는다(S-02).
      if (!review.imagesPublic || review.screenshots.length === 0) return { ok: true };
      // 사본 없이 published가 되면 공개 페이지 이미지가 깨진 채 노출된다 — 실패 시 게시하지 않는다.
      return publishEvidenceCopies(db, review.screenshots);
    },
  });
  if (!result.ok) return result;

  const origin = await siteOrigin();
  const warning = await notifyAuthor(
    review,
    "review_published",
    `${origin}${review.kind === "case" ? "/case" : "/reviews"}`,
  );
  return { ok: true, warning: [warning, result.auditWarning].filter(Boolean).join(" ") || undefined };
}

/* ==================================================================
   ⑦ 철회 — 즉시 공개 중단. 행은 남기고 공개 사본만 지운다.
   ================================================================== */

export async function retractReview(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: "철회 사유를 적어 주세요(예: 작성자 동의 철회 요청)." };
  if (reason.length > 1000) return { ok: false, error: "사유는 1,000자 이내로 적어 주세요." };

  const review = await loadReview(session, id);
  if ("error" in review) return { ok: false, error: review.error };
  const blocked = expectStatus(review, ["published"], "철회");
  if (blocked) return { ok: false, error: blocked };

  const db = createServiceClient()!;
  const result = await transition(session, review, {
    action: "review_retract",
    summary: `${REVIEW_KIND_LABEL[review.kind]} 철회 — 공개 중단`,
    reason: `철회(S-03) — ${reason}`,
    from: ["published"],
    to: "retracted",
    patch: {
      retracted_at: new Date().toISOString(),
      retracted_by: session.email,
      retract_reason: reason,
      is_pinned: false,
    },
    before: async () => {
      // 공개 사본을 지워야 철회가 실제 비공개화다. 비공개 원본은 보존·파기 흐름(D-04)에 맡긴다.
      // 사본 제거에 실패하면 철회로 표시하지 않는다 — 공개가 멈추지 않았는데 멈췄다고 적을 수 없다.
      if (review.screenshots.length === 0) return { ok: true };
      return removePublicCopies(db, review.screenshots);
    },
  });
  if (!result.ok) return result;
  return { ok: true, warning: result.auditWarning };
}

/* ==================================================================
   작성 초대 — 발급 · 재발급(링크 회전) · 닫기
   ================================================================== */

export async function issueReviewInvitation(formData: FormData): Promise<ReviewLinkResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const studentId = String(formData.get("studentId") ?? "").trim() || null;
  const studentName = String(formData.get("studentName") ?? "").trim();
  const authorRoleRaw = String(formData.get("authorRole") ?? "");
  const authorName = String(formData.get("authorName") ?? "").trim();
  const phoneRaw = String(formData.get("authorPhone") ?? "").trim();
  const expiresRaw = Number(formData.get("expiresDays") ?? DEFAULT_INVITE_TTL_DAYS);

  if (!studentName) return { ok: false, error: "대상 학생 이름을 입력해 주세요." };
  if (authorRoleRaw !== "student" && authorRoleRaw !== "parent") {
    return { ok: false, error: "작성자 역할(학생 본인 / 보호자)을 선택해 주세요." };
  }
  if (!authorName) return { ok: false, error: "작성자 이름을 입력해 주세요." };
  const authorPhone = normalizePhone(phoneRaw);
  if (!authorPhone) return { ok: false, error: "작성자 연락처를 010-1234-5678 형식으로 입력해 주세요." };
  const expiresDays =
    Number.isInteger(expiresRaw) && expiresRaw >= 1 && expiresRaw <= MAX_INVITE_TTL_DAYS
      ? expiresRaw
      : DEFAULT_INVITE_TTL_DAYS;

  const db = createServiceClient()!;
  if (studentId) {
    // 학생 id가 왔으면 이 테넌트의 학생인지 확인한다 — 폼 값으로 타테넌트 학생을 가리키는 경로를 막는다.
    const { data: student } = await db
      .from("students")
      .select("id")
      .eq("tenant_id", session.tenantId)
      .eq("id", studentId)
      .maybeSingle();
    if (!student) return { ok: false, error: "학생 정보를 찾을 수 없습니다." };
  }

  const issued: { current: { link: string; warnings: string[] } | null } = { current: null };
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "review_invite_issue",
      targetType: "review_invitation",
      targetId: null,
      summary: `후기·사례 작성 초대 발급 — ${studentName} (${authorRoleRaw === "student" ? "학생 본인" : "보호자"})`,
      category: "privacy",
      reason: "운영자가 대상·작성자 역할·공개범위를 확인하고 작성 초대를 발급(S-01 — 자동 요청 아님)",
      after: {
        student_id: studentId,
        author_role: authorRoleRaw,
        expires_days: expiresDays,
        // 수신 번호 원문은 남기지 않는다 — 감사 열람이 연락처 열람이 되지 않게 뒷 4자리만.
        recipient_tail: authorPhone.slice(-4),
      },
    },
    async (): Promise<CrmActionResult> => {
      const created = await createInvitationAndSend(session, {
        studentId,
        studentName,
        authorRole: authorRoleRaw,
        authorName,
        authorPhone,
        reviewId: null,
        expiresDays,
        notifyType: "review_invite",
      });
      if (!created.ok) return created;
      issued.current = { link: created.link, warnings: created.warnings };
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidatePath("/admin/reviews");
  if (studentId) revalidatePath(`/admin/students/${studentId}`);
  const warnings = [...(issued.current?.warnings ?? [])];
  if (result.auditWarning) warnings.push(result.auditWarning);
  return { ok: true, link: issued.current?.link, warnings };
}

/** 재발급(링크 회전) — 이전 링크는 즉시 무효. DB엔 해시만 있어 "같은 링크 재전달"은 구조상 없다. */
export async function resendReviewInvitation(id: string): Promise<ReviewLinkResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  const prev = await getReviewInvitation(session.tenantId, id);
  if (!prev) return { ok: false, error: "작성 초대를 찾을 수 없습니다." };
  if (prev.status !== "sent") {
    return { ok: false, error: "이미 닫혔거나 제출된 초대는 재발급할 수 없습니다. 새 초대를 발급해 주세요." };
  }

  const db = createServiceClient()!;
  const nowIso = new Date().toISOString();
  const issued: { current: { link: string; warnings: string[] } | null } = { current: null };
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "review_invite_resend",
      targetType: "review_invitation",
      targetId: prev.id,
      summary: `후기·사례 작성 초대 재발급(링크 회전) — ${prev.studentName}`,
      category: "privacy",
      reason: "이전 링크 종료 후 새 링크 발급 — 같은 대상·같은 작성자",
      after: { recipient_tail: prev.authorPhone.slice(-4) },
    },
    async (): Promise<CrmActionResult> => {
      const { data: closed, error: closeError } = await db
        .from("review_invitations")
        .update({ status: "closed", closed_at: nowIso, close_reason: "재발급 — 이전 링크 종료" })
        .eq("tenant_id", session.tenantId)
        .eq("id", prev.id)
        .eq("status", "sent")
        .select("id")
        .maybeSingle();
      if (closeError) {
        console.error("[reviews] 초대 닫기 실패", closeError);
        return { ok: false, error: "이전 링크를 닫는 중 오류가 발생했습니다." };
      }
      if (!closed) {
        return { ok: false, error: "그 사이 초대 상태가 바뀌었습니다. 새로고침 후 다시 확인해 주세요." };
      }
      const created = await createInvitationAndSend(session, {
        studentId: prev.studentId,
        studentName: prev.studentName,
        authorRole: prev.authorRole,
        authorName: prev.authorName,
        authorPhone: prev.authorPhone,
        reviewId: prev.reviewId,
        expiresDays: DEFAULT_INVITE_TTL_DAYS,
        notifyType: prev.reviewId ? "review_revision_request" : "review_invite",
      });
      if (!created.ok) {
        // 반쪽 상태 방지 — 이전 링크만 죽고 새 링크는 없는 채로 끝내지 않는다.
        const { error: reopenError } = await db
          .from("review_invitations")
          .update({ status: "sent", closed_at: null, close_reason: null })
          .eq("tenant_id", session.tenantId)
          .eq("id", prev.id);
        if (reopenError) console.error("[reviews] 초대 되살리기 실패", reopenError);
        return created;
      }
      issued.current = { link: created.link, warnings: created.warnings };
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidatePath("/admin/reviews");
  if (prev.studentId) revalidatePath(`/admin/students/${prev.studentId}`);
  if (prev.reviewId) revalidatePath(`/admin/reviews/${prev.reviewId}`);
  const warnings = [...(issued.current?.warnings ?? [])];
  if (result.auditWarning) warnings.push(result.auditWarning);
  return { ok: true, link: issued.current?.link, warnings };
}

export async function closeReviewInvitation(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!id) return { ok: false, error: "잘못된 요청입니다." };
  if (!reason) return { ok: false, error: "닫는 사유를 입력해 주세요." };

  const prev = await getReviewInvitation(session.tenantId, id);
  if (!prev) return { ok: false, error: "작성 초대를 찾을 수 없습니다." };
  if (prev.status !== "sent") return { ok: false, error: "이미 닫혔거나 제출된 초대입니다." };

  const db = createServiceClient()!;
  const { data: closed, error } = await db
    .from("review_invitations")
    .update({ status: "closed", closed_at: new Date().toISOString(), close_reason: reason })
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    .eq("status", "sent")
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[reviews] 초대 닫기 실패", error);
    return { ok: false, error: "초대를 닫는 중 오류가 발생했습니다." };
  }
  if (!closed) return { ok: false, error: "그 사이 초대 상태가 바뀌었습니다. 새로고침 후 다시 확인해 주세요." };

  await logActivity(
    session.tenantId,
    session.email,
    "review_invite_close",
    "review_invitation",
    id,
    `후기·사례 작성 초대 닫기 — ${reason}`,
  );
  revalidatePath("/admin/reviews");
  if (prev.studentId) revalidatePath(`/admin/students/${prev.studentId}`);
  if (prev.reviewId) revalidatePath(`/admin/reviews/${prev.reviewId}`);
  return { ok: true };
}

/* ==================================================================
   표시 제어 — 고정·순서. 내용이 아니라 공개 목록의 배치만 바꾼다.
   ================================================================== */

export async function togglePinReview(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const { data: existing, error: fetchError } = await db
    .from("reviews")
    .select("is_pinned,status")
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (fetchError || !existing) {
    console.error("[reviews] fetch before pin toggle failed", fetchError);
    return { ok: false, error: "후기 정보를 찾을 수 없습니다." };
  }
  if (!existing.is_pinned && existing.status !== "published") {
    return { ok: false, error: "게시 중인 후기만 고정할 수 있습니다." };
  }

  await backupReviews(db, session.tenantId);

  const { error } = await db
    .from("reviews")
    .update({ is_pinned: !existing.is_pinned })
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[reviews] pin toggle failed", error);
    return { ok: false, error: "고정 상태 변경 중 오류가 발생했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "update",
    "review",
    id,
    existing.is_pinned ? "후기 고정 해제" : "후기 고정",
  );

  revalidateReviews(id);
  return { ok: true };
}

async function moveReview(id: string, direction: "up" | "down"): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const { data: rows, error: listError } = await db
    .from("reviews")
    .select("id,sort_order")
    .eq("tenant_id", session.tenantId)
    .order("sort_order", { ascending: true });
  if (listError || !rows) {
    console.error("[reviews] fetch order failed", listError);
    return { ok: false, error: "정렬 순서를 불러오지 못했습니다." };
  }

  const index = rows.findIndex((r: { id: string }) => r.id === id);
  if (index === -1) return { ok: false, error: "후기를 찾을 수 없습니다." };
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= rows.length) {
    return {
      ok: false,
      error: direction === "up" ? "이미 첫 번째 항목입니다." : "이미 마지막 항목입니다.",
    };
  }

  const current = rows[index] as { id: string; sort_order: number };
  const target = rows[targetIndex] as { id: string; sort_order: number };

  await backupReviews(db, session.tenantId);

  const [{ error: error1 }, { error: error2 }] = await Promise.all([
    db
      .from("reviews")
      .update({ sort_order: target.sort_order })
      .eq("tenant_id", session.tenantId)
      .eq("id", current.id),
    db
      .from("reviews")
      .update({ sort_order: current.sort_order })
      .eq("tenant_id", session.tenantId)
      .eq("id", target.id),
  ]);
  if (error1 || error2) {
    console.error("[reviews] move failed", error1 ?? error2);
    return { ok: false, error: "순서 변경 중 오류가 발생했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "update",
    "review",
    id,
    direction === "up" ? "후기 순서 위로 이동" : "후기 순서 아래로 이동",
  );

  revalidateReviews();
  return { ok: true };
}

export async function moveReviewUp(id: string): Promise<CrmActionResult> {
  return moveReview(id, "up");
}

export async function moveReviewDown(id: string): Promise<CrmActionResult> {
  return moveReview(id, "down");
}

/* ==================================================================
   백업 복원
   ================================================================== */

export async function restoreReviewsBackup(backupId: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  const target = BACKUP_TARGET;
  const result = await restoreBackupAtomically(session.tenantId, session.email, backupId, target);
  if (result.ok) { revalidateReviews(); }
  return result;
}
