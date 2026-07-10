import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { isMailConfigured, sendOtpMail } from "@/lib/notify/mail";

// 관리자 세션 — 비밀번호 없는 이메일 OTP(6자리·10분 만료·5회 제한·60초 재발송·세션 7일).
// 세션 토큰은 HMAC-SHA256 서명 쿠키(서버 전용 시크릿). Supabase 미연결 시 개발 모드로 동작.

export const SESSION_COOKIE = "tutoros_admin";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7일
const OTP_TTL_MS = 10 * 60 * 1000; // 10분
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_INTERVAL_MS = 60 * 1000; // 60초

function secret(): string {
  return process.env.AUTH_SECRET ?? "dev-only-secret-change-me";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export interface AdminSession {
  email: string;
  tenantId: string;
  exp: number;
}

export function createSessionToken(email: string, tenantId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ email, tenantId, exp: Date.now() + SESSION_TTL_MS }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string): AdminSession | null {
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

/** 서버 컴포넌트/액션에서 현재 관리자 세션 조회 (미인증 시 null) */
export async function getAdminSession(): Promise<AdminSession | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/* ---------- OTP ---------- */

// 개발 모드(DB 미연결)용 인메모리 저장 — 프로덕션은 admin_otps 테이블 사용.
// 키는 테넌트별로 분리한다(DB의 복합 PK (tenant_id, email)와 동일한 격리).
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

/** OTP 해시 비교. 세션 서명(verifySessionToken)과 동일하게 상수시간으로 맞춘다. */
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

export async function issueOtp(tenantId: string, email: string): Promise<OtpResult> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const codeHash = hashOtp(email, code);
  const now = Date.now();
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

  if (process.env.AUTH_DEV_MODE === "true") {
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
