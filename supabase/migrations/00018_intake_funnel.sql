-- 00018: M2 유입 퍼널 — 신청폼(시범·정규)·시범 회차·시범 결과 이력·정규 등록·계약·대기 자리 제안
--
-- 근거: docs/flow-canon/01_atlas_01_intake.md
--         T-01(시범 신청폼 발송·제출) · T-02(시범 일정·결제·확정) · T-03(변경·취소·노쇼)
--         · T-04(시범 진행·결과) · R-01(정규 신청폼) · R-02(관계 확인) · R-03(계약 동의)
--         · R-04(활성화 준비 — 네 조건) · R-05(등록 활성화) · R-06(활성화 전 포기·만료)
--         · O-04(모집 정원·접수 상태 운영) · C-05(상담 결과) · C-06(대기명단)
--       docs/flow-canon/03_scenarios_133.md 검수 5~15 · 61~63
--
-- 현행 갭(01_atlas_01): 시범 회차·정규 등록·계약·대기 자리 엔티티가 아예 없고(T-01·T-02·R-01·
-- R-03·C-06 "❌ 없음"), 등록은 상담→학생 원클릭 전환(convertToStudent)·학생 폼의 status 직접
-- 지정만으로 즉시 active가 된다(R-04·R-05 "⚠️ 충돌"). 이 마이그레이션은 그 빈자리를 스키마로
-- 채우고, 정본이 "게이트"라 부르는 것을 DB CHECK + 원자적 RPC로 못박는다.
--
-- 설계 원칙:
--  · 활성 하나(검수 6·7·61): "동시에 활성화되는 다음 단계는 하나"·"한 자리 한 사람"은 코드
--    규율이 아니라 부분 유니크 인덱스로 강제한다(00013 admin_accounts_one_active_per_tenant ·
--    00017 portal_access_links_one_active_per_relation과 같은 계열). 새 폼·새 제안을 만들려면
--    이전 것을 먼저 닫아야 INSERT가 통과한다.
--  · 반쪽 확정 금지(검수 12·15): 게이트가 다 서지 않은 확정 상태는 CHECK가 거부하고, 상태
--    전환 자체는 조건을 UPDATE의 WHERE에 넣은 단일 문장 RPC로만 한다 — 계수→갱신 두 문장
--    사이에 조건이 뒤집히는 창(TOCTOU)을 없앤다(00015 close_homework_assignment와 같은 계열).
--  · 덮어쓰지 않는다(T-04): 시범 결과는 append-only 이력이다. 결과가 바뀌면 이전 행을 고치는
--    대신 새 결정 행을 쌓는다 — UPDATE·DELETE는 트리거가 거부한다(00015 제출물과 같은 계열).
--  · 무료 시범도 결제 게이트를 "통과 처리"하지 않는다(T-02 예외): payment_confirmed는 켜되
--    is_paid=false가 "결제 불필요"라는 근거로 남아, 나중에 왜 통과했는지 대조할 수 있다.
--
-- 기존과의 관계(회귀 금지):
--  · students.status는 그대로 둔다 — 기존 관리자 화면 전부가 이 컬럼을 읽는다. 등록의 정본은
--    enrollments이고 students.status는 기존 화면 호환 미러다(activate_enrollment가 함께 갱신).
--  · consultations.status(new|contacted|trial|registered|hold)도 그대로 둔다. 폼 발급·시범 확정·
--    등록 활성 이벤트에 맞춘 갱신은 앱 레이어 몫이며, 이 파일은 값 집합을 바꾸지 않는다.
--  · E-05 재등록(app/admin/(protected)/students/actions.ts reEnrollStudent)은 이번 범위에서
--    고치지 않는다. 다만 이 시점부터 "등록"의 정본 엔티티는 enrollments다 — 재등록은 종료된
--    등록을 되살리는 것이 아니라 새 enrollments 행을 만드는 흐름으로 가야 한다(검수 48).
--    그 전환은 별도 작업이고, 여기서는 사실만 기록해 둔다.

/* ---------- ⓪ consultations 복합 FK 키 ----------
   신규 4종(intake_forms·trial_sessions·enrollments·waitlist_offers)이 상담을 테넌트와 함께
   참조한다. 단일 컬럼 FK는 타 테넌트 상담 UUID 연결을 막지 못한다 — 00001 복합 FK 관례대로
   부모에 unique(tenant_id, id)를 먼저 세운다(00014 payments·00015 ai_reports와 같은 보강). */
