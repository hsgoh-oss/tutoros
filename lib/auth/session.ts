import { createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveTenant } from "@/lib/tenant";
import { isMailConfigured, sendOtpMail } from "@/lib/notify/mail";

// 관리자 세션 — 비밀번호 없는 이메일 OTP(6자리·10분 만료·5회 제한·60초 재발송·세션 7일).
//
// 세션은 서버측(admin_sessions, 00013)이다: 쿠키에는 32바이트 랜덤 토큰 원문만 두고,
// DB에는 HMAC-SHA256(AUTH_SECRET) 해시만 저장한다(token_hash) — DB가 유출돼도 토큰을
// 역산할 수 없고, revoked_at 갱신으로 즉시 회수할 수 있다(정본 P-10).
// Supabase 미연결(개발 모드)에서만 기존 무상태 서명 토큰 방식으로 폴백한다.
//
// ⚠️ 배포 주의: 이 전환으로 기존 배포의 구 서명 쿠키는 전부 무효가 된다(DB에 대응 행이
// 없으므로). 전 관리자가 1회 재로그인해야 한다 — 데이터 손실은 없고 세션만 재발급된다.

export const SESSION_COOKIE = "tutoros_admin";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7일
/** 쿠키 maxAge(초) — TTL은 이 파일에서만 정의한다(login actions 등에서 재정의 금지). */
export const SESSION_MAX_AGE_S = SESSION_TTL_MS / 1000;
const OTP_TTL_MS = 10 * 60 * 1000; // 10분
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_INTERVAL_MS = 60 * 1000; // 60초

const DEV_SECRET = "dev-only-secret-change-me";

// 세션 쿠키·OTP 서명 키 — 유출/기본값이면 임의 tenant의 관리자 세션을 위조할 수 있어, 프로덕션에선 미설정 시 즉시 실패한다.
function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s === DEV_SECRET) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "AUTH_SECRET 미설정 — 프로덕션에서는 강력한 무작위 값이 필수입니다(관리자 세션 위조 방지).",
      );
    }
    return DEV_SECRET;
  }
  return s;
}

// 로그인 OTP 요청 rate limit(이메일당 슬라이딩 윈도우). 서버리스에선 인스턴스별로만 동작 — 60초 재발송·5회 캡과 함께 다층 방어.
const otpRequestLog = new Map<string, number[]>();
const OTP_RATE_WINDOW_MS = 10 * 60 * 1000; // 10분
const OTP_RATE_MAX = 5;

