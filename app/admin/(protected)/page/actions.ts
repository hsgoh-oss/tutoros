"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { getSiteContent } from "@/lib/data/content";
import { getBackup, recordBackup } from "@/lib/data/backup";
import { logActivity } from "@/lib/data/activity";
import { toWebp } from "@/lib/images";
import type { CaseItem, ChecklistItem, Rates, SubjectCard } from "@/lib/types";
import type { CrmActionResult } from "@/components/admin/crm/types";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";
const PHOTOS_BUCKET = "photos";
const PHOTO_SLOTS = 5;
const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_PHOTO_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const ALLOWED_PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

async function upsertSetting(tenantId: string, key: string, value: unknown) {
  const db = createServiceClient()!;
  return db
    .from("site_settings")
    .upsert({ tenant_id: tenantId, key, value }, { onConflict: "tenant_id,key" });
}

function parsePositiveInt(raw: FormDataEntryValue | null): number | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function parseCasesJson(raw: string): CaseItem[] | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return null;
    const items: CaseItem[] = [];
    for (const row of data) {
      if (typeof row !== "object" || row === null) return null;
      const r = row as Record<string, unknown>;
      const name = String(r.name ?? "").trim();
      if (!name) continue;
      items.push({
        name,
        beforeLabel: String(r.beforeLabel ?? "").trim(),
        beforeGrade: String(r.beforeGrade ?? "").trim(),
        afterLabel: String(r.afterLabel ?? "").trim(),
        afterGrade: String(r.afterGrade ?? "").trim(),
      });
    }
    return items;
  } catch {
    return null;
  }
}

function parseSubjectsJson(raw: string): SubjectCard[] | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return null;
    const items: SubjectCard[] = [];
    for (const row of data) {
      if (typeof row !== "object" || row === null) return null;
      const r = row as Record<string, unknown>;
      const key = String(r.key ?? "").trim();
      const title = String(r.title ?? "").trim();
      if (!key || !title) continue;
      const points = Array.isArray(r.points)
        ? r.points.map((p) => String(p ?? "").trim()).filter(Boolean)
        : [];
      items.push({
        key,
        title,
        target: String(r.target ?? "").trim(),
        summary: String(r.summary ?? "").trim(),
        points,
      });
    }
    return items;
  } catch {
    return null;
  }
}

function parseChecklistJson(raw: string): ChecklistItem[] | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return null;
    const items: ChecklistItem[] = [];
    for (const row of data) {
      if (typeof row !== "object" || row === null) return null;
      const r = row as Record<string, unknown>;
      const text = String(r.text ?? "").trim();
      if (!text) continue;
      const id = String(r.id ?? "").trim() || `chk-${items.length + 1}`;
      items.push({ id, text });
    }
    return items;
  } catch {
    return null;
  }
}

