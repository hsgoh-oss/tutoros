"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { getBackup, recordBackup } from "@/lib/data/backup";
import { logActivity } from "@/lib/data/activity";
import type { CrmActionResult } from "@/components/admin/crm/types";
import type { Review } from "@/lib/types";
import { reviewerTypeLabel } from "./constants";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";
const STORAGE_ERROR =
  "스크린샷 업로드 실패 — Supabase Storage 버킷(reviews) 설정을 확인해 주세요.";
const REVIEWS_BUCKET = "reviews";
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

/** getPublicUrl로 발급한 URL에서 버킷 내부 오브젝트 경로만 역추출 (삭제 시 재사용). */
function storageObjectPath(fileUrl: string): string | null {
  const marker = `/${REVIEWS_BUCKET}/`;
  const idx = fileUrl.indexOf(marker);
  if (idx === -1) return null;
  return fileUrl.slice(idx + marker.length);
}

function validScreenshotFile(file: File): boolean {
  if (file.size > MAX_FILE_SIZE_BYTES) return false;
  const extension = fileExtension(file.name);
  const mimeOk =
    typeof file.type !== "string" || file.type === "" || ALLOWED_MIME_TYPES.includes(file.type);
  return ALLOWED_EXTENSIONS.includes(extension) && mimeOk;
}

async function uploadScreenshots(
  db: SupabaseClient,
  tenantId: string,
  files: File[],
): Promise<string[] | { error: string }> {
  const urls: string[] = [];
  for (const file of files) {
    const extension = fileExtension(file.name);
    const objectPath = `${tenantId}/${randomUUID()}.${extension}`;
    const { error } = await db.storage
      .from(REVIEWS_BUCKET)
      .upload(objectPath, file, { contentType: file.type || undefined });
    if (error) {
      console.error("[reviews] storage upload failed", error);
      return { error: STORAGE_ERROR };
    }
    const {
      data: { publicUrl },
    } = db.storage.from(REVIEWS_BUCKET).getPublicUrl(objectPath);
    urls.push(publicUrl);
  }
  return urls;
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
      screenshots: uploaded,
      sort_order: count ?? 0,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[reviews] insert failed", error);
    return { ok: false, error: "후기 등록 중 오류가 발생했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "create",
    "review",
    inserted?.id ?? null,
    `${reviewerTypeLabel(parsed.reviewerType)} 후기 등록`,
  );

  revalidateReviews();
  return { ok: true };
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
    .select("screenshots")
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (fetchError || !existing) {
    console.error("[reviews] fetch before update failed", fetchError);
    return { ok: false, error: "후기 정보를 찾을 수 없습니다." };
  }

  const removeUrls = new Set(formData.getAll("removeScreenshots").map(String));
  const keptScreenshots: string[] = ((existing.screenshots as string[] | null) ?? []).filter(
    (url) => !removeUrls.has(url),
  );

  const newFiles = formData
    .getAll("screenshots")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (keptScreenshots.length + newFiles.length > MAX_SCREENSHOTS) {
    return { ok: false, error: `스크린샷은 최대 ${MAX_SCREENSHOTS}장까지 업로드할 수 있습니다.` };
  }
  if (newFiles.some((f) => !validScreenshotFile(f))) {
    return { ok: false, error: "스크린샷은 jpg, png, webp / 10MB 이하만 업로드할 수 있습니다." };
  }

  const uploaded = await uploadScreenshots(db, session.tenantId, newFiles);
  if ("error" in uploaded) return { ok: false, error: uploaded.error };

  await backupReviews(db, session.tenantId);

  const removedPaths = [...removeUrls]
    .map((url) => storageObjectPath(url))
    .filter((p): p is string => Boolean(p));
  if (removedPaths.length > 0) {
    const { error: removeError } = await db.storage.from(REVIEWS_BUCKET).remove(removedPaths);
    if (removeError) console.error("[reviews] storage remove failed", removeError);
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

  const paths = ((existing?.screenshots as string[] | null) ?? [])
    .map((url) => storageObjectPath(url))
    .filter((p): p is string => Boolean(p));
  if (paths.length > 0) {
    const { error: removeError } = await db.storage.from(REVIEWS_BUCKET).remove(paths);
    if (removeError) console.error("[reviews] storage remove failed", removeError);
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
  const { error: deleteError } = await db
    .from("reviews")
    .delete()
    .eq("tenant_id", session.tenantId);
  if (deleteError) {
    console.error("[reviews] restore delete failed", deleteError);
    return { ok: false, error: "복원 중 오류가 발생했습니다." };
  }

  // snapshot은 jsonb라 내용이 스키마를 보장하지 않는다. service_role은 RLS를 우회하므로
  // 복원 행의 tenant_id를 현재 세션 테넌트로 강제해 타테넌트로 새는 경로를 원천 차단한다.
  const rows = ((backup.snapshot as ReviewSnapshotRow[]) ?? []).map((row) => ({
    ...row,
    tenant_id: session.tenantId,
  }));
  if (rows.length > 0) {
    const { error: insertError } = await db.from("reviews").insert(rows);
    if (insertError) {
      console.error("[reviews] restore insert failed", insertError);
      return { ok: false, error: "복원 중 오류가 발생했습니다." };
    }
  }

  revalidateReviews();
  return { ok: true };
}
