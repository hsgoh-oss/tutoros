-- TUTOR OS Phase 1 — 초기 스키마 (기능기획서 v2.1 §5 DB 설계)
-- 원칙: 계정별 전 테이블 tenant_id + RLS 전면 적용. 서버는 service_role로 접근하되
-- 앱 레이어에서 tenant 스코프를 강제하고, authenticated 역할은 JWT tenant_id 클레임으로 격리한다.

create extension if not exists pgcrypto;

/* ---------- 공통 함수 ---------- */

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- JWT 클레임에서 tenant_id 추출 (authenticated 역할용 RLS)
-- 클레임 누락·비정상 문자열은 NULL 반환(fail-closed) — cast 에러로 요청이 죽지 않게 방어
create or replace function public.jwt_tenant_id()
returns uuid language sql stable as $$
  select case
    when coalesce(auth.jwt() ->> 'tenant_id', '')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (auth.jwt() ->> 'tenant_id')::uuid
  end
$$;

/* ---------- 플랫폼 공통 ---------- */

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  brand_name text not null,
  email text not null unique,
  plan text not null default 'starter'
    check (plan in ('starter', 'standard', 'pro', 'pro_plus')),
  plan_status text not null default 'trial'
    check (plan_status in ('trial', 'active', 'suspended')),
  custom_domain text unique,
  subdomain text unique,
  domain_verified boolean not null default false,
  trial_ends_at timestamptz,
  tutor_report_no text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 관리자 이메일 OTP (비밀번호 없는 로그인 — 6자리·10분·5회)
-- 관리자 OTP. tenant_id를 PK에 포함해야 한다 — email 단독 PK로 두면 한 사람이 두 테넌트를
-- 같은 이메일로 운영할 때 OTP 레코드가 서로를 덮어써서(upsert) 먼저 발급한 쪽의 코드가 무효화되고,
-- 60초 재발송 제한·5회 시도 카운터도 테넌트 간에 공유된다.
-- RLS 정책은 부여하지 않는다 = service_role 전용 (인증 전 단계라 authenticated 컨텍스트가 없다).
create table public.admin_otps (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  issued_at timestamptz not null default now(),
  primary key (tenant_id, email)
);

/* ---------- 계정별 (전 테이블 tenant_id + RLS) ---------- */

create table public.site_settings (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

create table public.theme_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  primary_color text,
  font text,
  logo_url text,
  layout_config jsonb not null default '{}'::jsonb,
  editable_sections jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.ddays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  exam_date date not null,
  is_visible boolean not null default true,
  sort_order int not null default 0
);

create table public.recruit_status (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  status text not null default 'open'
    check (status in ('open', 'closing', 'waitlist', 'closed')),
  message text not null default '',
  seat_count int,
  is_banner_visible boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.page_contents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  page text not null,
  section text not null,
  content jsonb not null default '{}'::jsonb,
  is_visible boolean not null default true,
  sort_order int not null default 0,
  updated_at timestamptz not null default now(),
  unique (tenant_id, page, section)
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  parent_phone text not null,
  student_phone text, -- 선택·동의 기반 (consents 기록 필수)
  school text,
  grade text,
  class_type text not null default 'inperson'
    check (class_type in ('inperson', 'video')),
  subject_type text,
  status text not null default 'active'
    check (status in ('trial', 'active', 'paused', 'ended')),
  notion_page_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id) -- 자식 테이블 복합 FK용 — 부모·자식 테넌트 일치를 DB에서 보장
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  reviewer_type text not null check (reviewer_type in ('student', 'parent')),
  content text not null,
  rating int not null default 5 check (rating between 1 and 5),
  before_grade text,
  after_grade text,
  meta jsonb, -- region·grade·track·source·reviewed_at
  ai_tags text[] not null default '{}',
  screenshots text[] not null default '{}',
  is_pinned boolean not null default false,
  student_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete set null (student_id)
);

create table public.faqs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  category text not null default '일반',
  question text not null,
  answer text not null,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_id uuid not null,
  lesson_date date not null,
  session_number int not null default 1, -- 회차 자동 계산
  content text not null default '',
  homework text,
  concentration int check (concentration between 1 and 5),
  attitude int check (attitude between 1 and 5),
  absent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade
);

create table public.ai_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_id uuid,
  type text not null
    check (type in ('lesson', 'weekly', 'monthly', 'exam', 'consult_brief')),
  audience text not null default 'parent'
    check (audience in ('parent', 'student', 'internal')),
  depth text not null default 'basic' check (depth in ('basic', 'deep')),
  content text not null default '',
  model_used text,
  token_usage int,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'sent', 'failed')),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade
);

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_id uuid not null,
  scheduled_at timestamptz not null,
  class_type text not null default 'inperson'
    check (class_type in ('inperson', 'video')),
  status text not null default 'planned'
    check (status in ('planned', 'done', 'canceled', 'makeup')),
  reminder_sent boolean not null default false,
  lesson_id uuid, -- 완료 시 수업 기록 연결
  foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade,
  foreign key (tenant_id, lesson_id)
    references public.lessons (tenant_id, id) on delete set null (lesson_id)
);

create table public.grade_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_id uuid not null,
  exam_name text not null,
  exam_date date,
  raw_score numeric,
  percentile numeric,
  grade text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade
);