alter table public.consultations
  add constraint consultations_tenant_id_id_key unique (tenant_id, id);

/* ---------- ① intake_forms — 신청폼 발급·제출 (T-01 · R-01 · 검수 5·6·7) ----------
   상담 결과가 정해지면 그 결과에 맞는 신청폼 하나를 발급한다. 링크는 원문 토큰을 발송하고
   DB에는 HMAC 해시만 둔다(00017 portal_access_links와 같은 규약 — DB가 유출돼도 링크를
   역산할 수 없다). 공개 폼이지만 조회·제출은 앱이 service client로 수행한다.

   status: sent(발급·발송) → submitted(제출 — payload에 제출 내용 스냅샷)
           / closed(운영자가 닫음 — 결과 변경·상담 종결·재발급) / expired(기한 경과).
   payload: 제출 내용 스냅샷. 제출 시각의 답변을 그대로 보존한다(이후 학생·등록 행이 바뀌어도
   "무엇을 보고 승인했는지"가 남아야 한다 — R-01 운영자 검토의 근거).

   검수 7("새 다음 단계 폼을 발급하면 이전 폼은 닫힌다")은 아래 부분 유니크가 강제한다:
   같은 상담·같은 종류로 살아 있는(sent) 폼은 하나뿐이라, 이전 폼을 closed로 돌리지 않으면
   새 폼 INSERT 자체가 실패한다. 검수 6("동시 활성 하나")의 종류 간 배타(시범 vs 정규)는
   상담 결과 전환 코드가 두 종류를 함께 닫는 방식으로 지킨다 — 종류가 다른 두 활성 폼을
   DB가 원천 차단하면 "시범 결과=정규 제안"(검수 11)의 정상 전환까지 막힌다. */

create table public.intake_forms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  consultation_id uuid not null,
  kind text not null check (kind in ('trial', 'regular')),
  token_hash text not null unique,  -- HMAC-SHA256(AUTH_SECRET, 원문 토큰) — 원문은 저장하지 않는다
  status text not null default 'sent'
    check (status in ('sent', 'submitted', 'closed', 'expired')),
  payload jsonb,                    -- null = 미제출. 제출 시 답변 스냅샷
  sent_at timestamptz not null default now(),
  submitted_at timestamptz,
  closed_at timestamptz,
  close_reason text,                -- 결과 변경 · 상담 종결 · 재발급 · 신청자 철회
  expires_at timestamptz,           -- null = 기한 없음. 경과분의 expired 전환은 앱·크론 몫
  created_at timestamptz not null default now(),
  unique (tenant_id, id), -- 자식 복합 FK용(trial_sessions.form_id · enrollments.form_id)
  -- 제출은 시각과 내용이 함께 있어야 한다 — "제출됐다는데 내용이 없다"는 검토 불가 상태다.
  constraint intake_forms_submitted_needs_payload
    check (status <> 'submitted' or (submitted_at is not null and payload is not null)),
  -- 닫힌 폼은 언제 닫혔는지가 남아야 한다(C-05 "기존 링크를 먼저 닫고 새 결과를 생성").
  constraint intake_forms_closed_needs_time
    check (status <> 'closed' or closed_at is not null),
  foreign key (tenant_id, consultation_id)
    references public.consultations (tenant_id, id) on delete cascade
);

-- 검수 7의 DB 강제선: 같은 상담·같은 종류로 살아 있는 폼은 하나.
create unique index intake_forms_one_active_per_kind
  on public.intake_forms (consultation_id, kind)
  where status = 'sent';

-- 상담 상세: 이 상담의 폼 이력(발급 순)
create index idx_intake_forms_consultation
  on public.intake_forms (tenant_id, consultation_id, sent_at desc);

-- 기한 경과 폼 스윕 경로(expired 전환 대상)
create index idx_intake_forms_expiring
  on public.intake_forms (tenant_id, expires_at)
  where status = 'sent';

