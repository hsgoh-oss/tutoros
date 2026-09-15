import { createServiceClient } from "@/lib/supabase/server";
import type { PayssamAccount } from "./client";

/** 요청 Host 대신 인증된 세션/결제 행의 테넌트로 사업장을 정한다. */
export async function getPayssamAccount(tenantId: string): Promise<PayssamAccount | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data, error } = await db.from("tenants")
    .select("payssam_member_id, payssam_merchant_id").eq("id", tenantId).maybeSingle();
  if (error || !data) return null;
  return { payssamMemberId: data.payssam_member_id, payssamMerchantId: data.payssam_merchant_id };
}
