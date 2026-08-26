"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { getBackup, recordBackup } from "@/lib/data/backup";
import { logActivity, runCritical } from "@/lib/data/activity";
import type { CrmActionResult } from "@/components/admin/crm/types";
import type { Review, ReviewStatus } from "@/lib/types";
import { reviewerTypeLabel } from "./constants";
import {
  EVIDENCE_BUCKET,
  publishEvidenceCopies,
  removeScreenshotObjects,
} from "./storage";
import { POLICY_VERSION } from "@/lib/policy";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";
const STORAGE_ERROR =
  "스크린샷 업로드 실패 — Supabase Storage 버킷(review-evidence) 설정을 확인해 주세요.";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_SCREENSHOTS = 5;
const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const REVIEWER_TYPES: Review["reviewerType"][] = ["student", "parent"];
const BACKUP_TARGET = "reviews";

function fileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : "";
}

function validScreenshotFile(file: File): boolean {
  if (file.size > MAX_FILE_SIZE_BYTES) return false;
  const extension = fileExtension(file.name);
  const mimeOk =
    typeof file.type !== "string" || file.type === "" || ALLOWED_MIME_TYPES.includes(file.type);
  return ALLOWED_EXTENSIONS.includes(extension) && mimeOk;
}

/**
 * 신규 증빙 업로드 — 비공개 버킷(review-evidence)에 격리 저장하고 오브젝트 경로를 반환한다.
 * 정본 S-02 "비공개 격리": public URL을 발급하던 이전 방식과 달리 업로드 시점에는 어떤
 * 공개 URL도 만들지 않는다. 열람은 관리자 검토 화면의 서명 URL, 공개 노출은 게시 승인
 * 시점의 공개 사본 생성(publishEvidenceCopies)으로만 이뤄진다. 설계 사유: ./storage.ts 상단.
 */
async function uploadScreenshots(
  db: SupabaseClient,
  tenantId: string,
  files: File[],
): Promise<string[] | { error: string }> {
  const paths: string[] = [];
  for (const file of files) {
    const extension = fileExtension(file.name);
    const objectPath = `${tenantId}/${randomUUID()}.${extension}`;
    const { error } = await db.storage
      .from(EVIDENCE_BUCKET)
      .upload(objectPath, file, { contentType: file.type || undefined });
    if (error) {
      console.error("[reviews] storage upload failed", error);
      return { error: STORAGE_ERROR };
    }
    paths.push(objectPath);
  }
  return paths;
}

async function backupReviews(db: SupabaseClient, tenantId: string): Promise<void> {
  const { data } = await db.from("reviews").select("*").eq("tenant_id", tenantId);
  await recordBackup(tenantId, BACKUP_TARGET, data ?? []);
}

function revalidateReviews() {
  revalidatePath("/admin/reviews");
  revalidatePath("/reviews");
  revalidatePath("/");
}

interface ReviewFormPayload {
  reviewerType: Review["reviewerType"];
  content: string;
  rating: number;
  beforeGrade: string | null;
  afterGrade: string | null;
  region: string | null;
  grade: string | null;
  track: string | null;
  source: string | null;
  reviewedAt: string | null;
}

function parseReviewForm(formData: FormData): ReviewFormPayload | { error: string } {
  const content = String(formData.get("content") ?? "").trim();
  if (!content) return { error: "후기 내용을 입력해 주세요." };

  const reviewerTypeRaw = String(formData.get("reviewerType") ?? "student");
  if (!REVIEWER_TYPES.includes(reviewerTypeRaw as Review["reviewerType"])) {
    return { error: "잘못된 작성자 유형입니다." };
  }

  const ratingRaw = Number(formData.get("rating") ?? 5);
  if (!Number.isInteger(ratingRaw) || ratingRaw < 1 || ratingRaw > 5) {
    return { error: "평점은 1~5 사이여야 합니다." };
  }

  return {
    reviewerType: reviewerTypeRaw as Review["reviewerType"],
    content,
    rating: ratingRaw,
    beforeGrade: String(formData.get("beforeGrade") ?? "").trim() || null,
    afterGrade: String(formData.get("afterGrade") ?? "").trim() || null,
    region: String(formData.get("region") ?? "").trim() || null,
    grade: String(formData.get("grade") ?? "").trim() || null,
    track: String(formData.get("track") ?? "").trim() || null,
    source: String(formData.get("source") ?? "").trim() || null,
    reviewedAt: String(formData.get("reviewedAt") ?? "").trim() || null,
  };
}