/* ---------- ② trial_sessions — 시범 회차 (T-02 · T-03 · 검수 8·9·10) ----------
   정본 T-02의 결과물은 "확정 시범 회차 1개"이고, 확정 조건은 일정 합의와 결제 확인 둘이다.
   그 둘을 상태에 녹이지 않고 별도 플래그로 둔다 — "일정만 합의(결제 대기)"와 "결제만 확인
   (일정 확정 대기)"이 서로 다른 대기 상태이고 각각 다른 운영 업무로 이어지기 때문이다.

   status: proposed(제안 — 폼 제출·승인 직후) → scheduled(확정) → done / noshow / canceled.
   · scheduled 전환은 두 플래그가 모두 켜져야 한다(아래 CHECK) — 검수 8 "시범 폼 제출만으로
     일정이 확정되지 않는다", 검수 9 "유료 시범은 결제와 일정이 모두 확인돼야 확정된다".
   · 무료 시범(is_paid=false)은 payment_confirmed를 true로 두되 is_paid가 false로 남아
     "결제 단계를 통과 처리한 것이 아니라 결제가 불필요했다"는 근거가 보존된다(T-02 예외).
   · noshow는 자동 판정하지 않는다(검수 10 — 10·20·30분 연락 후 운영자 확정). DB는 값만
     제공하고 판정 절차는 앱·운영 흐름이 가진다. */

create table public.trial_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  consultation_id uuid not null,
  form_id uuid,                     -- 이 회차의 근거가 된 시범 신청폼(폼 없이 만든 회차도 허용)
  scheduled_at timestamptz,         -- 합의된 일시. null = 아직 일정 없음
  is_paid boolean not null default false,   -- 유료 시범 여부(결제 필요 여부의 근거)
  payment_id uuid,                  -- 유료 시범의 청구·수납 행(00014 payments)
  schedule_confirmed boolean not null default false,
  payment_confirmed boolean not null default false, -- 무료 시범은 "결제 불필요"로 true
  status text not null default 'proposed'
    check (status in ('proposed', 'scheduled', 'done', 'noshow', 'canceled')),
  attended_at timestamptz,
  canceled_reason text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id), -- trial_results 복합 FK용
  -- 일정 확정에는 실제 일시가 있어야 한다 — 일시 없는 "확정"은 안내할 수 없는 확정이다.
  constraint trial_sessions_schedule_needs_time
    check (not schedule_confirmed or scheduled_at is not null),
  -- 확정(scheduled)은 두 게이트가 모두 선 뒤에만(검수 8·9). 어느 한쪽만이면 proposed에 머문다.
  constraint trial_sessions_scheduled_needs_gates
    check (status <> 'scheduled' or (schedule_confirmed and payment_confirmed)),
  -- 유료 시범의 "결제 확인"은 결제 행이 근거다 — 근거 없는 확인은 대사 불가(검수 9·37 계열).
  -- 무료 시범(is_paid=false)은 이 조건에 걸리지 않는다(결제 불필요 통과).
  constraint trial_sessions_paid_confirm_needs_payment
    check (not (is_paid and payment_confirmed) or payment_id is not null),
  foreign key (tenant_id, consultation_id)
    references public.consultations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, form_id)
    references public.intake_forms (tenant_id, id) on delete set null (form_id),
  foreign key (tenant_id, payment_id)
    references public.payments (tenant_id, id) on delete set null (payment_id)
);

-- 상담 상세·오늘 업무: 이 상담의 시범 회차(재시범이면 여러 건 — T-04 분기)
create index idx_trial_sessions_consultation
  on public.trial_sessions (tenant_id, consultation_id, created_at desc);

-- 확정 대기 목록(결제 또는 일정 미완) — 정본 T-02의 두 대기 상태가 곧 운영 업무다
create index idx_trial_sessions_pending
  on public.trial_sessions (tenant_id, status, scheduled_at)
  where status in ('proposed', 'scheduled');

/* ---------- ③ trial_results — 시범 결과 이력 (T-04 · append-only) ----------
   정본 T-04 예외: "결과가 바뀌면 이전 결과를 덮어쓰지 않고 새 결정으로 연결한다".
   그래서 결과는 회차의 컬럼이 아니라 별도 이력 테이블이다 — 최신 결정은 decided_at이 가장
   늦은 행이고, 이전 결정은 그대로 남아 "왜 정규 제안이 재시범으로 바뀌었는지"가 대조된다.

   result: regular_offer(정규 제안) / retrial(재시범) / followup(추가 확인·후속 상담)
           / declined(신청자 거절) / none(미진행). 정본 T-04의 다섯 분기 그대로다.
   검수 11("시범 결과가 정규 제안일 때만 그 결과에 연결된 정규 폼이 열린다")의 판정 근거가
   이 표의 최신 행이다 — 폼 발급 코드가 최신 결과를 읽어 게이트한다.

   자동 판정 금지(T-04 예외): decided_by는 사람이다. 이 표에 행을 쓰는 자동 경로를 만들지 않는다. */

