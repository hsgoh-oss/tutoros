"use server";

import { cookies } from "next/headers";
import { resolveTenant } from "@/lib/tenant";
import { createServiceClient } from "@/lib/supabase/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  createSession,
  issueOtp,
  noteOtpDecoyRequest,
  verifyOtp,
} from "@/lib/auth/session";
import { logActivity } from "@/lib/data/activity";

export interface LoginActionResult {
  ok: boolean;
  error?: string;
  /** AUTH_DEV_MODE=true일 때만 — 메일 발송 대신 화면에 표시 */
  devCode?: string;
}

// 현재 Host의 테넌트에서 status='active'인 관리자 이메일일 때만 OTP를 발급한다.
// 00013 이후 활성 운영자는 테넌트당 1인(admin_accounts_one_active_per_tenant) — inactive로
// 전환된 구 운영자는 인가하지 않는다. 소유자(tenants.email) 폴백은 "해당 테넌트에 active 행이
// 하나도 없을 때"만 허용한다(마이그레이션 직후 안전망 — 정상 운영에선 발동하지 않아야 한다).
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
      .eq("status", "active")
      .maybeSingle();
    if (data) return { tenantId: tenant.id, email: normalized };

    // 소유자 폴백 — active 관리자가 0명일 때만(백필 누락·초기 상태 안전망).
    // active가 1명이라도 있으면 소유자라도 그 운영자만 인가한다(단일 활성 운영자 원칙).
    if (isOwner) {
      const { count } = await db
        .from("admin_accounts")
        .select("email", { count: "exact", head: true })
        .eq("tenant_id", tenant.id)
        .eq("status", "active");
      if ((count ?? 0) === 0) {
        console.warn(
          `[auth] tenant ${tenant.id}에 active 관리자 없음 — 소유자(${normalized}) 폴백 인가`,
        );
        return { tenantId: tenant.id, email: normalized };
      }
    }
    return null;
  }

  // DB 미연결(개발 모드) — 테넌트 소유자 이메일만 허용.
  return isOwner ? { tenantId: tenant.id, email: normalized } : null;
}

export async function requestLoginOtp(email: string): Promise<LoginActionResult> {
  const admin = await authorizeAdmin(email);
  if (!admin) {
    // 계정 존재를 노출하지 않는다 — 미등록 주소도 발급 성공과 **같은 화면·같은 응답**으로
    // 수렴시킨다(코드 입력 단계 + 60초 재발송 타이머). 예전에는 "등록된 관리자 이메일이
    // 아닙니다."로 답해, 주소를 넣어보는 것만으로 운영자 계정을 확인할 수 있었다.
    // 같은 레포의 포털 링크(/p/link)·신청서(/f)는 이미 이 규율을 지키고 있다.
    //
    // 발급·발송은 하지 않지만 rate limit은 똑같이 먹는다(무제한 탐색 차단).
    noteOtpDecoyRequest(email);
    return { ok: true };
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
  if (!/^\d{6}$/.test(code.trim())) {
    return { ok: false, error: "6자리 인증번호를 입력해 주세요." };
  }
  if (!admin) {
    // 요청 단계와 같은 이유로 사유를 구분하지 않는다 — 등록 주소에 틀린 코드를 넣었을 때와
    // 똑같은 문구로 수렴시킨다(형식 검사는 위에서 먼저 하므로 순서도 동일하다).
    return { ok: false, error: "인증번호가 올바르지 않습니다." };
  }

  const result = await verifyOtp(admin.tenantId, admin.email, code.trim());
  if (!result.ok) return { ok: false, error: result.error };

  // 서버측 세션 발급 — insert 실패면 쿠키를 만들지 않고 로그인 실패로 처리(불명 상태 인가 금지).
  const session = await createSession(admin.email, admin.tenantId);
  if (!session.ok) return { ok: false, error: session.error };

  const store = await cookies();
  store.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });

  // 로그인 성공 기록 — 세션 발급은 권한 '변경'이 아닌 인증 이벤트라 fail-open logActivity로
  // 충분하다(기록 실패가 로그인을 막을 이유가 없다). 연속 실패 5회 잠금 같은 이상 징후
  // 대응은 M8(보안 관제) 몫 — 여기서는 성공 이벤트만 남긴다.
  await logActivity(
    admin.tenantId,
    admin.email,
    "admin_login",
    "admin_account",
    null,
    `관리자 로그인: ${admin.email}`,
  );
  return { ok: true };
}
