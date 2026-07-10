// Deno Edge Function 공용 Supabase 클라이언트.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY는 Supabase가 모든 Edge Function에 자동 주입한다
// (프로젝트 시크릿 설정 불필요) — service_role 이므로 RLS를 우회해 전 테넌트를 다룬다.
// 앱 레이어(각 job 함수)가 반드시 조회 결과의 tenant_id로 스코프를 지켜 써야 한다.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY 미설정");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export type { SupabaseClient };