create table public.trial_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  trial_session_id uuid not null,
  result text not null
    check (result in ('regular_offer', 'retrial', 'followup', 'declined', 'none')),
  note text,
  decided_by text,                  -- 운영자 이메일(admin_accounts.email 규약 — 다형 참조라 FK 없음)
  decided_at timestamptz not null default now(),
  foreign key (tenant_id, trial_session_id)
    references public.trial_sessions (tenant_id, id) on delete cascade
);

-- 최신 결정 조회 경로 — 이 인덱스의 첫 행이 곧 현재 결과다
create index idx_trial_results_session
  on public.trial_results (tenant_id, trial_session_id, decided_at desc);

/* 결과 이력 append-only 트리거(T-04):
   · UPDATE — 전면 거부. 오타 정정조차 새 행이다(정정도 하나의 결정이라는 것이 정본의 입장).
   · DELETE — 직접 삭제 거부. 단 부모 회차가 이미 사라진 CASCADE 경로(상담·테넌트 삭제)는
     부모 부재 확인으로 통과시킨다(00015 homework_submission_immutable과 같은 판정).
   트리거는 service_role(BYPASSRLS)에도 적용된다 — RLS가 아닌 무결성 규칙이기 때문. */
create or replace function public.trial_result_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    -- 부모 회차가 남아 있는데 결과만 지우려는 것 = 직접 삭제 → 거부.
    -- 부모가 안 보이면 CASCADE 삭제 진행 중(상담·테넌트 삭제) → 통과.
    if exists (
      select 1 from public.trial_sessions
       where tenant_id = old.tenant_id and id = old.trial_session_id
    ) then
      raise exception '[intake] 시범 결과는 삭제할 수 없습니다 — 결과 변경은 새 결정 행으로 (T-04)';
    end if;
    return old;
  end if;
  raise exception '[intake] 시범 결과는 수정할 수 없습니다 — 결과가 바뀌면 덮어쓰지 않고 새 결정 행을 추가하세요 (T-04)';
end $$;

create trigger trg_trial_results_append_only
  before update or delete on public.trial_results
  for each row execute function public.trial_result_append_only();

/* ---------- ④ enrollments — 정규 등록 (R-04 · R-05 · 검수 12~15) ----------
   등록의 정본 엔티티. 지금까지 "등록"은 students.status='active' 한 글자였고 그래서
   계약·결제·일정 확인 없이 즉시 활성이 됐다(R-04 "⚠️ 충돌"). 등록을 별도 행으로 세워
   네 게이트를 데이터로 들고 있게 한다.

   네 게이트(R-04 "상태 수렴"):
     relation_ok  — 학생·보호자·계약자·납부자 관계 확인 완료(R-02. 미성년자에게 필요한
                    성인 관계가 없으면 계약 단계 자체가 막힌다 — R-01 예외)
     contract_ok  — 계약 수락(⑤ contracts.agreed_at이 근거. 신청폼 동의는 계약 수락이
                    아니다 — R-03 예외)
     payment_ok   — 결제 확인(결과 불명확이면 대사 전까지 false — R-04 예외)
     schedule_ok  — 첫 수업 일정 확정
   정본 R-04가 세는 네 조건은 계약·결제·일정·정원이다. 정원 확보는 등록 한 건의 속성이
   아니라 그 시점 모집 상태의 판정이라(O-04 · recruit_status · ⑥ waitlist_offers) 이 표에
   플래그로 두지 않고, 대신 등록 자체의 전제인 관계 확인(R-02)을 네 번째 게이트로 든다.
   자리 확보는 활성화를 시도하기 전에 자리 제안(⑥)이 accepted인지로 판정한다.

   검수 13·14("결제됐지만 일정이 없으면 등록 준비 중", "일정이 있지만 결제가 불명확하면
   확정 수업으로 안내하지 않는다")의 "등록 준비 중" 표시는 status='pending' + 게이트 플래그
   조합 그대로다 — 별도 상태값을 만들지 않는다.

   status: pending(준비 중) → active(활성) → ended(종료) / canceled(활성화 전 포기 — R-06).
   활성 전환은 아래 activate_enrollment RPC만 한다(검수 12·15). */

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_id uuid not null,
  consultation_id uuid,             -- 유입 경로(상담). 직접 등록이면 null
  form_id uuid,                     -- 근거가 된 정규 신청폼(R-01)
  status text not null default 'pending'
    check (status in ('pending', 'active', 'ended', 'canceled')),
  relation_ok boolean not null default false,
  contract_ok boolean not null default false,
  payment_ok boolean not null default false,
  schedule_ok boolean not null default false,
  activated_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id), -- contracts 복합 FK용
  -- 반쪽 활성 금지의 DB측 바닥(검수 12·15): 네 게이트와 활성 시각이 없는 active는 존재할 수
  -- 없다. RPC를 우회한 수동 UPDATE·버그도 여기서 걸린다.
  constraint enrollments_active_needs_gates
    check (status <> 'active'
           or (relation_ok and contract_ok and payment_ok and schedule_ok
               and activated_at is not null)),
  -- 종료도 언제 끝났는지가 남아야 한다(E 계열 정산·보존 흐름의 기산점).
  constraint enrollments_ended_needs_time
    check (status <> 'ended' or ended_at is not null),
  foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade,
  foreign key (tenant_id, consultation_id)
    references public.consultations (tenant_id, id) on delete set null (consultation_id),
  foreign key (tenant_id, form_id)
    references public.intake_forms (tenant_id, id) on delete set null (form_id)
);

