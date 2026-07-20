-- 00006: 관리자 기능 보강 — 후기 정렬 + 변경 이력 로그

-- 후기 수동 순서 정렬(FAQ와 동일 패턴)
alter table public.reviews add column sort_order int not null default 0;
create index idx_reviews_sort on public.reviews (tenant_id, sort_order);

-- 변경 이력 로그(감사) — 주요 mutation을 기록. 전 테이블 tenant_id + RLS 원칙 준수.
create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  actor_email text,
  action text not null,        -- create | update | delete | send 등
  target_type text not null,   -- student | lesson | payment | review | faq | ...
  target_id uuid,
  summary text not null default '',
  created_at timestamptz not null default now()
);
create index idx_activity_log_tenant on public.activity_log (tenant_id, created_at desc);

alter table public.activity_log enable row level security;
create policy tenant_isolation on public.activity_log
  for all to authenticated
  using (tenant_id = public.jwt_tenant_id())
  with check (tenant_id = public.jwt_tenant_id());