create table public.lesson_materials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_id uuid,
  lesson_id uuid,
  name text not null,
  file_url text not null,
  is_shared boolean not null default false, -- 학부모 공유 여부
  created_at timestamptz not null default now(),
  foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade,
  foreign key (tenant_id, lesson_id)
    references public.lessons (tenant_id, id) on delete set null (lesson_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_id uuid not null,
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  amount int not null check (amount >= 0),
  method text not null check (method in ('toss', 'payssaem', 'bank')),
  status text not null default 'pending'
    check (status in ('draft', 'pending', 'paid', 'overdue')),
  due_date date,
  pay_url text, -- 토스 링크 전용
  toss_payment_key text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade
);

create table public.consultations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  phone text not null,
  subject text,
  class_type text check (class_type in ('inperson', 'video')),
  message text,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'trial', 'registered', 'hold')),
  is_student_self boolean not null default false, -- 학생 본인 신청 토글
  birth_year int, -- 본인 신청 시 생년 → 만 14세 미만 판별
  guardian_name text, -- 만 14세 미만 필수
  guardian_phone text,
  checklist_items text[] not null default '{}', -- 메인 자기진단 선택 항목
  prefill jsonb, -- mode/hours/freq (수업료 계산기에서 넘어온 값)
  memo text,
  student_id uuid, -- 학생 전환 원클릭
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 학생 본인 신청이면 생년 필수 (만 14세 판별 근거 — 보호자 필수 여부는 앱 레이어에서 재검증)
  check (not is_student_self or birth_year is not null),
  foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete set null (student_id)
);

-- consents.subject_id는 의도적으로 FK 없음(polymorphic): 동의 이력은 법적 증적으로
-- 원본(상담·학생)이 삭제돼도 방침 버전·일시와 함께 보존되어야 한다(기획 7장).
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  subject_type text not null
    check (subject_type in ('consultation', 'student', 'guardian')),
  subject_id uuid not null,
  item text not null
    check (item in ('privacy', 'overseas_ai', 'marketing', 'review', 'student_phone')),
  policy_version text not null default 'v1',
  consented_at timestamptz not null default now(),
  via text not null default 'form'
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_id uuid,
  type text not null, -- 알림 12종 키 (consult_received 등)
  channel text not null default 'alimtalk' check (channel in ('alimtalk', 'sms')),
  phone text not null,
  message text not null,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'failed')),
  is_ad boolean not null default false, -- 광고성 분리 (수신동의·야간 금지)
  retry_count int not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete set null (student_id)
);

create table public.backups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  target text not null, -- 콘텐츠 항목별 (page_contents·faqs·reviews·settings 등)
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

/* ---------- 인덱스 ---------- */

create index idx_ddays_tenant on public.ddays (tenant_id, sort_order);
create index idx_page_contents_tenant on public.page_contents (tenant_id, page);
create index idx_reviews_tenant on public.reviews (tenant_id, is_pinned);
create index idx_faqs_tenant on public.faqs (tenant_id, sort_order);
create index idx_students_tenant on public.students (tenant_id, status);
create index idx_lessons_tenant on public.lessons (tenant_id, lesson_date desc);
create index idx_lessons_student on public.lessons (student_id, lesson_date desc);
create index idx_ai_reports_tenant on public.ai_reports (tenant_id, created_at desc);
create index idx_schedules_tenant on public.schedules (tenant_id, scheduled_at);
create index idx_grade_records_student on public.grade_records (student_id);
create index idx_materials_tenant on public.lesson_materials (tenant_id);
create index idx_payments_tenant on public.payments (tenant_id, status);
create index idx_payments_student on public.payments (student_id);
create index idx_consultations_tenant on public.consultations (tenant_id, status);
create index idx_consents_subject on public.consents (tenant_id, subject_type, subject_id);
create index idx_notifications_tenant on public.notifications (tenant_id, created_at desc);
create index idx_backups_tenant on public.backups (tenant_id, target, created_at desc);

/* ---------- updated_at 트리거 ---------- */

do $$
declare t text;
begin
  foreach t in array array[
    'tenants','site_settings','theme_settings','recruit_status','page_contents',
    'students','reviews','faqs','lessons','payments','consultations'
  ] loop
    execute format(
      'create trigger trg_%s_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

/* ---------- RLS (전면 적용) ----------
   service_role: RLS 우회(서버 전용 — 앱 레이어에서 tenant 스코프 강제).
   authenticated: JWT tenant_id 클레임 일치 행만 접근.
   anon: 정책 없음 = 전체 차단 (공개 사이트는 서버 렌더 경유). */

do $$
declare t text;
begin
  foreach t in array array[
    'tenants','admin_otps','site_settings','theme_settings','ddays','recruit_status',
    'page_contents','students','reviews','faqs','lessons','ai_reports','schedules',
    'grade_records','lesson_materials','payments','consultations','consents',
    'notifications','backups'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- 계정별 테이블: tenant_id 격리 정책 (authenticated)
do $$
declare t text;
begin
  foreach t in array array[
    'site_settings','theme_settings','ddays','recruit_status','page_contents',
    'students','reviews','faqs','lessons','ai_reports','schedules','grade_records',
    'lesson_materials','payments','consultations','consents','notifications','backups'
  ] loop
    execute format(
      'create policy tenant_isolation on public.%I
         for all to authenticated
         using (tenant_id = public.jwt_tenant_id())
         with check (tenant_id = public.jwt_tenant_id())', t);
  end loop;
end $$;

-- tenants: 본인 테넌트 행만 조회 가능
create policy tenant_self_read on public.tenants
  for select to authenticated
  using (id = public.jwt_tenant_id());