-- R-05 "활성 등록 1건": 한 학생에게 동시에 두 개의 활성 등록을 남기지 않는다. 종료 후
-- 재등록은 새 행이다(검수 48). students.status가 단일 값인 이상 미러도 이 제약을 전제한다.
create unique index enrollments_one_active_per_student
  on public.enrollments (tenant_id, student_id)
  where status = 'active';

-- 등록 준비 중 목록(검수 13·14) — 미완 게이트가 곧 오늘 업무다
create index idx_enrollments_pending
  on public.enrollments (tenant_id, created_at desc)
  where status = 'pending';

create index idx_enrollments_consultation
  on public.enrollments (tenant_id, consultation_id);

/* ---------- ⑤ contracts — 계약 (R-03 · 검수 12) ----------
   정본 R-03 예외: "신청폼 동의만으로 계약 수락 처리하지 않는다". 그래서 계약은 폼과 별개
   행이고, 동의(agreed_at)가 곧 enrollments.contract_ok의 근거다.
   조건이 바뀌면 기존 계약본을 고치지 않고 새 계약본을 만들어 다시 동의받는다(R-03 예외) —
   그래서 한 등록에 계약 행이 여럿일 수 있고, 그중 동의된 것은 하나뿐이다(아래 부분 유니크).

   terms: 동의 시점의 수업 조건 스냅샷(요일·시간·수업료·정책 버전 등). 이후 조건이 바뀌어도
   "무엇에 동의했는가"는 이 jsonb가 보존한다 — 분쟁 시 대조 대상.
   agreed_by_phone: 숫자만(00017 portal_contacts.phone과 같은 정규화 규약 — 앱이
   replace(/\D/g, "")로 넣는다). 표기 차이가 같은 사람을 둘로 가르지 않게 DB가 강제한다. */

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  enrollment_id uuid not null,
  terms jsonb not null,             -- 동의 시점 수업 조건 스냅샷
  agreed_at timestamptz,            -- null = 제안됨(미동의)
  agreed_by_name text,
  agreed_by_phone text check (agreed_by_phone ~ '^[0-9]{9,12}$'),
  created_at timestamptz not null default now(),
  -- 누가 동의했는지 없는 동의는 계약 수락의 근거가 되지 못한다(R-03 "성인 계약자 확인").
  constraint contracts_agreed_needs_identity
    check (agreed_at is null
           or (agreed_by_name is not null and agreed_by_phone is not null)),
  foreign key (tenant_id, enrollment_id)
    references public.enrollments (tenant_id, id) on delete cascade
);

-- R-05 "유효 계약 1건": 한 등록에 동의된 계약본은 하나. 조건 변경 시 이전 계약본의 동의를
-- 거두지 않고 새 계약본에 동의를 받으면 어느 것이 유효한지 알 수 없다.
create unique index contracts_one_agreed_per_enrollment
  on public.contracts (enrollment_id)
  where agreed_at is not null;

