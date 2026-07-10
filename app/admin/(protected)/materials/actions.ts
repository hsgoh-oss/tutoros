"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
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

/** getPublicUrl로 발급한 URL에서 버킷 내부 오브젝트 경로만 역추출 (삭제 시 재사용). */
function storageObjectPath(fileUrl: string): string | null {
  const marker = `/${MATERIALS_BUCKET}/`;
  const idx = fileUrl.indexOf(marker);
  if (idx === -1) return null;
  return fileUrl.slice(idx + marker.length);
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

  const {
    data: { publicUrl },
  } = db.storage.from(MATERIALS_BUCKET).getPublicUrl(objectPath);

  const { error: insertError } = await db.from("lesson_materials").insert({
    tenant_id: session.tenantId,
    student_id: studentId,
    name,
    file_url: publicUrl,
    is_shared: isShared,
  });
  if (insertError) {
    console.error("[materials] insert failed", insertError);
    return { ok: false, error: "자료 등록 중 오류가 발생했습니다." };
  }

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

  revalidatePath("/admin/materials");
  return { ok: true };
}
