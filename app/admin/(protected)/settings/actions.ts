"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { getSiteContent } from "@/lib/data/content";
import { getBackup, recordBackup } from "@/lib/data/backup";
import type { SiteSettings } from "@/lib/types";
import type { CrmActionResult } from "@/components/admin/crm/types";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";

async function upsertSetting(tenantId: string, key: string, value: unknown) {
  const db = createServiceClient()!;
  return db
    .from("site_settings")
    .upsert({ tenant_id: tenantId, key, value }, { onConflict: "tenant_id,key" });
}

export async function updateSiteInfo(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const brandName = String(formData.get("brandName") ?? "").trim();
  const bizName = String(formData.get("bizName") ?? "").trim();
  const ceoName = String(formData.get("ceoName") ?? "").trim();
  const bizNo = String(formData.get("bizNo") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  if (!brandName || !bizName || !ceoName || !bizNo || !email || !address) {
    return { ok: false, error: "필수 항목을 모두 입력해 주세요." };
  }

  const phone = String(formData.get("phone") ?? "").trim() || null;
  const kakaoUrl = String(formData.get("kakaoUrl") ?? "").trim();
  const instagramUrl = String(formData.get("instagramUrl") ?? "").trim();
  const kimProfileUrl = String(formData.get("kimProfileUrl") ?? "").trim();
  const kimReviewUrl = String(formData.get("kimReviewUrl") ?? "").trim();
  const tutorReportNo = String(formData.get("tutorReportNo") ?? "").trim() || null;
  const gaId = String(formData.get("gaId") ?? "").trim() || null;
  const bankAccount = String(formData.get("bankAccount") ?? "").trim() || null;

  const current = await getSiteContent(session.tenantId);
  await recordBackup(session.tenantId, "settings:site_info", current.settings);

  const updated: SiteSettings = {
    ...current.settings,
    brandName,
    bizName,
    ceoName,
    bizNo,
    email,
    address,
    phone,
    kakaoUrl,
    instagramUrl,
    kimProfileUrl,
    kimReviewUrl,
    tutorReportNo,
    gaId,
    bankAccount,
  };

  const { error } = await upsertSetting(session.tenantId, "site_info", updated);
  if (error) {
    console.error("[settings] site info update failed", error);
    return { ok: false, error: "사이트 설정 저장 중 오류가 발생했습니다." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/** target(예: settings:site_info)에서 키를 복원해 해당 site_settings 행에 되돌려 쓴다. */
export async function restoreSetting(backupId: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const backup = await getBackup(session.tenantId, backupId);
  if (!backup) return { ok: false, error: "백업을 찾을 수 없습니다." };
  const key = backup.target.replace(/^settings:/, "");

  const { error } = await upsertSetting(session.tenantId, key, backup.snapshot);
  if (error) {
    console.error("[settings] restore failed", error);
    return { ok: false, error: "복원 중 오류가 발생했습니다." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