create index idx_contracts_enrollment
  on public.contracts (tenant_id, enrollment_id, created_at desc);

/* ---------- ⑥ waitlist_offers — 대기 자리 제안 (C-06 · O-04 · 검수 61·62·63) ----------
   정본 C-06 예외: "같은 자리를 여러 사람에게 동시에 제안하거나 확정하지 않는다".
   그 불변식을 부분 유니크로 못박는다 — 한 테넌트의 한 자리에 offered 상태 행은 하나뿐이다.

   status: offered(제안 중) → accepted(수락 — 자리 예약) / declined(거절) / expired(기한 경과).
   거절·만료는 자리를 반환한다(검수 62) — 같은 seat_no로 다음 사람에게 다시 제안할 수 있게
   되는 것이 곧 반환이다. "다음 대기자 검토"는 자동이 아니라 운영자 판단이다(C-06 예외
   "대기순서만으로 자동 확정하지 않는다") — 그래서 자동 재제안 트리거를 두지 않는다.

   seat_no: 자리 번호. null이면 번호 없는 제안(정원 산정 밖의 개별 협의)이라 자리 경합
   대상이 아니다 — 부분 유니크는 null을 서로 다른 값으로 취급하므로 자연스럽게 비적용된다.
   검수 63("정원이 줄어도 유효한 자리 제안을 자동 취소하지 않는다"): 정원 축소가 이 표를
   건드리지 않는다는 뜻이므로, 정원 변경 경로에서 이 표를 갱신하는 코드를 만들지 않는다. */

create table public.waitlist_offers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  consultation_id uuid not null,
  seat_no int check (seat_no >= 1),  -- null = 번호 없는 개별 제안(자리 경합 대상 아님)
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,   -- "승인된 기간의 자리 제안"(C-06) — 기한 없는 예약은 없다
  status text not null default 'offered'
    check (status in ('offered', 'accepted', 'declined', 'expired')),
  responded_at timestamptz,
  -- 기간부 제안 — 만들자마자 만료된 제안은 자리를 묶어두기만 한다.
  constraint waitlist_offers_expires_after_offer
    check (expires_at > offered_at),
  -- 사람의 응답(수락·거절)에는 응답 시각이 있어야 한다. 만료는 응답이 아니므로 제외한다.
  constraint waitlist_offers_response_needs_time
    check (status not in ('accepted', 'declined') or responded_at is not null),
  foreign key (tenant_id, consultation_id)
    references public.consultations (tenant_id, id) on delete cascade
);

-- 검수 61의 DB 강제선: 한 자리에 동시에 한 사람만.
-- offered뿐 아니라 accepted도 자리를 묶는다 — 수락은 "그 자리를 이 사람이 가져갔다"는 뜻이고,
-- 자리가 대기열로 돌아오는 것은 거절(declined)·만료(expired)뿐이다(검수 62).
-- offered만 걸면 수락된 자리를 다른 사람에게 다시 제안할 수 있어 강제선이 뚫린다.
create unique index waitlist_offers_one_per_seat
  on public.waitlist_offers (tenant_id, seat_no)
  where status in ('offered', 'accepted');

-- 기한 경과 제안 스윕 경로(expired 전환 → 자리 반환 — 검수 62)
create index idx_waitlist_offers_expiring
  on public.waitlist_offers (tenant_id, expires_at)
  where status = 'offered';

create index idx_waitlist_offers_consultation
  on public.waitlist_offers (tenant_id, consultation_id, offered_at desc);

/* ---------- ⑦ RLS ----------
   intake_forms만 "정책 없는 RLS"(00010·00013·00017 패턴)다: 공개 폼 방문자는 Supabase
   authenticated 주체가 아니라 토큰 링크를 든 손님이고, 조회·제출·관리자 발급이 전부
   service client 경유이므로 jwt_tenant_id() 정책이 평가될 컨텍스트 자체가 없다. 정책을 달아도
   장식이 되므로 달지 않는다 — 정책 없는 RLS는 anon·authenticated를 전면 거부하고
   service_role(BYPASSRLS)만 통과시킨다. 테넌트 스코프는 앱 레이어가 강제한다.

   나머지 5종은 관리자 화면의 데이터라 activity_log 계열과 같은 테넌트 정책을 단다. */

