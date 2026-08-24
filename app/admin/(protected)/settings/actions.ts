"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  getAdminSession,
  issueOtp,
  revokeSessions,
  verifyOtp,
} from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { getSiteContent } from "@/lib/data/content";
import { getBackup, recordBackup } from "@/lib/data/backup";
import { logActivity, runCritical } from "@/lib/data/activity";
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

  const save = async (): Promise<CrmActionResult> => {
    await recordBackup(session.tenantId, "settings:site_info", current.settings);
    const { error } = await upsertSetting(session.tenantId, "site_info", updated);
    if (error) {
      console.error("[settings] site info update failed", error);
      return { ok: false, error: "사이트 설정 저장 중 오류가 발생했습니다." };
    }
    return { ok: true };
  };

  // 입금 계좌 변경은 금전 전환(결제 안내가 이 값으로 나간다) — fail-closed 감사.
  // 그 외 항목만 바뀌면 기타 전환 — fail-open logActivity로 충분.
  const bankChanged = (current.settings.bankAccount ?? null) !== bankAccount;
  let result: CrmActionResult;
  if (bankChanged) {
    result = await runCritical(
      {
        tenantId: session.tenantId,
        actorEmail: session.email,
        action: "settings_update_site_info",
        targetType: "site_settings",
        targetId: null,
        summary: "사이트 정보 저장 — 입금 계좌 변경 포함",
        category: "money",
        before: { bankAccount: current.settings.bankAccount ?? null },
        after: { bankAccount },
        reason: "설정 페이지에서 입금 계좌 안내 변경",
      },
      save,
    );
  } else {
    result = await save();
    if (result.ok) {
      await logActivity(
        session.tenantId,
        session.email,
        "settings_update_site_info",
        "site_settings",
        null,
        "사이트 정보 저장",
      );
    }
  }
  if (!result.ok) return result;

  revalidatePath("/", "layout");
  return result;
}

/** target(예: settings:site_info)에서 키를 복원해 해당 site_settings 행에 되돌려 쓴다. */
export async function restoreSetting(backupId: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const backup = await getBackup(session.tenantId, backupId);
  if (!backup) return { ok: false, error: "백업을 찾을 수 없습니다." };
  const key = backup.target.replace(/^settings:/, "");

  // 복원 전 현재 값 — 감사 before_data로 남겨 "무엇에서 무엇으로" 대조 가능하게 한다.
  const db = createServiceClient()!;
  const { data: currentRow } = await db
    .from("site_settings")
    .select("value")
    .eq("tenant_id", session.tenantId)
    .eq("key", key)
    .maybeSingle();

  // 설정 스냅샷에는 연락처·주소 등 개인정보가 포함된다 — fail-closed 감사(category 'privacy').
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "settings_restore",
      targetType: "site_settings",
      targetId: backupId,
      summary: `설정 백업 복원: ${backup.target}`,
      category: "privacy",
      before: currentRow?.value ?? null,
      after: backup.snapshot,
      reason: `백업(${backupId}) 시점 값으로 복원`,
    },
    async (): Promise<CrmActionResult> => {
      const { error } = await upsertSetting(session.tenantId, key, backup.snapshot);
      if (error) {
        console.error("[settings] restore failed", error);
        return { ok: false, error: "복원 중 오류가 발생했습니다." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidatePath("/", "layout");
  return { ok: true };
}

/* ---------- 관리자 보안 — 세션 회수·운영자 교체 (P-10 · 시나리오 64–67) ---------- */

export interface SecurityActionResult {
  ok: boolean;
  error?: string;
  /** AUTH_DEV_MODE=true일 때만 — 메일 대신 화면에 표시되는 OTP */
  devCode?: string;
  /** true면 현재 세션이 회수됐다 — UI는 로그인 화면으로 보낸다 */
  reauth?: boolean;
}

/**
 * 현재 이메일의 전 세션 회수(현재 세션 포함) — 기기 분실·탈취 의심 시 즉시 차단 경로.
 * 세션 회수는 권한 전환이라 fail-closed 감사(runCritical, category 'permission')로 감싼다.
 */
export async function revokeAllMySessions(): Promise<SecurityActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "admin_sessions_revoke_all",
      targetType: "admin_session",
      targetId: null,
      summary: `전 세션 로그아웃: ${session.email}`,
      category: "permission",
      reason: "관리자 요청 — 설정에서 전 세션 로그아웃(현재 세션 포함)",
    },
    () => revokeSessions(session.tenantId, session.email, "revoke_all_my_sessions"),
  );
  if (!result.ok) return { ok: false, error: result.error };

  // 현재 세션도 방금 회수됐다 — 쿠키를 지우고 재로그인으로 보낸다.
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  return { ok: true, reauth: true };
}

/**
 * 운영자 교체 1단계 — 새 이메일로 OTP 발송. 현 이메일 확인은 이 액션을 호출할 수 있는
 * 활성 세션 자체로, 새 이메일 확인은 OTP로 이뤄진다(시나리오 66: 양쪽 확인 없이 전환 금지).
 */
export async function requestOperatorOtp(
  newEmail: string,
): Promise<SecurityActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const normalized = newEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { ok: false, error: "올바른 이메일 형식이 아닙니다." };
  }
  if (normalized === session.email.toLowerCase()) {
    return { ok: false, error: "현재 운영자와 같은 이메일입니다." };
  }

  const result = await issueOtp(session.tenantId, normalized);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, devCode: result.devCode };
}

/**
 * 운영자 교체 2단계 — 새 이메일 OTP 검증 후 admin_replace_operator RPC 호출.
 * RPC가 한 트랜잭션에서 지위 이전(현 active→inactive, 새 이메일 active) + 구 운영자
 * 세션 전부 회수 + OTP 폐기 + 감사 기록까지 수행한다 — 어느 하나라도 실패하면 전체
 * 롤백되어 반쪽 전환이 없다(시나리오 67). 감사는 RPC 내부에서 committed로 남으므로
 * 여기서 runCritical로 이중 기록하지 않는다(한 사건 한 기록).
 */
export async function replaceOperator(
  newEmail: string,
  otpCode: string,
): Promise<SecurityActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const normalized = newEmail.trim().toLowerCase();
  if (normalized === session.email.toLowerCase()) {
    return { ok: false, error: "현재 운영자와 같은 이메일입니다." };
  }
  if (!/^\d{6}$/.test(otpCode.trim())) {
    return { ok: false, error: "6자리 인증번호를 입력해 주세요." };
  }

  const verified = await verifyOtp(session.tenantId, normalized, otpCode.trim());
  if (!verified.ok) return { ok: false, error: verified.error };

  const db = createServiceClient()!;
  const { error } = await db.rpc("admin_replace_operator", {
    p_tenant_id: session.tenantId,
    p_from_email: session.email,
    p_to_email: normalized,
    p_reason: "설정 페이지 운영자 교체 — 현 세션·새 이메일 OTP 검증 완료",
  });
  if (error) {
    console.error("[settings] admin_replace_operator failed", error);
    return {
      ok: false,
      error: "운영자 교체에 실패했습니다. 이미 승계된 계정인지 확인 후 다시 시도해 주세요.",
    };
  }

  // 내 세션도 RPC가 회수했다 — 쿠키를 지우고 새 이메일로 재로그인하게 한다.
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  return { ok: true, reauth: true };
}
