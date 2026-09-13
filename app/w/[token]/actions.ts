"use server";

import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveTenant } from "@/lib/tenant";
import { createWorkItem } from "@/lib/data/work";
import { getInvitationByTokenHash, REVIEW_KIND_LABEL } from "@/lib/data/reviews";
import { hashReviewToken } from "@/lib/review/token";
import { maskName } from "@/lib/review/masking";
import { kstTodayDateOnly } from "@/lib/kst";
import { POLICY_VERSION } from "@/lib/policy";
import {
  EVIDENCE_BUCKET,
  removeScreenshotObjects,
} from "@/app/admin/(protected)/reviews/storage";
import {
  AUTHOR_ROLE_LABEL,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  REVIEW_FORM_FIELDS,
  isUnder19BirthYear,
  readReviewValues,
  reviewSubmitSchema,
} from "@/components/public/review-submit/schema";

// 후기·성적 향상 사례 제출(공개) — S-01 「작성자 본인·대상 관계 확인 → 후기 또는 성적사례 선택
// → 공개 동의 확인 → 작성 → 제출 → 운영자 검토 업무」.
//
// 규율 셋(신청폼 app/f/[token]/actions.ts와 같다):
//  ① 작성자 역할은 초대가 정한다: 클라가 보낸 authorRole을 버리고 DB(review_invitations.author_role)로
//     덮어써서 재검증한다.
//  ② 중복 제출은 최초 제출 결과로 수렴한다: 판정은 조회가 아니라 UPDATE의 WHERE(status='sent')로 한다 —
//     조회와 갱신 사이에 다른 탭이 먼저 제출하는 창을 없앤다(두 번 눌러도 한 번만 저장된다).
//     초대를 먼저 클레임하고 그 다음 후기 행을 쓴다. 후기 저장이 실패하면 초대를 되돌린다(보상).
//  ③ 실패 사유는 구분하지 않는다: 없는 토큰·닫힌 초대·기한 경과가 모두 같은 문구다(존재 비노출).
//
// 제출은 게시가 아니다(S-01 자동 게시 금지). 이 액션은 status='submitted'로만 남기고 운영자 검토
// 업무(work_items)를 만든다 — 공개는 관리자 화면의 검토·승인·마스킹 확인·게시를 거쳐야만 일어난다.
//
// 수정 요청 재제출(invitation.reviewId 있음): 새 행을 만들지 않고 그 행을 갱신한다. 이전 수정 요청
// 사유(revision_note·revision_requested_at)는 지우지 않는다 — 검토 이력이다.

const DB_ERROR_MESSAGE = "지금은 제출할 수 없습니다. 잠시 후 다시 시도해 주세요.";
// 없는 토큰·닫힌 초대·기한 경과·다른 테넌트 — 전부 이 한 문구로 수렴한다(사유 비노출).
const UNAVAILABLE_MESSAGE =
  "지금은 이 링크로 후기·사례를 제출할 수 없습니다. 담당 선생님께 새 링크를 요청해 주세요.";
const SAVE_ERROR_MESSAGE =
  "제출 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요. 계속 실패하면 담당 선생님께 알려 주세요.";
const IMAGE_RULE_MESSAGE = `이미지는 jpg, png, webp / 10MB 이하 / 최대 ${MAX_IMAGES}장까지 올릴 수 있습니다.`;
const IMAGE_CONSENT_MESSAGE =
  "이미지를 첨부하셨다면 이미지 공개 동의를 확인해 주세요. 공개를 원하지 않으시면 이미지를 빼고 제출해 주세요.";

const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type ReviewSubmitResult =
  /** already=true면 이번 입력은 저장되지 않았고 최초 제출본이 유지된다. */
  | { ok: true; already: boolean }
  | { ok: false; error: string };

function fileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : "";
}

// 관리자 업로드(app/admin/(protected)/reviews/actions.ts validScreenshotFile)와 같은 규칙.
function validImageFile(file: File): boolean {
  if (file.size > MAX_IMAGE_BYTES) return false;
  const extension = fileExtension(file.name);
  const mimeOk =
    typeof file.type !== "string" || file.type === "" || ALLOWED_MIME_TYPES.includes(file.type);
  return ALLOWED_EXTENSIONS.includes(extension) && mimeOk;
}

/**
 * 비공개 증빙 버킷에 격리 업로드(S-02). 공개 URL은 만들지 않는다 — 공개 사본은 게시 시점에
 * 운영자 경로(publishEvidenceCopies)가 만든다. 하나라도 실패하면 이미 올린 것을 지우고 실패.
 */