function otpRateLimited(email: string, now: number): boolean {
  const recent = (otpRequestLog.get(email) ?? []).filter(
    (t) => now - t < OTP_RATE_WINDOW_MS,
  );
  if (recent.length >= OTP_RATE_MAX) {
    otpRequestLog.set(email, recent);
    return true;
  }
  recent.push(now);
  otpRequestLog.set(email, recent);
  return false;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export interface AdminSession {
  email: string;
  tenantId: string;
  exp: number;
}

/* ---------- 세션 (서버측 admin_sessions + 개발 모드 서명 토큰 폴백) ---------- */

// DB에 저장하는 토큰 해시 — OTP 해시(hashOtp)와 도메인을 분리하기 위해 접두사를 붙인다.
function hashSessionToken(token: string): string {
  return createHmac("sha256", secret())
    .update(`session:${token}`)
    .digest("hex");
}

// 개발 모드(DB 미연결) 전용 — 기존 무상태 서명 토큰 방식을 그대로 보존한 폴백.
function createLegacySessionToken(email: string, tenantId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ email, tenantId, exp: Date.now() + SESSION_TTL_MS }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function verifyLegacySessionToken(token: string): AdminSession | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    ) as AdminSession;
    if (session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export type CreateSessionResult =
  | { ok: true; token: string }
  | { ok: false; error: string };

/**
 * 세션 발급 — admin_sessions에 해시를 insert하고 쿠키에 넣을 원 토큰을 돌려준다.
 * insert 실패 시 쿠키를 발급하면 어차피 검증에 실패하므로 {ok:false}로 로그인 자체를 막는다.
 * DB 미연결(개발 모드)은 기존 서명 토큰으로 폴백(서버측 회수는 불가 — 쿠키 삭제만 유효).
 */
export async function createSession(
  email: string,
  tenantId: string,
): Promise<CreateSessionResult> {
  const db = createServiceClient();
  if (!db) {
    return { ok: true, token: createLegacySessionToken(email, tenantId) };
  }

  const token = randomBytes(32).toString("base64url");
  const { error } = await db.from("admin_sessions").insert({
    tenant_id: tenantId,
    email,
    token_hash: hashSessionToken(token),
    expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  });
  if (error) {
    console.error("[auth] admin_sessions insert failed", error);
    return {
      ok: false,
      error: "세션 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
  return { ok: true, token };
}

/**
 * 현재 요청의 관리자 세션. 쿠키 토큰 → 해시 → admin_sessions 조회(미회수·미만료).
 * 페이지·레이아웃·서버 액션에서 요청당 수차례 호출되므로 React cache()로 요청 단위 메모화.
 * 구 서명 쿠키는 DB에 대응 행이 없어 null — 재로그인으로 자연 전환된다.
 */
export const getAdminSession = cache(
  async (): Promise<AdminSession | null> => {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;

    const db = createServiceClient();
    if (!db) return verifyLegacySessionToken(token); // 개발 모드 폴백

    // 현재 Host의 테넌트로 스코프해 조회한다 — 세션은 발급된 테넌트에서만 유효하고,
    // 타 테넌트 호스트에서 재생된 쿠키는 여기서 무효가 된다(테넌트 격리 원칙).
    const tenant = await resolveTenant();
    const { data, error } = await db
      .from("admin_sessions")
      .select("email, tenant_id, expires_at")
      .eq("tenant_id", tenant.id)
      .eq("token_hash", hashSessionToken(token))
      .is("revoked_at", null)
      .maybeSingle();
    // 조회 실패는 세션 없음과 동일하게 취급(fail-closed) — 불명 상태로 인가하지 않는다.
    if (error) {
      console.error("[auth] admin_sessions lookup failed", error);
      return null;
    }
    if (!data) return null;

    const exp = new Date(data.expires_at as string).getTime();
    if (exp < Date.now()) return null;

    const email = data.email as string;
    // 승계·비활성화 직후의 잔존 세션 차단(정본 P-10) — 지금도 active인 관리자만 인가한다.
    // 로그인 인가(authorizeAdmin)와 동일 정책: 활성 관리자가 전무한 비상 상태의 소유자만 예외.
    const { data: account, error: accountError } = await db
      .from("admin_accounts")
      .select("email")
      .eq("tenant_id", tenant.id)
      .eq("email", email)
      .eq("status", "active")
      .maybeSingle();
    if (accountError) {
      console.error("[auth] admin_accounts active check failed", accountError);
      return null; // fail-closed — 불명 상태로 인가하지 않는다
    }
    if (!account) {
      if (email.toLowerCase() !== tenant.email.toLowerCase()) return null;
      const { count, error: countError } = await db
        .from("admin_accounts")
        .select("email", { count: "exact", head: true })
        .eq("tenant_id", tenant.id)
        .eq("status", "active");
      if (countError || (count ?? 0) > 0) return null;
      console.warn("[auth] 활성 관리자 0명 — 소유자 세션을 안전망으로 인가");
    }
    return { email, tenantId: data.tenant_id as string, exp };
  },
);

/**
 * 특정 이메일의 활성 세션 전부 회수(revoked_at 갱신 — 행 삭제 없음, 이력 보존).
 * 전 세션 로그아웃·운영자 승계 등에서 사용한다.
 */
export async function revokeSessions(
  tenantId: string,
  email: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const db = createServiceClient();
  if (!db) {
    return { ok: false, error: "DB 미연결 — 세션 회수를 실행할 수 없습니다." };
  }
  const { error } = await db
    .from("admin_sessions")
    .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq("tenant_id", tenantId)
    .eq("email", email)
    .is("revoked_at", null);
  if (error) {
    console.error("[auth] revokeSessions failed", error);
    return { ok: false, error: "세션 회수에 실패했습니다." };
  }
  return { ok: true };
}

/**
 * 쿠키 토큰으로 해당 세션 한 건만 회수(로그아웃 경로). 실패해도 던지지 않는다 —
 * 로그아웃은 쿠키 삭제만으로도 성립하며, 회수 실패는 로그로만 남긴다.
 */
export async function revokeSessionByToken(
  token: string,
  reason: string,
): Promise<void> {
  const db = createServiceClient();
  if (!db) return; // 개발 모드 — 무상태 토큰은 회수할 서버측 행이 없다
  // 세션 조회(getAdminSession)와 동일하게 현재 Host의 테넌트로 스코프한다.
  const tenant = await resolveTenant();
  const { error } = await db
    .from("admin_sessions")
    .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq("tenant_id", tenant.id)
    .eq("token_hash", hashSessionToken(token))
    .is("revoked_at", null);
  if (error) console.error("[auth] revokeSessionByToken failed", error);
}

/* ---------- OTP ---------- */

// 개발 모드(DB 미연결)용 인메모리 OTP 저장 — 키를 테넌트별로 분리(DB 복합 PK (tenant_id, email)와 동일 격리).
const devOtps = new Map<
  string,
  { codeHash: string; expiresAt: number; attempts: number; issuedAt: number }
>();

function devKey(tenantId: string, email: string): string {
  return `${tenantId}:${email}`;
}

function hashOtp(email: string, code: string): string {
  return createHmac("sha256", secret()).update(`${email}:${code}`).digest("hex");
}

/** OTP 해시 비교. 세션 서명 검증과 동일하게 상수시간으로 맞춘다. */
function hashEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface OtpResult {
  ok: boolean;
  error?: string;
  /** 개발 모드에서만 채워짐 — 메일 발송 대신 화면/로그로 전달 */
  devCode?: string;
}

// OTP를 메일 대신 화면에 표시할지 — AUTH_DEV_MODE 하나로만 통제한다(미설정=꺼짐).
// 이전엔 host가 *.vercel.app이면 자동으로 켜지는 게이트가 있었는데, 프리뷰 배포도 실 DB를 공유해
// 관리자 이메일만 알면 로그인이 뚫리는 백도어였다. 호스트 기반 활성화는 제거한다.
function devOtpVisible(): boolean {
  return process.env.AUTH_DEV_MODE === "true";
}

/**
 * 미등록 이메일에 대한 "발급한 척" — 계정 존재를 노출하지 않기 위한 것이다(P-02와 같은 규율).
 *
 * 아무것도 발급·발송하지 않지만 rate limit 슬롯은 똑같이 먹는다. 그래야 미등록 주소로
 * 무제한 탐색하며 등록 주소와 응답 차이를 재는 경로가 생기지 않는다.
 */
export function noteOtpDecoyRequest(email: string): void {
  otpRateLimited(email.trim().toLowerCase(), Date.now());
}

export async function issueOtp(tenantId: string, email: string): Promise<OtpResult> {
  const now = Date.now();
  if (otpRateLimited(email, now)) {
    return { ok: false, error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." };
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const codeHash = hashOtp(email, code);
  const db = createServiceClient();

  if (db) {
    const { data: existing } = await db
      .from("admin_otps")
      .select("issued_at")
      .eq("tenant_id", tenantId)
      .eq("email", email)
      .maybeSingle();
    if (
      existing &&
      now - new Date(existing.issued_at).getTime() < OTP_RESEND_INTERVAL_MS
    ) {
      return { ok: false, error: "60초 후에 다시 요청해 주세요." };
    }
    await db.from("admin_otps").upsert(
      {
        tenant_id: tenantId,
        email,
        code_hash: codeHash,
        expires_at: new Date(now + OTP_TTL_MS).toISOString(),
        attempts: 0,
        issued_at: new Date(now).toISOString(),
      },
      { onConflict: "tenant_id,email" },
    );
  } else {
    const key = devKey(tenantId, email);
    const existing = devOtps.get(key);
    if (existing && now - existing.issuedAt < OTP_RESEND_INTERVAL_MS) {
      return { ok: false, error: "60초 후에 다시 요청해 주세요." };
    }
    devOtps.set(key, {
      codeHash,
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      issuedAt: now,
    });
  }

  if (devOtpVisible()) {
    console.warn(`[dev] OTP for ${email}: ${code}`);
    return { ok: true, devCode: code };
  }
  if (isMailConfigured()) {
    const mailResult = await sendOtpMail(email, code);
    if (!mailResult.ok) {
      return {
        ok: false,
        error: "인증 메일 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      };
    }
    return { ok: true };
  }
  console.warn(`[otp] 메일 서비스 미연동 — ${email} 코드 발급됨(로그 미노출)`);
  return { ok: true };
}

export async function verifyOtp(
  tenantId: string,
  email: string,
  code: string,
): Promise<OtpResult> {
  const now = Date.now();
  const db = createServiceClient();

  if (db) {
    const { data: row } = await db
      .from("admin_otps")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("email", email)
      .maybeSingle();
    if (!row) return { ok: false, error: "인증번호를 먼저 요청해 주세요." };
    if (new Date(row.expires_at).getTime() < now) {
      return { ok: false, error: "인증번호가 만료되었습니다. 다시 요청해 주세요." };
    }
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      return { ok: false, error: "시도 횟수를 초과했습니다. 다시 요청해 주세요." };
    }
    if (!hashEquals(row.code_hash, hashOtp(email, code))) {
      await db
        .from("admin_otps")
        .update({ attempts: row.attempts + 1 })
        .eq("tenant_id", tenantId)
        .eq("email", email);
      return { ok: false, error: "인증번호가 올바르지 않습니다." };
    }
    await db
      .from("admin_otps")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("email", email);
    return { ok: true };
  }

  const key = devKey(tenantId, email);
  const row = devOtps.get(key);
  if (!row) return { ok: false, error: "인증번호를 먼저 요청해 주세요." };
  if (row.expiresAt < now) {
    return { ok: false, error: "인증번호가 만료되었습니다. 다시 요청해 주세요." };
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, error: "시도 횟수를 초과했습니다. 다시 요청해 주세요." };
  }
  if (!hashEquals(row.codeHash, hashOtp(email, code))) {
    row.attempts += 1;
    return { ok: false, error: "인증번호가 올바르지 않습니다." };
  }
  devOtps.delete(key);
  return { ok: true };
}
