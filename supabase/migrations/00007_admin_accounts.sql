-- 00007: 다중 관리자 계정 — "테넌트당 관리자 1인" 제약 완화.
-- 기존엔 tenants.email 단독이 유일한 관리자였다. 이 테이블로 테넌트당 여러 관리자를 허용하고,
-- 로그인 인가(app/admin/login/actions.ts authorizeAdmin)가 이 테이블 등록 여부로 판단한다.
-- admin_otps와 동일 범주 — 인증 전 단계라 authenticated 컨텍스트가 없어 RLS 없이 service_role 전용.
create table public.admin_accounts (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, email)
);

-- 기존 소유자(tenants.email)를 관리자로 백필 — 로그인 회귀 방지(이메일은 소문자 정규화).
insert into public.admin_accounts (tenant_id, email)
select id, lower(email) from public.tenants
on conflict (tenant_id, email) do nothing;