async function uploadImages(
  db: SupabaseClient,
  tenantId: string,
  files: File[],
): Promise<{ ok: true; paths: string[] } | { ok: false }> {
  const paths: string[] = [];
  for (const file of files) {
    const objectPath = `${tenantId}/${randomUUID()}.${fileExtension(file.name)}`;
    const { error } = await db.storage
      .from(EVIDENCE_BUCKET)
      .upload(objectPath, file, { contentType: file.type || undefined });
    if (error) {
      console.error("[review-submit] 증빙 업로드 실패", error);
      if (paths.length > 0) await db.storage.from(EVIDENCE_BUCKET).remove(paths);
      return { ok: false };
    }
    paths.push(objectPath);
  }
  return { ok: true, paths };
}

export async function submitReviewForm(
  token: string,
  formData: FormData,
): Promise<ReviewSubmitResult> {
  const db = createServiceClient();
  if (!db) return { ok: false, error: DB_ERROR_MESSAGE };

  if (typeof token !== "string" || token.length === 0 || token.length > 200) {
    return { ok: false, error: UNAVAILABLE_MESSAGE };
  }

  const tenant = await resolveTenant();
  const tokenHash = hashReviewToken(token);
  const invitation = await getInvitationByTokenHash(tenant.id, tokenHash);
  if (!invitation) return { ok: false, error: UNAVAILABLE_MESSAGE };

  // 최초 제출 결과로 수렴 — 덮어쓰지 않는다.
  if (invitation.status === "submitted") return { ok: true, already: true };
  if (!invitation.isOpen) return { ok: false, error: UNAVAILABLE_MESSAGE };

  // 역할은 DB가 정본이다(클라 입력 무시).
  const parsed = reviewSubmitSchema.safeParse(
    readReviewValues(formData, invitation.authorRole),
  );
  if (!parsed.success) {
    return { ok: false, error: "입력 내용을 다시 확인해 주세요." };
  }
  const values = parsed.data;

  /* ---------- 이미지 판정(스키마 밖) ---------- */
  const files = formData
    .getAll(REVIEW_FORM_FIELDS.images)
    .filter((f): f is File => f instanceof File && f.size > 0);
  const existing = invitation.review;
  // 재제출 시 삭제 대상은 반드시 그 후기 행의 screenshots에 실제로 있는 항목으로 제한한다 —
  // 폼 값을 그대로 스토리지 삭제에 쓰면 임의 경로(타 후기 증빙)를 지울 수 있다.
  const ownImages = existing?.screenshots ?? [];
  const requestedRemove = new Set(
    formData.getAll(REVIEW_FORM_FIELDS.removeImages).map(String),
  );
  const removeImages = ownImages.filter((p) => requestedRemove.has(p));
  const keptImages = ownImages.filter((p) => !requestedRemove.has(p));

  if (keptImages.length + files.length > MAX_IMAGES) {
    return { ok: false, error: IMAGE_RULE_MESSAGE };
  }
  if (files.some((f) => !validImageFile(f))) {
    return { ok: false, error: IMAGE_RULE_MESSAGE };
  }
  const hasImages = keptImages.length + files.length > 0;
  const imageConsent = formData.get(REVIEW_FORM_FIELDS.imageConsent) === "on";
  // 사례 이미지 공개: 이미지가 있을 때 별도 선택 — 이미지를 냈는데 동의가 없으면 받지 않는다.
  // (동의 없이 받아 두면 "검토 근거로만 쓴다"가 작성자에게 설명되지 않은 채 보관이 시작된다.)
  if (hasImages && !imageConsent) {
    return { ok: false, error: IMAGE_CONSENT_MESSAGE };
  }

  const now = new Date().toISOString();

  /* ---------- ① 초대 클레임 — 단일 UPDATE로 판정과 기록을 함께 한다 ---------- */
  //  · status='sent' 조건이 중복 제출 방지선이다(먼저 제출한 쪽만 1행을 갱신한다).
  //  · 기한도 WHERE에 넣는다 — 화면을 열어 둔 채 기한이 지난 뒤 누른 제출은 통과시키지 않는다.
  const { data: claimed, error: claimError } = await db
    .from("review_invitations")
    .update({ status: "submitted", submitted_at: now })
    .eq("tenant_id", tenant.id)
    .eq("id", invitation.id)
    .eq("status", "sent")
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .select("id")
    .maybeSingle();
  if (claimError) {
    console.error("[review-submit] 초대 클레임 실패", claimError);
    return { ok: false, error: SAVE_ERROR_MESSAGE };
  }
  if (!claimed) {
    // 조회 시점엔 열려 있었는데 갱신되지 않았다 = 그 사이 다른 탭이 제출했거나 초대가 닫혔다.
    const current = await getInvitationByTokenHash(tenant.id, tokenHash);
    if (current?.status === "submitted") return { ok: true, already: true };
    return { ok: false, error: UNAVAILABLE_MESSAGE };
  }

  /** 보상 — 이번 호출이 클레임한 초대를 되돌린다(다른 경로가 닫은 건 건드리지 않는다). */
  const restoreInvitation = async () => {
    const { error } = await db
      .from("review_invitations")
      .update({ status: "sent", submitted_at: null })
      .eq("tenant_id", tenant.id)
      .eq("id", invitation.id)
      .eq("status", "submitted");
    if (error) console.error("[review-submit] 초대 복구 실패", error);
  };

  /* ---------- ② 증빙 업로드(비공개 격리) ---------- */
  const uploaded = await uploadImages(db, tenant.id, files);
  if (!uploaded.ok) {
    await restoreInvitation();
    return { ok: false, error: SAVE_ERROR_MESSAGE };
  }
  const discardUploaded = async () => {
    if (uploaded.paths.length === 0) return;
    const { error } = await db.storage.from(EVIDENCE_BUCKET).remove(uploaded.paths);
    if (error) console.error("[review-submit] 업로드 되돌리기 실패", error);
  };

  /* ---------- ③ 후기 행 — 신규 INSERT 또는 수정 요청 재제출 UPDATE ---------- */
  const isMinor = values.studentBirthYear
    ? isUnder19BirthYear(Number(values.studentBirthYear))
    : false;
  const isCase = values.kind === "case";
  // 보호자가 쓰면 작성자가 곧 법정대리인이다. 학생 본인이 쓰면 폼에서 받은 법정대리인이다.
  const guardianName =
    invitation.authorRole === "parent" ? invitation.authorName : values.guardianName?.trim() || null;
  const guardianPhone =
    invitation.authorRole === "parent" ? invitation.authorPhone : values.guardianPhone ?? null;
  const imagesPublic = hasImages && imageConsent;

  const reviewPayload = {
    kind: values.kind,
    reviewer_type: invitation.authorRole,
    content: values.content.trim(),
    // 사례는 만족도를 묻지 않는다 — 컬럼 기본값과 같은 5로 채운다(CHECK 1~5).
    rating: isCase ? 5 : Number(values.rating),
    before_grade: isCase ? values.beforeGrade?.trim() || null : null,
    after_grade: isCase ? values.afterGrade?.trim() || null : null,
    meta: {
      grade: values.grade,
      track: values.track ?? null,
      before_label: isCase ? values.beforeLabel?.trim() || null : null,
      after_label: isCase ? values.afterLabel?.trim() || null : null,
      source: "작성자 제출",
      reviewed_at: kstTodayDateOnly(),
    },
    screenshots: [...keptImages, ...uploaded.paths],
    images_public: imagesPublic,
    // 공개용 마스킹 이름 — 승인된 규칙 하나(lib/review/masking.ts)로 제출 시점에 만든다.
    public_name: maskName(invitation.studentName),
    author_name: invitation.authorName,
    author_phone: invitation.authorPhone,
    is_minor: isMinor,
    guardian_name: isMinor ? guardianName : null,
    guardian_phone: isMinor ? guardianPhone : null,
    invitation_id: invitation.id,
    student_id: invitation.studentId,
    status: "submitted",
    submitted_at: now,
  };

  let reviewId: string;
  let freshInsert = false;
  if (existing) {
    // 재제출 — 원 행을 갱신한다. 상태는 검토 중인 것이 아니었어야 한다(수정 요청 상태에서만 재발급된다).
    const { data: updated, error: updateError } = await db
      .from("reviews")
      .update(reviewPayload)
      .eq("tenant_id", tenant.id)
      .eq("id", existing.id)
      .select("id")
      .maybeSingle();
    if (updateError || !updated) {
      console.error("[review-submit] 후기 재제출 저장 실패", updateError);
      await discardUploaded();
      await restoreInvitation();
      return { ok: false, error: SAVE_ERROR_MESSAGE };
    }
    reviewId = existing.id;
    // 삭제 선택분 스토리지 정리 — 실패해도 제출은 유지한다(행이 그 경로를 더는 가리키지 않으므로
    // 공개면에는 나가지 않는다). 로그로만 남긴다.
    if (removeImages.length > 0) {
      const removed = await removeScreenshotObjects(db, removeImages);
      if (!removed.ok) console.error("[review-submit] 기존 이미지 제거 실패", removed.error);
    }
  } else {
    const insertPayload = { tenant_id: tenant.id, ...reviewPayload };
    // tenant-scope-ok: insertPayload가 tenant_id를 담는다(바로 위 선언).
    const { data: inserted, error: insertError } = await db
      .from("reviews")
      .insert(insertPayload)
      .select("id")
      .single();
    if (insertError || !inserted) {
      console.error("[review-submit] 후기 저장 실패", insertError);
      await discardUploaded();
      await restoreInvitation();
      return { ok: false, error: SAVE_ERROR_MESSAGE };
    }
    reviewId = (inserted as { id: string }).id;
    freshInsert = true;
  }

  /** 신규 제출의 보상 삭제 — 동의 기록 없이 후기가 남지 않게(fail-closed). */
  const discardFreshReview = async () => {
    if (!freshInsert) return;
    const { error } = await db
      .from("reviews")
      .delete()
      .eq("tenant_id", tenant.id)
      .eq("id", reviewId);
    if (error) console.error("[review-submit] 후기 보상 삭제 실패", error);
  };

  // 초대 ↔ 후기 연결. 실패는 제출을 되돌리지 않는다(후기 행이 invitation_id로 역방향 연결을 이미 가진다).
  const { error: linkError } = await db
    .from("review_invitations")
    .update({ review_id: reviewId })
    .eq("tenant_id", tenant.id)
    .eq("id", invitation.id);
  if (linkError) console.error("[review-submit] 초대-후기 연결 실패", linkError);

  /* ---------- ④ 동의 원장 — 주체는 후기 자체(00009 subject_type 'review') ---------- */
  // 이용약관·개인정보 처리는 필수, 공개는 건별 선택(이 제출에서는 있어야 성립), 이미지 공개는
  // 이미지가 있을 때 별도, 법정대리인은 미성년일 때. 신규 제출은 동의 기록 없이 후기를 남기지 않는다.
  const consentBase = {
    tenant_id: tenant.id,
    subject_type: "review",
    subject_id: reviewId,
    policy_version: POLICY_VERSION,
    via: "form",
  };
  const consentRows = [
    { ...consentBase, item: "terms" },
    { ...consentBase, item: "privacy" },
    { ...consentBase, item: "review" },
    ...(imagesPublic ? [{ ...consentBase, item: "review_image" }] : []),
    ...(isMinor && values.guardianConsent ? [{ ...consentBase, item: "guardian" }] : []),
  ];
  // tenant-scope-ok: consentBase가 tenant_id를 담고 전 행이 이를 스프레드한다(위 선언).
  // 감사기는 insert 인자 변수의 선언 블록에서 리터럴 tenant_id만 찾아 2단계 간접참조를 보지 못한다.
  const { error: consentError } = await db.from("consents").insert(consentRows);
  if (consentError) {
    console.error("[review-submit] 동의 기록 실패", consentError);
    if (freshInsert) {
      await discardFreshReview();
      await discardUploaded();
      await restoreInvitation();
      return {
        ok: false,
        error: "동의 기록에 실패해 제출하지 않았습니다. 잠시 후 다시 시도해 주세요.",
      };
    }
    // 재제출은 원 제출의 동의 기록이 이미 있다 — 로그만 남기고 제출을 유지한다.
  }

  /* ---------- ⑤ 운영자 검토 업무로 수렴(S-01 "제출 → 운영자 검토 업무") ---------- */
  // createWorkItem은 fail-open이라 큐 적재 실패가 제출을 되돌리지 않는다.
  await createWorkItem(tenant.id, {
    kind: "manual",
    title: existing ? "후기·사례 재제출 검토" : "후기·사례 제출 검토",
    detail: `${REVIEW_KIND_LABEL[values.kind]} — ${maskName(invitation.studentName)} (${AUTHOR_ROLE_LABEL[invitation.authorRole]})`,
    sourceType: "review",
    sourceId: reviewId,
    priority: "privacy",
    nextAction: "검토 시작 → 승인 / 작성자에게 수정 요청 / 반려",
  });

  return { ok: true, already: false };
}
