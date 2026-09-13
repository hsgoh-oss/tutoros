-- 00025: 후기·성적사례 작성 초대 → 작성자 제출 → 운영자 검토 워크플로 (S-01·S-03) · 동의 항목 구조 개편
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 왜 만드는가
--
-- 정본 S-01은 "운영자 확인 → 작성 초대 발급 → 전달 → 작성자 본인·대상 관계 확인 → 후기 또는
-- 성적사례 선택 → 공개 동의 확인 → 작성 → 제출 → 운영자 검토 업무"다. 지금까지 후기는 운영자가
-- 대필 등록하고 승인 한 번으로 게시됐다(00016). 작성자 제출 경로·초대·보완 요청·거절·철회가
-- 코드에 없었다(판정 2026-09-10: S-01 🔶 · S-03 🔶).
--
-- 이 마이그레이션은 그 앞단(초대·제출)과 검토 결정 세 갈래(보완 요청·거절·승인) 그리고
-- 공개용 최소 본 확인·게시·철회를 데이터로 세운다. 운영자는 본문을 고치지 못한다 — 운영자가
-- 할 수 있는 일은 상태를 옮기는 것뿐이고, 본문 수정은 작성자에게 돌려보내(revision_requested)
-- 새 제출본으로만 이뤄진다(S-03 "보완 요청 → 작성자에게 반환 → 새 제출본").
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 상태 흐름 (reviews.status)
--
--   submitted(작성자 제출) ─▶ in_review(검토 시작) ─┬▶ revision_requested(수정 요청 → 새 링크 발송)
--                                                   │        └▶ (재제출) submitted
--                                                   ├▶ rejected(반려 — 사유 안내, 공개 금지)
--                                                   └▶ approved(승인) ─▶ [마스킹·최소정보 확인]
--                                                                          └▶ published(게시) ─▶ retracted(철회)
--   draft = 옛 운영자 대필 등록분(00016 호환). submitted와 같은 자리로 취급한다(검토 시작 가능).
--
-- 게시(published)는 masking_confirmed_at 없이는 성립하지 않는다(CHECK) — "공개용 최소 본 확정"
-- 단계를 건너뛸 수 없다. 철회는 행을 지우지 않는다(S-03 "철회 증명만 최소 보존").
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 동의 항목 (consents.item)
--
--   terms(이용약관·필수) · privacy(상담 개인정보 처리·필수) · overseas_ai(AI 처리·국외이전·선택)
--   · marketing(마케팅·선택) · review(후기·사례 공개 — 건별 선택) · review_image(사례 이미지 공개 —
--   이미지가 있을 때 별도 선택) · guardian(미성년 게시 — 법정대리인 동의; 운영자 확인 전 승인 금지)
--   · student_phone(기존).

/* ---------- ① 동의 항목 확장 ---------- */

alter table public.consents drop constraint consents_item_check;
alter table public.consents add constraint consents_item_check
  check (item in (
    'terms', 'privacy', 'overseas_ai', 'marketing',
    'review', 'review_image', 'guardian', 'student_phone'
  ));

/* ---------- ② reviews — 종류·작성자·마스킹·검토 이력 ---------- */

-- 자식 테이블 복합 FK용(부모·자식 테넌트 일치 보장 — students와 같은 관례).
alter table public.reviews add constraint reviews_tenant_id_key unique (tenant_id, id);

alter table public.reviews
  -- 후기(review) / 성적 향상 사례(case) — 사례는 전·후 등급과 라벨(meta.before_label·after_label)을 갖는다.
  add column kind text not null default 'review' check (kind in ('review', 'case')),
  -- 공개 화면에 쓰는 마스킹 이름(예: 홍*동) — 제출 시 승인된 규칙(lib/review/masking.ts)으로 생성.
  add column public_name text,
  -- 사례 이미지 공개 동의(review_image) 여부 — false면 증빙은 검토 근거로만 쓰고 공개 사본을 만들지 않는다.
  add column images_public boolean not null default false,
  -- 작성자(초대 수신자) — 공개하지 않는다. 검토·연락용.
  add column author_name text,
  add column author_phone text,
  -- 미성년 게시 — 법정대리인 동의가 있어야 하고, 운영자가 그 동의를 확인해야 승인할 수 있다.
  add column is_minor boolean not null default false,
  add column guardian_name text,
  add column guardian_phone text,
  add column guardian_verified_at timestamptz,
  add column guardian_verified_by text,
  add column invitation_id uuid,
  -- 검토 이력 스탬프 — 각 전환의 "언제·왜"를 행 자체에 남긴다(activity_log와 별개로 화면에서 바로 읽는다).
  add column submitted_at timestamptz,
  add column review_started_at timestamptz,
  add column revision_requested_at timestamptz,
  add column revision_note text,
  add column rejected_at timestamptz,
  add column reject_reason text,
  add column masking_confirmed_at timestamptz,
  add column masking_confirmed_by text,
  add column published_at timestamptz,
  add column retracted_at timestamptz,
  add column retract_reason text,
  add column retracted_by text;