alter table public.intake_forms enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'trial_sessions', 'trial_results', 'enrollments', 'contracts', 'waitlist_offers'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy tenant_isolation on public.%I
         for all to authenticated
         using (tenant_id = public.jwt_tenant_id())
         with check (tenant_id = public.jwt_tenant_id())', t);
  end loop;
end $$;

/* ---------- ⑧ activate_enrollment — 원자적 등록 활성화 (검수 12·15 · R-05) ----------
   정본 R-05: "네 조건 재확인 → 묶음 연결 → 전체 성공 확인 → 등록 활성", 예외: "일부 연결
   실패 → 활성화 전체 취소". 검수 15: "활성화 연결 중 하나가 실패하면 반쪽 등록이 남지 않는다".

   그래서 게이트 검사와 상태 전환을 두 문장으로 나누지 않는다. 네 조건을 UPDATE의 WHERE에
   넣어 단일 문장으로 판정·전환한다 — 계수와 갱신 사이에 결제가 취소되거나 계약이 철회되는
   창(TOCTOU)이 아예 없다. 조건이 하나라도 어긋나면 0행이 갱신되고 false가 돌아간다.

   students.status 미러: 등록의 정본은 enrollments다. students.status는 기존 관리자 화면
   전부(목록·상세·필터)가 읽는 호환 미러이므로 같은 트랜잭션에서 함께 갱신한다 — 등록은
   활성인데 학생은 trial로 남는 불일치를 만들지 않는다. 반대 방향(students.status 직접 변경)은
   미러를 정본으로 되돌리지 않는다.

   M1 연결(R-06 포털 초대): 활성화 직후의 역할별 포털 초대는 이 함수가 하지 않는다.
   초대 발급은 관계·연락처·토큰 발송이 얽힌 앱 흐름이고(00017 portal_relations·
   portal_access_links), 그 코드는 학생 상세 화면이 소유한다. 활성 화면은 "포털 초대 보내기"
   링크로 학생 상세로 보내는 최소 연결만 한다 — 초대 실패가 등록 활성을 되돌리게 하지
   않기 위해서이기도 하다(R-05 예외 "완료 안내 실패가 등록을 취소하지 않는다"). */

create or replace function public.activate_enrollment(p_tenant_id uuid, p_id uuid)
returns boolean
language plpgsql
as $$
declare
  v_count int;
  v_student uuid;
begin
  update public.enrollments e
     set status = 'active', activated_at = now()
   where e.tenant_id = p_tenant_id
     and e.id = p_id
     and e.status = 'pending'
     and e.relation_ok
     and e.contract_ok
     and e.payment_ok
     and e.schedule_ok
     -- 정원 — 정본 R-04·검수 12가 세는 네 조건은 "계약·결제·일정·정원"이다.
     -- 앱 층 경고만 두면 무시하고 활성화할 수 있으므로 여기(UPDATE의 WHERE)에서 강제한다.
     and (
       -- 정원 미설정 = 무제한
       not exists (
         select 1 from public.recruit_status rs
          where rs.tenant_id = p_tenant_id and rs.seat_count is not null)
       -- 이 상담이 자리를 배정받아 두었으면(수락된 제안) 그 자리로 들어간다
       or exists (
         select 1 from public.waitlist_offers w
          where w.tenant_id = p_tenant_id
            and w.consultation_id = e.consultation_id
            and w.status = 'accepted')
       -- 그 외에는 활성 등록이 정원 미만일 때만
       or (
         select count(*) from public.enrollments e2
          where e2.tenant_id = p_tenant_id and e2.status = 'active')
          < (select rs.seat_count from public.recruit_status rs where rs.tenant_id = p_tenant_id)
     )
  returning e.student_id into v_student;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    return false; -- 준비 중이 아니거나 게이트 미완(정원 포함) — 반쪽 활성은 남지 않는다
  end if;

  -- 기존 화면 호환 미러(정본은 enrollments). 같은 트랜잭션이라 함께 성공하거나 함께 없다.
  update public.students s
     set status = 'active', updated_at = now()
   where s.tenant_id = p_tenant_id
     and s.id = v_student
     and s.status <> 'active';

  return true;
exception
  when unique_violation then
    -- 이 학생에게 이미 활성 등록이 있다(enrollments_one_active_per_student · R-05 "활성 등록 1건").
    -- 호출부가 500을 받는 대신 게이트 미완과 같은 판정으로 수렴한다 — 활성화되지 않았다는 사실은
    -- 같고, 무엇이 막았는지는 화면이 등록 목록을 다시 읽어 보여준다. 예외 블록이라 이 함수가
    -- 만든 변경(등록 상태·학생 미러)은 전부 롤백된다 — 반쪽 활성은 여기서도 남지 않는다.
    return false;
