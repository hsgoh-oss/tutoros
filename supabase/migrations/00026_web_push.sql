-- 00026: 웹 푸시(PWA Push) 구독·전달 기록
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 왜 만드는가
--
-- 이용약관 제12조·수업 운영 정책 제4조는 "포털 가입 뒤 일정·과제·리포트·결제 상태는 PWA Push로
-- 최소한 알릴 수 있다"고 약속하고, 동시에 "Push 실패를 Gmail이나 문자로 자동 전환하지 않는다"고
-- 못 박는다. 그래서 푸시는 알림톡·SMS 큐(notifications)와 **다른 층**이다 — 같은 사건을 두 채널로
-- 같이 알리되, 한쪽의 실패가 다른 쪽을 대신 보내지 않는다. 이 표는 그 다른 층의 원장이다.
--
-- 대상은 둘이다:
--   · admin  — 운영자 브라우저. 새 상담·신청서·후기 제출·과제 제출·질문이 들어오면 즉시 알린다.
--   · portal — 초대로 가입한 포털 사용자(portal_contacts). 알림톡으로 나가는 같은 안내를 기기에도 띄운다.
--
-- 구독은 기기·브라우저 단위다(같은 사람이 폰·PC 둘 다 구독할 수 있다). endpoint가 곧 기기의 주소이고
-- 유일하다. 푸시 서비스가 404·410을 돌려주면 그 구독은 죽은 것이다 — 행을 지우지 않고 disabled_at을
-- 찍어 "언제부터 안 갔는지"를 남긴다(다시 켜면 새 endpoint로 새 행이 생긴다).
--
-- 개인정보: endpoint·키는 기기 식별자이지 사람 정보가 아니지만, 구독자(운영자 이메일·포털 연락처)와
-- 연결되므로 tenant 격리(RLS)와 같은 규칙을 받는다. 본문은 push_deliveries에 남기지 않는다 —
-- 알림 본문은 notifications가 이미 갖고 있고, 여기엔 제목·종류·결과만 둔다.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  audience text not null check (audience in ('admin', 'portal')),
  -- admin: 운영자 이메일 / portal: 포털 연락처. 대상 종류에 맞는 쪽 하나만 채운다(CHECK).
  admin_email text,
  contact_id uuid,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_reason text,
  foreign key (tenant_id, contact_id)
    references public.portal_contacts (tenant_id, id) on delete cascade,
  constraint push_subscriptions_owner
    check (
      (audience = 'admin'  and admin_email is not null and contact_id is null) or
      (audience = 'portal' and contact_id is not null and admin_email is null)
    )
);

create index idx_push_subscriptions_admin
  on public.push_subscriptions (tenant_id, admin_email)
  where audience = 'admin' and disabled_at is null;
create index idx_push_subscriptions_contact
  on public.push_subscriptions (tenant_id, contact_id)
  where audience = 'portal' and disabled_at is null;

-- 전달 기록 — 무엇을(kind·title) 어느 기기에 보냈고 어떻게 됐는지. 본문은 담지 않는다.
create table public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  subscription_id uuid references public.push_subscriptions (id) on delete set null,
  audience text not null check (audience in ('admin', 'portal')),
  kind text not null,          -- 사건 종류(예: consult_received · homework_submitted · lesson_report)
  title text not null,
  status text not null check (status in ('sent', 'failed', 'gone')),
  error text,
  created_at timestamptz not null default now()
);

create index idx_push_deliveries_recent
  on public.push_deliveries (tenant_id, created_at desc);

alter table public.push_subscriptions enable row level security;
alter table public.push_deliveries enable row level security;

create policy tenant_isolation on public.push_subscriptions
  for all to authenticated
  using (tenant_id = public.jwt_tenant_id())
  with check (tenant_id = public.jwt_tenant_id());

create policy tenant_isolation on public.push_deliveries
  for all to authenticated
  using (tenant_id = public.jwt_tenant_id())
  with check (tenant_id = public.jwt_tenant_id());
