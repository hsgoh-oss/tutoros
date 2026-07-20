"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { getLesson } from "@/lib/data/crm";
import { logActivity } from "@/lib/data/activity";
import type { CrmActionResult } from "@/components/admin/crm/types";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";
const STORAGE_ERROR =
  "스토리지 업로드 실패 — Supabase Storage 버킷(materials) 설정을 확인해 주세요.";
const MATERIALS_BUCKET = "materials";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "webp"];
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

function fileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : "";
}

/** file_url에서 버킷 내부 오브젝트 경로를 뽑는다 — 현재는 경로 직접 저장, 레거시 public URL도 호환(삭제 시 재사용). */
function storageObjectPath(fileUrl: string): string | null {
  const marker = `/${MATERIALS_BUCKET}/`;
  const idx = fileUrl.indexOf(marker);
  if (idx !== -1) return fileUrl.slice(idx + marker.length); // 레거시 public URL
  if (/^https?:\/\//.test(fileUrl)) return null;
  return fileUrl; // 비공개 버킷 오브젝트 경로 직접 저장
}

export async function uploadMaterial(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "자료명을 입력해 주세요." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "파일을 선택해 주세요." };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: "파일 크기는 10MB 이하여야 합니다." };
  }
  const extension = fileExtension(file.name);
  const mimeOk = typeof file.type !== "string" || file.type === "" || ALLOWED_MIME_TYPES.includes(file.type);
  if (!ALLOWED_EXTENSIONS.includes(extension) || !mimeOk) {
    return { ok: false, error: "pdf, jpg, png, webp 파일만 업로드할 수 있습니다." };
  }

  const studentIdRaw = String(formData.get("studentId") ?? "").trim();
  const studentId = studentIdRaw || null;
  const isShared = studentId === null;

  // lesson_id는 사용자 입력 — 현재 테넌트의 수업인지 확인한 뒤에만 연결한다(교차 테넌트 FK 연결 차단).
  const lessonIdRaw = String(formData.get("lessonId") ?? "").trim();
  let lessonId: string | null = null;
  if (lessonIdRaw) {
    const lesson = await getLesson(session.tenantId, lessonIdRaw);
    lessonId = lesson ? lesson.id : null;
  }

  const db = createServiceClient()!;
  // 한글·공백 등 원본 파일명은 안전화하지 않고 랜덤 UUID + 확장자로 대체 — 원본 이름은 name 컬럼에 보존.
  const objectPath = `${session.tenantId}/${randomUUID()}.${extension}`;
  const { error: uploadError } = await db.storage
    .from(MATERIALS_BUCKET)
    .upload(objectPath, file, { contentType: file.type || undefined });
  if (uploadError) {
    console.error("[materials] storage upload failed", uploadError);
    return { ok: false, error: STORAGE_ERROR };
  }

  const { data: inserted, error: insertError } = await db
    .from("lesson_materials")
    .insert({
      tenant_id: session.tenantId,
      student_id: studentId,
      lesson_id: lessonId,
      name,
      // 비공개 버킷 — 오브젝트 경로만 저장하고 조회 시점에 서명 URL을 발급한다(lib/data/crm.ts listMaterials).
      file_url: objectPath,
      is_shared: isShared,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    console.error("[materials] insert failed", insertError);
    return { ok: false, error: "자료 등록 중 오류가 발생했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "create",
    "material",
    inserted.id,
    `자료 업로드: ${name}`,
  );

  revalidatePath("/admin/materials");
  return { ok: true };
}

export async function deleteMaterial(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const { data: material, error: fetchError } = await db
    .from("lesson_materials")
    .select("file_url")
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (fetchError) {
    console.error("[materials] fetch before delete failed", fetchError);
  }

  const objectPath = material?.file_url ? storageObjectPath(material.file_url) : null;
  if (objectPath) {
    const { error: removeError } = await db.storage
      .from(MATERIALS_BUCKET)
      .remove([objectPath]);
    if (removeError) {
      console.error("[materials] storage remove failed", removeError);
    }
  }

  const { error } = await db
    .from("lesson_materials")
    .delete()
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[materials] delete failed", error);
    return { ok: false, error: "자료 삭제 중 오류가 발생했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "delete",
    "material",
    id,
    "자료 삭제",
  );

  revalidatePath("/admin/materials");
  return { ok: true };
}
