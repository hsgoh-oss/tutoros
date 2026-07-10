import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// 서버 전용 클라이언트 — 키는 절대 클라이언트로 노출하지 않는다.
// Supabase 미연결(로컬 개발 초기) 시 null을 반환하고, 호출부는 기본 콘텐츠로 폴백한다.

let cached: SupabaseClient | null = null;

export function hasDb(): boolean {
  return Boolean(
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function createServiceClient(): SupabaseClient | null {
  if (!hasDb()) return null;
  if (cached) return cached;
  cached = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return cached;
}
