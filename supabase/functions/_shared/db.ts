// Deno Edge Function 공용 Supabase 클라이언트. URL/SERVICE_ROLE_KEY는 Supabase가 자동 주입한다.
// service_role은 RLS를 우회하므로, 각 job 함수가 반드시 조회 결과의 tenant_id로 스코프를 지켜 써야 한다.

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