end $$;

/* ---------- ⑨ offer_waitlist_seat — 자리 제안 (검수 61·62) ----------
   "한 자리 한 사람"의 최종 방어선은 부분 유니크(waitlist_offers_one_per_seat)다. 이 함수는
   그 위에 친절한 판정을 얹는다 — 이미 제안 중인 자리면 예외 대신 false를 돌려주어 호출부가
   "이미 다른 대기자에게 제안된 자리입니다"로 안내할 수 있게 한다.

   경합(두 요청이 같은 자리를 동시에 집는 경우)은 not exists 검사를 통과해도 유니크 인덱스가
   한쪽을 떨어뜨린다. 그 예외를 여기서 잡아 같은 false로 수렴시킨다 — 판정 경로가 하나다.

   자리 반환(검수 62)은 별도 함수가 아니다: 기존 제안을 declined·expired로 돌리면 부분
   유니크의 대상에서 빠지므로 같은 seat_no로 이 함수를 다시 부를 수 있게 된다. 다음 대기자
   선정은 운영자 판단이므로(C-06 "대기순서만으로 자동 확정하지 않는다") 자동 재제안은 없다. */

create or replace function public.offer_waitlist_seat(
  p_tenant_id uuid,
  p_consultation_id uuid,
  p_seat_no int,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
as $$
declare v_count int;
begin
  if p_expires_at is null or p_expires_at <= now() then
    return false; -- 기간부 제안 — 이미 지난 기한으로는 자리를 묶지 않는다
  end if;

  -- 기한이 지난 제안은 사람이 확정하기 전에도 자리를 묶지 않는다(검수 62 — 만료는 시간이 정한다).
  -- 새 제안을 넣기 전에 이 테넌트의 지난 제안을 expired로 정리한다(lazy 스윕).
  update public.waitlist_offers w
     set status = 'expired', responded_at = now()
   where w.tenant_id = p_tenant_id
     and w.status = 'offered'
     and w.expires_at <= now();

  insert into public.waitlist_offers (tenant_id, consultation_id, seat_no, expires_at)
  select p_tenant_id, p_consultation_id, p_seat_no, p_expires_at
   where p_seat_no is null
      or not exists (
        select 1 from public.waitlist_offers w
         where w.tenant_id = p_tenant_id
           and w.seat_no = p_seat_no
           and w.status in ('offered', 'accepted'));

  get diagnostics v_count = row_count;
  return v_count > 0;
exception
  when unique_violation then
    return false; -- 동시 제안 경합 — 부분 유니크가 떨어뜨린 쪽도 같은 판정으로 수렴
end $$;

/* ---------- ⑩ EXECUTE 권한: anon·authenticated 회수 + service_role 명시 부여 ----------
   PostgREST는 public 스키마 함수를 RPC로 노출하고, create 시 PUBLIC 의사롤 EXECUTE가 붙는다.
   두 함수 모두 상태를 바꾸는 경로이므로(등록 활성화·자리 점유) 공개 키로 호출될 자리를 없앤다.

   ⚠️ PUBLIC 회수는 service_role의 EXECUTE까지 함께 없앤다(PUBLIC을 통해서만 받고 있었다면).
   앱은 SUPABASE_SERVICE_ROLE_KEY로 붙어 service_role 역할로 호출하므로(lib/supabase/server.ts
   createServiceClient), 회수 뒤 명시 부여를 하지 않으면 활성화·제안 경로 전체가 42501로 죽는다.
   회수와 부여를 한 쌍으로 둔다 — 어느 환경의 기본 권한에도 의존하지 않는다(00017 수칙). */

revoke execute on function public.activate_enrollment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.activate_enrollment(uuid, uuid) to service_role;

revoke execute on function public.offer_waitlist_seat(uuid, uuid, int, timestamptz) from public, anon, authenticated;
grant execute on function public.offer_waitlist_seat(uuid, uuid, int, timestamptz) to service_role;

-- 트리거 함수는 직접 호출이 불가능하지만(returns trigger) 같은 수칙으로 회수해 둔다(00015 계열).
revoke execute on function public.trial_result_append_only() from public, anon, authenticated;
