"use server";

import { cookies } from "next/headers";
import { resolveTenant } from "@/lib/tenant";
import { createServiceClient } from "@/lib/supabase/server";
import {
  SESSION_COOKIE,
  createSessionToken,
  issueOtp,
  verifyOtp,
} from "@/lib/auth/session";

const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60; // 세션 7일 — lib/auth/session.ts TTL과 동일

export interface LoginActionResult {
  ok: boolean;
  error?: string;
  /** AUTH_DEV_MODE=true일 때만 — 메일 발송 대신 화면에 표시 */
  devCode?: string;
}

// 현재 Host의 테넌트에 등록된 관리자 이메일일 때만 OTP를 발급한다(테넌트당 관리자 다중 허용).
// admin_accounts(00007)에 (tenant_id, email)로 등록된 계정을 인가한다. tenants.email(소유자)은
// 마이그레이션 백필로 이 테이블에 포함된다. OTP 레코드도 (tenant_id, email)로 격리되므로 함께 돌려준다.
interface AuthorizedAdmin {
  tenantId: string;
  email: string;
}

async function authorizeAdmin(email: string): Promise<AuthorizedAdmin | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const tenant = await resolveTenant();
  const isOwner = normalized === tenant.email.toLowerCase();

  const db = createServiceClient();
  if (db) {
    const { data } = await db
      .from("admin_accounts")
      .select("email")
      .eq("tenant_id", tenant.id)
      .eq("email", normalized)
      .maybeSingle();
    // 등록된 관리자이거나, (방어적으로) 백필 누락 시에도 소유자 이메일은 항상 허용.
    if (data || isOwner) return { tenantId: tenant.id, email: normalized };
    return null;
  }

  // DB 미연결(개발 모드) — 테넌트 소유자 이메일만 허용.
  return isOwner ? { tenantId: tenant.id, email: normalized } : null;
}

export async function requestLoginOtp(email: string): Promise<LoginActionResult> {
  const admin = await authorizeAdmin(email);
  if (!admin) {
    return { ok: false, error: "등록된 관리자 이메일이 아닙니다." };
  }
  const result = await issueOtp(admin.tenantId, admin.email);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, devCode: result.devCode };
}

export async function verifyLoginOtp(
  email: string,
  code: string,
): Promise<LoginActionResult> {
  const admin = await authorizeAdmin(email);
  if (!admin) {
    return { ok: false, error: "등록된 관리자 이메일이 아닙니다." };
  }
  if (!/^\d{6}$/.test(code.trim())) {
    return { ok: false, error: "6자리 인증번호를 입력해 주세요." };
  }

  const result = await verifyOtp(admin.tenantId, admin.email, code.trim());
  if (!result.ok) return { ok: false, error: result.error };

  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(admin.email, admin.tenantId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return { ok: true };
}
