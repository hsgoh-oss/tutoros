import { cache } from "react";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { DEFAULT_TENANT } from "@/lib/defaults";
import type { Tenant } from "@/lib/types";

// Host 헤더 → 테넌트 리졸브 (멀티테넌트 원칙 §4).
// custom_domain 정확 일치 → {slug}.tutoros.kr 서브도메인 → 기본 테넌트(1호, 개발용).

interface TenantRow {
  id: string;
  brand_name: string;
  email: string;
  plan: Tenant["plan"];
  plan_status: Tenant["planStatus"];
  custom_domain: string | null;
  subdomain: string | null;
  domain_verified: boolean;
  tutor_report_no: string | null;
  // 00019 이전 스키마(컬럼 없음)에서도 select "*"는 성공하고 값만 undefined로 온다 —
  // 그래서 옵셔널로 받고 ?? null로 정규화한다.
  payssam_member_id?: string | null;
  payssam_merchant_id?: string | null;
}

function mapTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    brandName: row.brand_name,
    email: row.email,
    plan: row.plan,
    planStatus: row.plan_status,
    customDomain: row.custom_domain,
    subdomain: row.subdomain,
    domainVerified: row.domain_verified,
    tutorReportNo: row.tutor_report_no,
    // 결제선생 하위사업장 매핑(00019) — 이 테넌트의 청구가 나갈 사업장. null이면 환경변수 폴백.
    payssamMemberId: row.payssam_member_id ?? null,
    payssamMerchantId: row.payssam_merchant_id ?? null,
  };
}

export const resolveTenant = cache(async (): Promise<Tenant> => {
  const db = createServiceClient();
  if (!db) return DEFAULT_TENANT;

  const h = await headers();
  const host = (h.get("x-tenant-host") ?? h.get("host") ?? "")
    .split(":")[0]
    .toLowerCase();
  if (!host) return DEFAULT_TENANT;

  const { data: byDomain } = await db
    .from("tenants")
    .select("*")
    .eq("custom_domain", host)
    .maybeSingle();
  if (byDomain) return mapTenant(byDomain as TenantRow);

  const slug = host.split(".")[0];
  const { data: bySlug } = await db
    .from("tenants")
    .select("*")
    .eq("subdomain", slug)
    .maybeSingle();
  if (bySlug) return mapTenant(bySlug as TenantRow);

  return DEFAULT_TENANT;
});