export async function updateHeroCopy(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const tagline = String(formData.get("tagline") ?? "").trim();
  const seoDescription = String(formData.get("seoDescription") ?? "").trim();
  if (!tagline) return { ok: false, error: "브랜드 태그라인을 입력해 주세요." };
  if (!seoDescription) return { ok: false, error: "SEO 설명을 입력해 주세요." };

  const current = await getSiteContent(session.tenantId);
  await recordBackup(session.tenantId, "settings:site_info", current.settings);

  const { error } = await upsertSetting(session.tenantId, "site_info", {
    ...current.settings,
    tagline,
    seoDescription,
  });
  if (error) {
    console.error("[page] hero copy update failed", error);
    return { ok: false, error: "브랜드 카피 저장 중 오류가 발생했습니다." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateRates(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const inperson = parsePositiveInt(formData.get("inperson"));
  const video = parsePositiveInt(formData.get("video"));
  const trial = parsePositiveInt(formData.get("trial"));
  if (inperson === null || video === null || trial === null) {
    return { ok: false, error: "단가는 0 이상의 숫자로 입력해 주세요." };
  }

  const current = await getSiteContent(session.tenantId);
  await recordBackup(session.tenantId, "settings:rates", current.rates);

  const rates: Rates = { inperson, video, trial };
  const { error } = await upsertSetting(session.tenantId, "rates", rates);
  if (error) {
    console.error("[page] rates update failed", error);
    return { ok: false, error: "단가 저장 중 오류가 발생했습니다." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateBadges(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const badges = String(formData.get("badges") ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const current = await getSiteContent(session.tenantId);
  await recordBackup(session.tenantId, "settings:badges", current.badges);

  const { error } = await upsertSetting(session.tenantId, "badges", badges);
  if (error) {
    console.error("[page] badges update failed", error);
    return { ok: false, error: "역량 배지 저장 중 오류가 발생했습니다." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateCases(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const cases = parseCasesJson(String(formData.get("casesJson") ?? "[]"));
  if (!cases) return { ok: false, error: "성과 사례 입력값이 올바르지 않습니다." };

  const current = await getSiteContent(session.tenantId);
  await recordBackup(session.tenantId, "settings:cases", current.cases);

  const { error } = await upsertSetting(session.tenantId, "cases", cases);
  if (error) {
    console.error("[page] cases update failed", error);
    return { ok: false, error: "성과 사례 저장 중 오류가 발생했습니다." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateSubjects(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const subjects = parseSubjectsJson(String(formData.get("subjectsJson") ?? "[]"));
  if (!subjects) return { ok: false, error: "과목 카드 입력값이 올바르지 않습니다." };

  const current = await getSiteContent(session.tenantId);
  await recordBackup(session.tenantId, "settings:subjects", current.subjects);

  const { error } = await upsertSetting(session.tenantId, "subjects", subjects);
  if (error) {
    console.error("[page] subjects update failed", error);
    return { ok: false, error: "과목 카드 저장 중 오류가 발생했습니다." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateChecklist(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const checklist = parseChecklistJson(String(formData.get("checklistJson") ?? "[]"));
  if (!checklist) return { ok: false, error: "체크리스트 입력값이 올바르지 않습니다." };

  const current = await getSiteContent(session.tenantId);
  await recordBackup(session.tenantId, "settings:checklist", current.checklist);

  const { error } = await upsertSetting(session.tenantId, "checklist", checklist);
  if (error) {
    console.error("[page] checklist update failed", error);
    return { ok: false, error: "체크리스트 저장 중 오류가 발생했습니다." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/** photos 키는 공개 사이트 getSiteContent 계약에 없어 site_settings를 직접 조회한다. */
export async function getSitePhotos(tenantId: string): Promise<string[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("site_settings")
    .select("value")
    .eq("tenant_id", tenantId)
    .eq("key", "photos")
    .maybeSingle();
  const value: unknown = data?.value;
  return Array.isArray(value) ? value.map((v) => String(v ?? "")) : [];
}

function photoObjectPath(url: string): string | null {
  const marker = `/${PHOTOS_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

export async function uploadPhoto(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const slot = Number(formData.get("slot") ?? -1);
  if (!Number.isInteger(slot) || slot < 0 || slot >= PHOTO_SLOTS) {
    return { ok: false, error: "잘못된 요청입니다." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "사진을 선택해 주세요." };
  }
  if (file.size > MAX_PHOTO_SIZE_BYTES) {
    return { ok: false, error: "사진 크기는 10MB 이하여야 합니다." };
  }
  const dotIdx = file.name.lastIndexOf(".");
  const extension = dotIdx >= 0 ? file.name.slice(dotIdx + 1).toLowerCase() : "";
  const mimeOk = !file.type || ALLOWED_PHOTO_MIME_TYPES.includes(file.type);
  if (!ALLOWED_PHOTO_EXTENSIONS.includes(extension) || !mimeOk) {
    return { ok: false, error: "jpg, png, webp 파일만 업로드할 수 있습니다." };
  }

  const db = createServiceClient()!;
  const current = await getSitePhotos(session.tenantId);
  await recordBackup(session.tenantId, "settings:photos", current);

  // WebP로 변환해 업로드(기획 7-7 형식 자동 변환). 실패 시 원본을 그대로 저장한다.
  const webp = await toWebp(file);
  const objectPath = webp
    ? `${session.tenantId}/${randomUUID()}.webp`
    : `${session.tenantId}/${randomUUID()}.${extension}`;
  const { error: uploadError } = await db.storage
    .from(PHOTOS_BUCKET)
    .upload(
      objectPath,
      webp ? webp.buffer : file,
      { contentType: webp ? webp.contentType : file.type || undefined },
    );
  if (uploadError) {
    console.error("[page] photo upload failed", uploadError);
    return { ok: false, error: "사진 업로드 중 오류가 발생했습니다(Storage 버킷 photos 설정을 확인해 주세요)." };
  }

  const {
    data: { publicUrl },
  } = db.storage.from(PHOTOS_BUCKET).getPublicUrl(objectPath);

  const next = Array.from({ length: PHOTO_SLOTS }, (_, i) => current[i] ?? "");
  const previousUrl = next[slot];
  next[slot] = publicUrl;

  const { error: saveError } = await upsertSetting(session.tenantId, "photos", next);
  if (saveError) {
    console.error("[page] photos save failed", saveError);
    return { ok: false, error: "사진 정보 저장 중 오류가 발생했습니다." };
  }

  if (previousUrl) {
    const oldPath = photoObjectPath(previousUrl);
    if (oldPath) {
      const { error: removeError } = await db.storage.from(PHOTOS_BUCKET).remove([oldPath]);
      if (removeError) console.error("[page] old photo remove failed", removeError);
    }
  }

  await logActivity(session.tenantId, session.email, "update", "photo", null, "사진 업로드/교체");

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deletePhoto(slotId: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const slot = Number(slotId);
  if (!Number.isInteger(slot) || slot < 0 || slot >= PHOTO_SLOTS) {
    return { ok: false, error: "잘못된 요청입니다." };
  }

  const db = createServiceClient()!;
  const current = await getSitePhotos(session.tenantId);
  await recordBackup(session.tenantId, "settings:photos", current);

  const next = Array.from({ length: PHOTO_SLOTS }, (_, i) => current[i] ?? "");
  const removedUrl = next[slot];
  next[slot] = "";

  const { error } = await upsertSetting(session.tenantId, "photos", next);
  if (error) {
    console.error("[page] photo delete failed", error);
    return { ok: false, error: "사진 삭제 중 오류가 발생했습니다." };
  }

  if (removedUrl) {
    const oldPath = photoObjectPath(removedUrl);
    if (oldPath) {
      const { error: removeError } = await db.storage.from(PHOTOS_BUCKET).remove([oldPath]);
      if (removeError) console.error("[page] photo storage remove failed", removeError);
    }
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/** target(예: settings:rates)에서 키를 복원해 해당 site_settings 행에 되돌려 쓴다. */
export async function restoreSetting(backupId: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const backup = await getBackup(session.tenantId, backupId);
  if (!backup) return { ok: false, error: "백업을 찾을 수 없습니다." };
  const key = backup.target.replace(/^settings:/, "");

  const { error } = await upsertSetting(session.tenantId, key, backup.snapshot);
  if (error) {
    console.error("[page] restore failed", error);
    return { ok: false, error: "복원 중 오류가 발생했습니다." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
