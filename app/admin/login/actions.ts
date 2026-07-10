"use server";

import { cookies } from "next/headers";
import { resolveTenant } from "@/lib/tenant";
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

// 현재 Host의 테넌트 관리자 이메일과 일치할 때만 OTP를 발급한다(테넌트당 관리자 1인).
// OTP 레코드는 (tenant_id, email)로 격리되므로 테넌트 식별자를 함께 돌려준다.
interface AuthorizedAdmin {
  tenantId: string;
  email: string;
}

async function authorizeAdmin(email: string): Promise<AuthorizedAdmin | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const tenant = await resolveTenant();
  return normalized === tenant.email.toLowerCase()
    ? { tenantId: tenant.id, email: normalized }
    : null;
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