-- 기존 행 호환: 운영자가 작성자 동의를 확인하고 등록한 본이라(00009 review 동의 기록 동반)
-- 이미지 공개·마스킹 확인은 승인 시각에 이뤄진 것으로 간주한다 — 오늘 공개 중인 집합을 그대로 유지한다.
update public.reviews set images_public = true;
update public.reviews
   set published_at = coalesce(approved_at, created_at),
       masking_confirmed_at = coalesce(approved_at, created_at),
       masking_confirmed_by = 'migration:00025'
 where status = 'published';

alter table public.reviews drop constraint reviews_status_check;
alter table public.reviews add constraint reviews_status_check
  check (status in (
    'draft', 'submitted', 'in_review', 'revision_requested',
    'rejected', 'approved', 'published', 'retracted'
  ));

-- 게시는 공개용 최소 본 확인 없이 성립하지 않는다. 철회·반려는 시각 없이 성립하지 않는다.
alter table public.reviews
  add constraint reviews_published_needs_masking
    check (status <> 'published' or masking_confirmed_at is not null),
  add constraint reviews_retracted_needs_stamp
    check (status <> 'retracted' or retracted_at is not null),
  add constraint reviews_rejected_needs_reason
    check (status <> 'rejected' or (rejected_at is not null and reject_reason is not null));

/* ---------- ③ review_invitations — 작성 초대(링크) ---------- */
--
-- intake_forms(00018)와 같은 규약: 원문 토큰은 링크에만 있고 DB에는 HMAC 해시만 남는다.
-- 열리는 조건은 status='sent'이고 기한 전뿐이다. 닫힘·만료·제출·없는 토큰은 같은 안내로 수렴한다.
-- review_id가 있으면 "수정 요청" 재발급이다 — 작성 화면이 기존 본을 채워 주고, 제출은 그 행을 갱신한다.

create table public.review_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_id uuid,
  student_name text not null,             -- 대상 학생 이름(작성 화면의 관계 확인 문장에 쓴다)
  author_role text not null check (author_role in ('student', 'parent')),
  author_name text not null,
  author_phone text not null,
  token_hash text not null unique,        -- HMAC-SHA256(AUTH_SECRET, 원문) — 원문은 저장하지 않는다
  status text not null default 'sent'
    check (status in ('sent', 'submitted', 'closed', 'expired')),
  review_id uuid,                         -- 수정 요청 재발급이면 원 후기
  sent_at timestamptz not null default now(),
  expires_at timestamptz,                 -- null = 기한 없음
  submitted_at timestamptz,
  closed_at timestamptz,
  close_reason text,
  created_by text,                        -- 발급 운영자 이메일
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete set null (student_id),
  foreign key (tenant_id, review_id)
    references public.reviews (tenant_id, id) on delete set null (review_id),
  constraint review_invitations_submitted_needs_stamp
    check (status <> 'submitted' or submitted_at is not null),
  constraint review_invitations_closed_needs_stamp
    check (status <> 'closed' or closed_at is not null)
);

alter table public.reviews
  add constraint reviews_invitation_fk
    foreign key (tenant_id, invitation_id)
    references public.review_invitations (tenant_id, id) on delete set null (invitation_id);

create index idx_review_invitations_open
  on public.review_invitations (tenant_id, status)
  where status = 'sent';
create index idx_review_invitations_student
  on public.review_invitations (tenant_id, student_id);
create index idx_review_invitations_review
  on public.review_invitations (tenant_id, review_id);

alter table public.review_invitations enable row level security;
create policy tenant_isolation on public.review_invitations
  for all to authenticated
  using (tenant_id = public.jwt_tenant_id())
  with check (tenant_id = public.jwt_tenant_id());

/* ---------- ④ 1호 테넌트 푸터 고지 — 통신판매업 신고번호 ---------- */
-- site_info는 저장 시 전 키를 통째로 쓰므로 null이 기본값을 덮는다. 값이 비어 있을 때만 채운다.
update public.site_settings
   set value = value || jsonb_build_object('commerceNo', '제2026-수원영통-1043호')
 where tenant_id = '00000000-0000-0000-0000-000000000001'
   and key = 'site_info'
   and coalesce(value ->> 'commerceNo', '') = '';