function metaPayload(parsed: ReviewFormPayload) {
  return {
    region: parsed.region,
    grade: parsed.grade,
    track: parsed.track,
    source: parsed.source,
    reviewed_at: parsed.reviewedAt,
  };
}

export async function createReview(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const parsed = parseReviewForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  // 후기 게시 동의(기획 7-17) — 관리자가 작성자 동의를 받았음을 확인해야 제출·게시 흐름에 올릴 수 있다.
  // 동의 확인은 제출(등록) 단계 게이트다(정본 S-01 "공개 동의 확인 → 작성 → 제출").
  if (formData.get("publishConsent") !== "on") {
    return { ok: false, error: "후기 게시 동의 확인이 필요합니다." };
  }

  const files = formData
    .getAll("screenshots")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_SCREENSHOTS) {
    return { ok: false, error: `스크린샷은 최대 ${MAX_SCREENSHOTS}장까지 업로드할 수 있습니다.` };
  }
  if (files.some((f) => !validScreenshotFile(f))) {
    return { ok: false, error: "스크린샷은 jpg, png, webp / 10MB 이하만 업로드할 수 있습니다." };
  }

  const db = createServiceClient()!;
  const { count } = await db
    .from("reviews")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", session.tenantId);

  const uploaded = await uploadScreenshots(db, session.tenantId, files);
  if ("error" in uploaded) return { ok: false, error: uploaded.error };

  await backupReviews(db, session.tenantId);

  // 정본 S-01 "등록 즉시 공개 금지": 신규 후기는 status 컬럼 기본값(00016)으로 draft(비공개)로
  // 태어난다 — 공개는 approveReview의 운영자 승인 전환(published)을 거쳐야만 이뤄진다.
  // 등록도 동의 확인·증빙 접수를 동반한 개인정보 전환(privacy) — 감사 선기록 없이는 실행하지 않는다(fail-closed).
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "create",
      targetType: "review",
      targetId: null, // insert 전 선기록이라 새 행 id는 아직 없다 — after_data로 식별.
      summary: `${reviewerTypeLabel(parsed.reviewerType)} 후기 등록(승인 대기)`,
      category: "privacy",
      after: {
        reviewer_type: parsed.reviewerType,
        rating: parsed.rating,
        screenshot_count: uploaded.length,
        publish_consent: true,
        status: "draft", // 즉시 공개 금지 — 게시는 approveReview 승인 후
      },
    },
    async () => {
      const { data: inserted, error } = await db
        .from("reviews")
        .insert({
          tenant_id: session.tenantId,
          reviewer_type: parsed.reviewerType,
          content: parsed.content,
          rating: parsed.rating,
          before_grade: parsed.beforeGrade,
          after_grade: parsed.afterGrade,
          meta: metaPayload(parsed),
          screenshots: uploaded, // 증빙 경로(비공개 버킷) — 공개 사본은 승인 시 생성
          sort_order: count ?? 0,
          // status는 지정하지 않는다 — 00016 기본값 draft가 "신규는 비공개로 태어난다"를 보장
        })
        .select("id")
        .single();
      if (error || !inserted) {
        console.error("[reviews] insert failed", error);
        return { ok: false, error: "후기 등록 중 오류가 발생했습니다." };
      }

      // 게시 동의 이력 기록(기획 7-17 "전 동의는 consents 테이블에 보존"). subject는 후기 자체.
      // 동의 이력은 감사 성격 — 기록 실패 시 방금 등록한 후기를 보상 삭제하고 등록을 실패 처리한다.
      const { error: consentError } = await db.from("consents").insert({
        tenant_id: session.tenantId,
        subject_type: "review",
        subject_id: inserted.id,
        item: "review",
        policy_version: POLICY_VERSION,
        via: "admin",
      });
      if (consentError) {
        console.error("[reviews] 후기 게시 동의 기록 실패", consentError);
        const { error: cleanupError } = await db
          .from("reviews")
          .delete()
          .eq("tenant_id", session.tenantId)
          .eq("id", inserted.id);
        if (cleanupError) console.error("[reviews] review cleanup failed", cleanupError);
        return {
          ok: false,
          error: "후기 게시 동의 기록에 실패해 후기를 등록하지 않았습니다. 잠시 후 다시 시도해 주세요.",
        };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidateReviews();
  return result;
}

/**
 * 후기 게시 승인 — draft → published 전환(정본 S-01 "검토·승인 후 게시").
 * 운영자 대필 구조라 검토 주체와 게시 결정 주체가 같으므로 중간 approved(게시 대기) 단계를
 * 두지 않고 승인 즉시 게시로 수렴한다(00016 상태값의 approved는 제출·검토 분리 도입 시 사용).
 * 게시는 개인정보 공개 전환(privacy) — 감사 선기록 없이는 게시하지 않는다(fail-closed).
 */
export async function approveReview(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const { data: existing, error: fetchError } = await db
    .from("reviews")
    .select("status,screenshots,reviewer_type")
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (fetchError || !existing) {
    console.error("[reviews] fetch before approve failed", fetchError);
    return { ok: false, error: "후기 정보를 찾을 수 없습니다." };
  }
  const currentStatus = existing.status as ReviewStatus;
  if (currentStatus === "published") {
    return { ok: false, error: "이미 게시된 후기입니다." };
  }
  // 재활성 금지: 철회된 후기는 승인으로 되살리지 않는다 — 재게시는 새 등록·새 검토로만(정본 원칙).
  if (currentStatus === "retracted") {
    return { ok: false, error: "철회된 후기는 다시 게시할 수 없습니다. 새 후기로 등록해 주세요." };
  }

  await backupReviews(db, session.tenantId);

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "approve",
      targetType: "review",
      targetId: id,
      summary: `${reviewerTypeLabel(existing.reviewer_type as Review["reviewerType"])} 후기 게시 승인`,
      category: "privacy",
      before: { status: currentStatus },
      after: { status: "published" },
    },
    async () => {
      // ① 증빙 공개 사본 생성(비공개 원본은 격리 유지) — 실패 시 게시하지 않는다.
      //    사본 없이 published가 되면 공개 페이지 이미지가 깨진 채 노출되기 때문.
      const copied = await publishEvidenceCopies(
        db,
        (existing.screenshots as string[] | null) ?? [],
      );
      if (!copied.ok) return copied;

      // ② 상태 전환 — 조회 이후 상태가 바뀌었을 수 있으므로 미게시 상태에서만 전환(경합 방지).
      const { data: updated, error } = await db
        .from("reviews")
        .update({ status: "published", approved_at: new Date().toISOString() })
        .eq("tenant_id", session.tenantId)
        .eq("id", id)
        .in("status", ["draft", "approved"])
        .select("id");
      if (error) {
        console.error("[reviews] approve failed", error);
        return { ok: false, error: "게시 승인 중 오류가 발생했습니다." };
      }
      if (!updated || updated.length === 0) {
        return { ok: false, error: "후기 상태가 변경되어 승인하지 못했습니다. 새로고침 후 다시 확인해 주세요." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidateReviews();
  revalidatePath(`/admin/reviews/${id}`);
  return result;
}

export async function updateReview(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  const parsed = parseReviewForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const db = createServiceClient()!;
  const { data: existing, error: fetchError } = await db
    .from("reviews")
    .select("screenshots,status")
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (fetchError || !existing) {
    console.error("[reviews] fetch before update failed", fetchError);
    return { ok: false, error: "후기 정보를 찾을 수 없습니다." };
  }

  // 제거 대상은 반드시 이 후기 행의 screenshots에 실제로 있는 항목으로 제한한다 —
  // 폼 값이 그대로 스토리지 삭제에 쓰이면 임의 경로(타 후기 증빙·공개 사본)를 지울 수 있다.
  const ownScreenshots = (existing.screenshots as string[] | null) ?? [];
  const requestedRemove = new Set(formData.getAll("removeScreenshots").map(String));
  const removeUrls = new Set(ownScreenshots.filter((url) => requestedRemove.has(url)));
  const keptScreenshots: string[] = ownScreenshots.filter((url) => !removeUrls.has(url));

  const newFiles = formData
    .getAll("screenshots")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (keptScreenshots.length + newFiles.length > MAX_SCREENSHOTS) {
    return { ok: false, error: `스크린샷은 최대 ${MAX_SCREENSHOTS}장까지 업로드할 수 있습니다.` };
  }
  if (newFiles.some((f) => !validScreenshotFile(f))) {
    return { ok: false, error: "스크린샷은 jpg, png, webp / 10MB 이하만 업로드할 수 있습니다." };
  }

  // 신규 증빙은 비공개 버킷에 격리 업로드(S-02) — 게시 중인 후기라면 아래에서 공개 사본을 만든다.
  const uploaded = await uploadScreenshots(db, session.tenantId, newFiles);
  if ("error" in uploaded) return { ok: false, error: uploaded.error };

  // 게시 중(published) 후기에 새 증빙 추가: 수정자가 곧 검토·승인 주체(운영자 대필 구조)이므로
  // 즉시 공개 사본을 생성한다. 실패 시 수정 전체를 중단 — 깨진 이미지가 공개면에 노출되지 않게.
  // (게시 후 정정의 새 본 검토·이전본 대체 표시 파이프라인은 S-03 후속 범위.)
  if ((existing.status as ReviewStatus) === "published" && uploaded.length > 0) {
    const copied = await publishEvidenceCopies(db, uploaded);
    if (!copied.ok) return copied;
  }

  await backupReviews(db, session.tenantId);

  // 제거 선택분 스토리지 정리 — 레거시 URL은 공개 버킷, 증빙 경로는 비공개 원본+공개 사본까지.
  if (removeUrls.size > 0) {
    await removeScreenshotObjects(db, [...removeUrls]);
  }

  const { error } = await db
    .from("reviews")
    .update({
      reviewer_type: parsed.reviewerType,
      content: parsed.content,
      rating: parsed.rating,
      before_grade: parsed.beforeGrade,
      after_grade: parsed.afterGrade,
      meta: metaPayload(parsed),
      screenshots: [...keptScreenshots, ...uploaded],
    })
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[reviews] update failed", error);
    return { ok: false, error: "후기 수정 중 오류가 발생했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "update",
    "review",
    id,
    `${reviewerTypeLabel(parsed.reviewerType)} 후기 수정`,
  );

  revalidateReviews();
  revalidatePath(`/admin/reviews/${id}`);
  return { ok: true };
}

export async function togglePinReview(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const { data: existing, error: fetchError } = await db
    .from("reviews")
    .select("is_pinned")
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (fetchError || !existing) {
    console.error("[reviews] fetch before pin toggle failed", fetchError);
    return { ok: false, error: "후기 정보를 찾을 수 없습니다." };
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

  revalidateReviews();
  return { ok: true };
}

export async function deleteReview(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const { data: existing, error: fetchError } = await db
    .from("reviews")
    .select("screenshots")
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (fetchError) {
    console.error("[reviews] fetch before delete failed", fetchError);
  }

  await backupReviews(db, session.tenantId);

  // 스토리지 정리 — 레거시 URL(공개 버킷 원본)과 증빙 경로(비공개 원본+공개 사본) 모두 제거.
  // 공개 사본까지 지워야 삭제가 실제 비공개화로 이어진다(S-03 "공개 사본 제거").
  const entries = (existing?.screenshots as string[] | null) ?? [];
  if (entries.length > 0) {
    await removeScreenshotObjects(db, entries);
  }

  const { error } = await db
    .from("reviews")
    .delete()
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[reviews] delete failed", error);
    return { ok: false, error: "후기 삭제 중 오류가 발생했습니다." };
  }

  await logActivity(session.tenantId, session.email, "delete", "review", id, "후기 삭제");

  revalidateReviews();
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

interface ReviewSnapshotRow {
  id: string;
  tenant_id: string;
  reviewer_type: string;
  content: string;
  rating: number;
  before_grade: string | null;
  after_grade: string | null;
  meta: unknown;
  ai_tags: string[];
  screenshots: string[];
  is_pinned: boolean;
  student_id: string | null;
  created_at: string;
  updated_at: string;
  /** 00016 이후 스냅샷에만 존재 — 이전 백업 복원 호환을 위해 선택 필드. */
  status?: ReviewStatus;
  approved_at?: string | null;
}

export async function restoreReviewsBackup(backupId: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const backup = await getBackup(session.tenantId, backupId);
  if (!backup || backup.target !== BACKUP_TARGET) {
    return { ok: false, error: "백업을 찾을 수 없습니다." };
  }

  const db = createServiceClient()!;
  // snapshot은 jsonb라 내용이 스키마를 보장하지 않는다. service_role은 RLS를 우회하므로
  // 복원 행의 tenant_id를 현재 세션 테넌트로 강제해 타테넌트로 새는 경로를 원천 차단한다.
  // status가 없는 00016 이전 스냅샷 행은 published로 간주한다 — 당시 행은 전부 등록 즉시
  // 공개 중이던 본이라(00016 백필과 동일 논리) 기본값 draft로 넣으면 복원이 공개 집합을
  // 통째로 비공개화하는 회귀가 된다. 승인 시각도 백필과 같이 등록 시각으로 간주.
  const rows = ((backup.snapshot as ReviewSnapshotRow[]) ?? []).map((row) => ({
    ...row,
    tenant_id: session.tenantId,
    status: row.status ?? "published",
    approved_at: row.approved_at ?? (row.status ? null : row.created_at),
  }));

  // 복원 전 현재 규모를 before_data 요약으로 남긴다(전문 스냅샷은 backups 테이블 몫).
  const { count: currentCount } = await db
    .from("reviews")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", session.tenantId);

  // 백업 복원은 게시 데이터 전체 치환 — 감사 선기록(pending) 없이는 실행하지 않는다(fail-closed).
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "restore",
      targetType: "review",
      targetId: backupId,
      summary: `후기 백업 복원 (${rows.length}건)`,
      category: "privacy",
      before: { review_count: currentCount ?? 0 },
      after: { backup_id: backupId, restored_count: rows.length },
    },
    async () => {
      const { error: deleteError } = await db
        .from("reviews")
        .delete()
        .eq("tenant_id", session.tenantId);
      if (deleteError) {
        console.error("[reviews] restore delete failed", deleteError);
        return { ok: false, error: "복원 중 오류가 발생했습니다." };
      }
      if (rows.length > 0) {
        const { error: insertError } = await db.from("reviews").insert(rows);
        if (insertError) {
          console.error("[reviews] restore insert failed", insertError);
          return { ok: false, error: "복원 중 오류가 발생했습니다." };
        }
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  // D-08·W-06 최소 수렴: "복원은 정합 확인 업무로 수렴" — 복원분 정합·과거 파기 대상
  // 재적용 여부를 사람이 확인하도록 업무를 남긴다(fail-open — 복원 성공은 유지).
  // 격리 리허설→정합성→재파기→운영 연결 전면 구현은 M8 몫.
  // (파일 상단 import 대신 함수 내부 동적 import — 이 함수 밖은 다른 작업과 겹쳐 수정 최소화.)
  const { createWorkItem } = await import("@/lib/data/work");
  await createWorkItem(session.tenantId, {
    kind: "manual",
    priority: "privacy",
    title: "백업 복원 정합 확인",
    detail: `후기 백업 복원(${rows.length}건)`,
    sourceType: "backup_restore",
    sourceId: backupId,
    nextAction: "복원분 데이터 정합·과거 파기 대상 재적용 여부 확인(D-08·W-06)",
  });

  revalidateReviews();
  return result;
}
