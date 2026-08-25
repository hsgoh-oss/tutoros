-- 00020: M3 수업 묶음·회차 원장·출결·보강·정정 — L 도메인
--
-- 근거: docs/flow-canon/01_atlas_02_portal_lessons.md
--         L-01(수업 묶음과 반복 일정) · L-03(정상 수업 한 회차) · L-04(출결·노쇼)
--         · L-05(일정 변경·취소·보강) · L-06(출결·수업기록 정정) · L-08(반복 노쇼·예약 위험)
--         · L-10(회차·계약 귀속 확인)
--       docs/flow-canon/02_invariants.md · 03_scenarios_133.md
--
-- 현행 갭(01_atlas_02 판정 2026-08-25): 일정은 단건 등록뿐이고 수업 묶음·반복 회차·충돌 확인이
-- 없다(L-01 🔶). 출결은 lessons.absent 불리언 하나라 지각·조퇴·사유 인정 결석·노쇼를 구분하지
-- 못하고 연락 타임라인도 없다(L-04 🔶). 회차 차감·잔액이라는 개념 자체가 코드에 없어
-- L-03·L-05의 "잔액 반영"이 전부 미구현이고, 계약 엔티티가 00018에서 생겼음에도 회차가
-- 계약에 귀속되지 않는다(L-10 ❌). 정정은 관리자가 기록을 덮어쓰는 것뿐이다(L-06 🔶).
--
-- 설계 원칙:
--  · 잔액은 저장하지 않고 원장에서 합산한다(session_ledger). 잔액 컬럼을 두면 차감·복원·정정이
--    엇갈릴 때 "숫자는 맞는데 근거가 없는" 상태가 생긴다 — 정본 L-06이 요구하는 "조정 이력"과
--    잔액이 같은 것이어야 재계산이 성립한다. 원장은 append-only(00013 activity_log·00015
--    homework_submissions와 같은 계열)이며 되돌림은 반대 부호 행으로만 남는다.
--  · 이중 차감 금지(L-05)는 앱 규율이 아니라 부분 유니크다: 한 회차의 같은 정정 회차(correction_no)
--    에서 같은 종류의 원장 기입은 하나뿐이다. 버그로 RPC가 두 번 불려도 두 번째는 INSERT에서
--    깨진다.
--  · 상태 전환은 조건을 UPDATE의 WHERE에 넣은 단일 문장으로만 한다(00015 close_homework_assignment
--    · 00018 activate_enrollment와 같은 계열) — 계수와 갱신 사이에 조건이 뒤집히는 창을 없앤다.
--  · 자동 제한 금지(L-08): 반복 노쇼는 "검토 업무"만 만들고 예약 제한은 만들지 않는다.
--    제한은 운영자 RPC로만 생긴다 — 트리거로 자동 제한을 거는 경로를 두지 않는다.
--  · 귀속 미확정 회차는 계산에 쓰지 않는다(L-10): contract_id가 없는 회차는 차감 자체가 거부된다.
--
-- 기존과의 관계(회귀 금지):
--  · lessons.absent는 그대로 둔다 — 기존 수업기록 화면·리포트 생성이 전부 이 컬럼을 읽는다.
--    출결의 정본은 schedules.attendance이고 lessons.absent는 호환 미러다(settle_attendance가
--    연결된 수업기록이 있을 때 함께 갱신).
--  · schedules.status의 기존 4값(planned·done·canceled·makeup)은 유지하고 'conflict'만 더한다.
--    기존 화면의 상태 필터·뱃지는 그대로 동작한다.

/* ---------- ⓪ contracts 복합 FK 키 ----------
   수업 묶음이 계약을 테넌트와 함께 참조한다(L-10 귀속의 뿌리). 00018은 enrollments에만
   unique(tenant_id, id)를 세웠다 — contracts에도 같은 바닥을 깐다. */
alter table public.contracts
  add constraint contracts_tenant_id_id_key unique (tenant_id, id);

-- schedules도 마찬가지다: 원장·연락 기록·정정 요청·보강(자기참조)이 모두 회차를 테넌트와 함께
-- 참조한다. 00001은 schedules에 이 키를 세우지 않았다(참조하는 자식이 없었다).
alter table public.schedules
  add constraint schedules_tenant_id_id_key unique (tenant_id, id);

-- 묶음은 등록·계약·학생 셋을 함께 참조한다. 셋을 각각 별도 FK로만 검사하면 조합은 아무도 보지
-- 않아, 다른 학생의 계약에 묶인 묶음을 만들 수 있고 그 학생의 회차가 남의 잔액을 깎는다
-- (L-10 "임의 귀속 금지"). 그래서 부모 쪽에 조합 키를 세워 복합 FK로 짝을 강제한다 —
-- 앱의 폼 검증이 아니라 DB가 판정한다.
alter table public.enrollments
  add constraint enrollments_tenant_id_student_key unique (tenant_id, id, student_id);
alter table public.contracts
  add constraint contracts_tenant_id_enrollment_key unique (tenant_id, id, enrollment_id);

/* ---------- ① lesson_packages — 수업 묶음 (L-01 · L-10) ----------
   정본 L-01 주 전환: "활성 등록·계약 확인 → 수업 묶음 조건 확인 → 전체 회차 후보 생성".
   그래서 묶음은 등록과 계약을 모두 필수로 참조한다 — 계약 없는 묶음은 존재할 수 없고, 이것이
   곧 회차의 계약 귀속(L-10)이 항상 확정 가능한 이유다.

   L-01 예외 "일정 생성이 결제·계약 완료를 대신하지 않는다": 그래서 draft로 만들어지고,
   활성화(activate_lesson_package)는 등록이 active이고 계약이 동의된 경우에만 통과한다.
   회차 후보 생성은 active 묶음에서만 가능하다.

   total_sessions: 계약상 총 회차. 동의 시점 스냅샷이며 이후 변경하지 않는다 — 회차가 늘거나
   줄면 원장에 grant/adjust 행으로 남긴다(무엇이 왜 바뀌었는지가 잔액과 같은 곳에 있어야 한다).
   pattern: {weekdays:[1,3], time:"17:00", duration_min:60} 형태의 반복 조건 스냅샷. 후보 시각
   계산은 앱(타임존·공휴일 판단)이 하고 DB는 충돌 판정과 확정만 맡는다. */

create table public.lesson_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  enrollment_id uuid not null,
  contract_id uuid not null,
  student_id uuid not null,
  title text not null default '',
  total_sessions int not null check (total_sessions between 1 and 200),
  unit_price int not null default 0 check (unit_price >= 0),
  pattern jsonb not null default '{}'::jsonb,
  starts_on date not null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'ended')),
  activated_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint lesson_packages_active_needs_time
    check (status <> 'active' or activated_at is not null),
  constraint lesson_packages_ended_needs_time
    check (status <> 'ended' or ended_at is not null),
  -- 조합 FK: 계약은 이 등록의 것이어야 하고, 등록은 이 학생의 것이어야 한다.
  foreign key (tenant_id, contract_id, enrollment_id)
    references public.contracts (tenant_id, id, enrollment_id) on delete cascade,
  foreign key (tenant_id, enrollment_id, student_id)
    references public.enrollments (tenant_id, id, student_id) on delete cascade,
  foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade
);

-- 한 계약에 살아 있는 묶음은 하나(L-10 "계약 후보 둘 이상 겹침" 방지의 뿌리). 조건이 바뀌면
-- 00018 규약대로 새 계약본에 동의를 받고 새 묶음을 만든다.
create unique index lesson_packages_one_live_per_contract
  on public.lesson_packages (tenant_id, contract_id)
  where status in ('draft', 'active');

create index idx_lesson_packages_student
  on public.lesson_packages (tenant_id, student_id, created_at desc);

create index idx_lesson_packages_active
  on public.lesson_packages (tenant_id, starts_on)
  where status = 'active';

/* ---------- ② schedules 확장 — 묶음·귀속·출결·보강 (L-03 · L-04 · L-05 · L-10) ----------
   attendance: null = 미확정. 확정되면 회차당 하나뿐이고(L-04 "최종 출결 단일성") 바꾸려면
   정정 흐름(attendance_corrections)을 거쳐야 한다 — settle_attendance는 attendance is null인
   회차만 확정한다.
   deduction_state: none(미판정) / deducted(차감됨) / waived(무차감 확정). 원장과 짝이며
   전환 시 이전 상태를 WHERE에 넣어 이중 차감을 원천 차단한다.
   correction_count: 정정 횟수. 원장 부분 유니크의 차수(correction_no)로 쓰인다 — 정정으로
   재차감이 필요할 때 이전 기입과 충돌하지 않으면서도 같은 차수의 중복 기입은 막는다.
   origin_schedule_id: 보강의 원 회차(L-05). 파생 회차의 귀속은 원 회차를 따른다(L-10). */

alter table public.schedules
  add column package_id uuid,
  add column contract_id uuid,
  add column ends_at timestamptz,
  add column attendance text
    check (attendance in ('present', 'late', 'early_leave', 'excused_absence', 'absent', 'noshow')),
  add column attendance_settled_at timestamptz,
  add column deduction_state text not null default 'none'
    check (deduction_state in ('none', 'deducted', 'waived')),
  add column correction_count int not null default 0 check (correction_count >= 0),
  add column origin_schedule_id uuid,
  add column conflict_reason text,
  add column actual_started_at timestamptz,   -- 지각: 실제 시작(L-04)
  add column actual_ended_at timestamptz;     -- 조퇴: 실제 종료(L-04)

alter table public.schedules
  add constraint schedules_package_fk
    foreign key (tenant_id, package_id)
    references public.lesson_packages (tenant_id, id) on delete set null (package_id),
  add constraint schedules_contract_fk
    foreign key (tenant_id, contract_id)
    references public.contracts (tenant_id, id) on delete set null (contract_id),
  add constraint schedules_origin_fk
    foreign key (tenant_id, origin_schedule_id)
    references public.schedules (tenant_id, id) on delete set null (origin_schedule_id);

-- 확정된 출결에는 확정 시각이 있어야 한다(정정 흐름의 기산점).
alter table public.schedules
  add constraint schedules_attendance_needs_time
    check (attendance is null or attendance_settled_at is not null);

-- 차감·무차감 판정은 출결 확정과 함께만 생긴다 — 출결 없는 차감은 근거 없는 잔액 변동이다.
alter table public.schedules
  add constraint schedules_deduction_needs_attendance
    check (deduction_state = 'none' or attendance is not null or status = 'canceled');

-- 'conflict' 추가: 후보 생성 시 충돌한 회차는 확정하지 않고 미확정 업무로 분리한다(L-01).
alter table public.schedules drop constraint schedules_status_check;
alter table public.schedules
  add constraint schedules_status_check
    check (status in ('planned', 'done', 'canceled', 'makeup', 'conflict'));

-- L-05 "원 회차당 활성 보강은 하나". 취소된 보강은 자리를 돌려준다(다시 잡을 수 있어야 한다).
create unique index schedules_one_active_makeup_per_origin
  on public.schedules (tenant_id, origin_schedule_id)
  where origin_schedule_id is not null and status <> 'canceled';

-- 후보 재생성 멱등성(L-01 "동시 수정: 먼저 확정된 일정 유지"): 같은 묶음의 같은 시각 슬롯은
-- 하나뿐이라 generate_package_sessions를 다시 돌려도 기존 회차를 복제하지 않는다.
--
-- 취소된 회차도 슬롯을 계속 점유한다. 취소를 인덱스에서 빼면 그 시각이 다시 열리고, 회차를
-- 더 만들려고 후보를 다시 펼칠 때(앱은 언제나 starts_on부터 전개한다) 취소된 슬롯이 planned로
-- 부활한다 — 원장에는 취소 차감과 부활 회차 차감이 둘 다 남아 같은 수업이 두 번 소진된다
-- (L-05 "이중 차감 금지"). 슬롯은 한 번 쓰면 끝이고, 같은 시각을 다시 쓰려면 보강이 아니라
-- 새 묶음이다.
create unique index schedules_one_per_package_slot
  on public.schedules (tenant_id, package_id, scheduled_at)
  where package_id is not null;

create index idx_schedules_package
  on public.schedules (tenant_id, package_id, scheduled_at);

-- 귀속 미확정 회차 목록(L-10 주 전환의 진입점) — 묶음은 있는데 계약이 없는 회차가 곧 업무다.
create index idx_schedules_unresolved_contract
  on public.schedules (tenant_id, scheduled_at)
  where contract_id is null and status in ('planned', 'done', 'makeup');

-- 출결 미확정 회차(L-03 "기록 미완료: 오늘 업무에 남기고 회차 후속을 닫지 않는다")
create index idx_schedules_attendance_pending
  on public.schedules (tenant_id, scheduled_at)
  where attendance is null and status in ('planned', 'makeup');

/* ---------- ③ session_ledger — 회차 원장 (L-03 · L-05 · L-06) ----------
   잔액의 정본. append-only이며 되돌림은 반대 부호 행으로만 남는다 — 어떤 잔액도 "왜 그 숫자인지"
   원장 행으로 설명된다. 이것이 L-06 "조정 이력 생성 → 잔액 재계산"이 같은 자료를 두 번
   기록하지 않게 하는 이유다.

   kind: deduct(회차 소진, -1) / restore(정정으로 되돌림, +1) / grant(추가 회차 부여, +N)
         / adjust(운영자 조정, ±N — 사유 필수).
   correction_no: 기입 시점의 schedules.correction_count. 부분 유니크의 차수다 — 같은 회차의
   같은 차수에서 같은 종류를 두 번 기입할 수 없다(이중 차감 금지의 DB 바닥). 정정으로
   correction_count가 오르면 다음 차수에서 재기입이 가능해진다. */

create table public.session_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  package_id uuid not null,
  schedule_id uuid,
  kind text not null check (kind in ('deduct', 'restore', 'grant', 'adjust')),
  delta int not null check (delta between -200 and 200),
  correction_no int not null default 0 check (correction_no >= 0),
  reason text not null default '',
  actor_email text,
  reverses_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  -- 종류와 부호가 어긋나면 합산이 뜻을 잃는다.
  constraint session_ledger_delta_sign check (
    (kind = 'deduct' and delta < 0) or
    (kind = 'restore' and delta > 0) or
    (kind = 'grant' and delta > 0) or
    (kind = 'adjust' and delta <> 0)
  ),
  -- 운영자 조정은 사유 없이 남길 수 없다(감사 대상).
  constraint session_ledger_adjust_needs_reason
    check (kind <> 'adjust' or length(btrim(reason)) > 0),
  -- 되돌림은 무엇을 되돌리는지 가리켜야 한다(L-06 재계산의 연결고리).
  constraint session_ledger_restore_needs_target
    check (kind <> 'restore' or reverses_id is not null),
  foreign key (tenant_id, package_id)
    references public.lesson_packages (tenant_id, id) on delete cascade,
  foreign key (tenant_id, schedule_id)
    references public.schedules (tenant_id, id) on delete set null (schedule_id),
  foreign key (tenant_id, reverses_id)
    references public.session_ledger (tenant_id, id) on delete set null (reverses_id)
);

-- 이중 차감 금지(L-05)의 DB 바닥: 한 회차·한 정정 차수에서 같은 종류의 기입은 하나뿐.
create unique index session_ledger_one_entry_per_round
  on public.session_ledger (tenant_id, schedule_id, kind, correction_no)
  where schedule_id is not null;

create index idx_session_ledger_package
  on public.session_ledger (tenant_id, package_id, created_at);

-- 회차 부여·조정은 잔액을 직접 움직이는데 회차에 매이지 않아 위 차수 유니크가 걸리지 않는다.
-- 더블클릭·재전송으로 같은 부여가 두 번 들어가면 근거 없는 잔액이 생긴다. 같은 묶음에 같은
-- 증감·같은 사유를 두 번 기입하는 것은 중복으로 보고 DB가 막는다 — 정말 두 번 부여해야 하면
-- 사유를 달리 적으면 되고, 그 다른 사유가 곧 두 번째 부여의 근거다.
-- (시각을 키에 넣지 않는 이유: timestamptz의 시간대 변환은 IMMUTABLE이 아니라 인덱스에 못 쓴다.)
create unique index session_ledger_manual_dedup
  on public.session_ledger (tenant_id, package_id, kind, delta, md5(btrim(reason)))
  where schedule_id is null;

-- 원장은 고쳐 쓰지 않는다 — 되돌림도 새 행이다(00013 activity_log·00015 제출물과 같은 계열).
--
-- 단, 부모가 사라지는 중이면 통과시킨다(00015 homework_submission_immutable와 같은 탈출구).
-- schedules를 지우면 FK가 schedule_id를 null로 미는 UPDATE를, lesson_packages·tenants를 지우면
-- CASCADE DELETE를 각각 이 트리거에 쏜다 — 탈출구가 없으면 학생·회차 삭제가 통째로 막혀
-- D 도메인의 파기 흐름이 진행되지 못한다. 부모가 아직 있는데 들어온 변경만 "직접 조작"이다.
create or replace function public.session_ledger_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.lesson_packages
                    where tenant_id = old.tenant_id and id = old.package_id) then
      return old;  -- 묶음·테넌트 CASCADE 진행 중
    end if;
  else
    -- schedule_id만 null로 밀리는 것은 회차 삭제에 딸린 FK 동작이다(그 외 컬럼은 그대로).
    if old.schedule_id is not null and new.schedule_id is null
       and (to_jsonb(old) - 'schedule_id') = (to_jsonb(new) - 'schedule_id') then
      return new;
    end if;
  end if;
  raise exception '회차 원장은 append-only입니다 — 되돌리려면 반대 부호 행을 추가하세요 (%)', tg_op;
end $$;

create trigger session_ledger_no_mutate
  before update or delete on public.session_ledger
  for each row execute function public.session_ledger_append_only();

/* ---------- ④ lesson_package_balances — 잔액 뷰 ----------
   잔액 = 계약 총 회차 + 원장 합. 저장하지 않으므로 원장과 어긋날 수 없다.
   security_invoker: 뷰가 정의자 권한으로 RLS를 우회하지 않게 한다 — 호출자 권한으로 평가되어
   아래 테이블의 테넌트 정책이 그대로 적용된다. */

create view public.lesson_package_balances
  with (security_invoker = true) as
select
  p.tenant_id,
  p.id            as package_id,
  p.student_id,
  p.status,
  p.total_sessions,
  coalesce(l.consumed, 0)                          as consumed,
  p.total_sessions + coalesce(l.net, 0)            as remaining,
  coalesce(s.confirmed, 0)                         as confirmed_sessions,
  coalesce(s.conflicted, 0)                        as conflicted_sessions,
  coalesce(s.unresolved, 0)                        as unresolved_sessions
from public.lesson_packages p
left join lateral (
  select
    sum(sl.delta)                                        as net,
    coalesce(-sum(sl.delta) filter (where sl.delta < 0), 0) as consumed
  from public.session_ledger sl
  where sl.tenant_id = p.tenant_id and sl.package_id = p.id
) l on true
left join lateral (
  select
    count(*) filter (where sc.status in ('planned', 'done', 'makeup'))       as confirmed,
    count(*) filter (where sc.status = 'conflict')                           as conflicted,
    count(*) filter (where sc.contract_id is null
                       and sc.status in ('planned', 'done', 'makeup'))       as unresolved
  from public.schedules sc
  where sc.tenant_id = p.tenant_id and sc.package_id = p.id
) s on true;

/* ---------- ⑤ attendance_contacts — 미참석 연락 타임라인 (L-04) ----------
   정본 L-04 예외: "연락에는 시각·경로·결과만 연결한다". 딱 그 셋만 둔다 — 통화 내용·메모를
   두면 학습기록과 뒤섞이고 개인정보 파기 범위가 흐려진다.
   10·20·30분 각 시점당 한 행. 셋이 모두 무응답이어야 노쇼 확정 게이트가 열린다. */

create table public.attendance_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  schedule_id uuid not null,
  minute_mark int not null check (minute_mark in (10, 20, 30)),
  channel text not null check (channel in ('call', 'sms', 'kakao', 'other')),
  result text not null check (result in ('no_answer', 'reached', 'entered')),
  actor_email text,
  contacted_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, schedule_id, minute_mark),
  foreign key (tenant_id, schedule_id)
    references public.schedules (tenant_id, id) on delete cascade
);

-- 원장과 같은 탈출구: 부모 회차가 사라지는 중이면 CASCADE를 막지 않는다.
create or replace function public.attendance_contacts_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE'
     and not exists (select 1 from public.schedules
                      where tenant_id = old.tenant_id and id = old.schedule_id) then
    return old;
  end if;
  raise exception '연락 기록은 append-only입니다 (%)', tg_op;
end $$;

create trigger attendance_contacts_no_mutate
  before update or delete on public.attendance_contacts
  for each row execute function public.attendance_contacts_append_only();

/* ---------- ⑥ attendance_corrections — 출결 정정 요청 (L-06) ----------
   정본 L-06: "정정 요청 → 원 기록 확인 → 운영자 검토 → 승인/거절 → 승인 시 조정 이력 생성".
   그래서 정정은 기록을 덮어쓰는 행위가 아니라 하나의 심사 대상 행이다. 원 출결(from_attendance)은
   요청 시점 스냅샷으로 보존되어, 승인 시 "무엇을 무엇으로 바꿨는지" 대조할 수 있다.

   to_deduct: 정정 후의 차감 여부. 정정이 잔액에 미치는 영향은 승인 시 원장 행으로 나타난다. */

create table public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  schedule_id uuid not null,
  requester_role text not null
    check (requester_role in ('operator', 'teacher', 'parent', 'student')),
  requested_by text not null,
  from_attendance text,
  from_deduction text,
  to_attendance text not null
    check (to_attendance in ('present', 'late', 'early_leave', 'excused_absence', 'absent', 'noshow')),
  to_deduct boolean not null default false,
  reason text not null check (length(btrim(reason)) > 0),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  decided_by text,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  -- 판정에는 판정자와 시각이 남아야 한다. 거절은 사유도 필수다(L-06 "사유와 다시 확인할 경로").
  constraint attendance_corrections_decided_needs_identity
    check (status = 'pending'
           or (decided_by is not null and decided_at is not null)),
  constraint attendance_corrections_reject_needs_reason
    check (status <> 'rejected' or length(btrim(coalesce(decision_reason, ''))) > 0),
  foreign key (tenant_id, schedule_id)
    references public.schedules (tenant_id, id) on delete cascade
);

-- 한 회차에 심사 중인 정정은 하나. 둘이 동시에 살아 있으면 어느 쪽 승인이 유효한지 알 수 없다.
create unique index attendance_corrections_one_pending_per_schedule
  on public.attendance_corrections (tenant_id, schedule_id)
  where status = 'pending';

create index idx_attendance_corrections_pending
  on public.attendance_corrections (tenant_id, created_at desc)
  where status = 'pending';

/* ---------- ⑦ booking_restrictions — 예약 위험·제한 (L-08) ----------
   정본 L-08 예외: "위험 후보만으로 자동 제한하지 않는다". 그래서 이 표에는 자동 삽입 경로가
   없다 — 트리거도, 크론도 만들지 않는다. 반복 노쇼는 work_items에 "검토 업무"만 만든다.
   제한 적용 범위도 정본대로다: 새 예약·추가 자리 제안만 막고 기존 확정 수업·학습기록·정산
   접근은 건드리지 않는다(그래서 이 표는 schedules를 취소하지 않는다).

   review_on: 재검토일. 정본 "제한 만료·재검토일 도달 → 자동 연장하지 않고 운영자가 확인" —
   그래서 만료 자동 해제도, 자동 연장도 없다. 재검토일이 지난 활성 제한은 업무로 뜬다. */

create table public.booking_restrictions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_id uuid not null,
  status text not null default 'active' check (status in ('active', 'lifted')),
  reason text not null check (length(btrim(reason)) > 0),
  evidence jsonb not null default '[]'::jsonb,
  review_on date not null,
  decided_by text not null,
  decided_at timestamptz not null default now(),
  lifted_by text,
  lifted_at timestamptz,
  lift_reason text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint booking_restrictions_lift_needs_identity
    check (status <> 'lifted'
           or (lifted_by is not null and lifted_at is not null
               and length(btrim(coalesce(lift_reason, ''))) > 0)),
  foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade
);

create unique index booking_restrictions_one_active_per_student
  on public.booking_restrictions (tenant_id, student_id)
  where status = 'active';

-- 재검토일이 지난 활성 제한 — 운영자 확인 대상(자동 해제하지 않는다)
create index idx_booking_restrictions_review_due
  on public.booking_restrictions (tenant_id, review_on)
  where status = 'active';

/* ---------- ⑧ RLS ----------
   전부 관리자 화면의 자료다(공개 토큰 경로가 없다) — 00013 activity_log 계열과 같은 테넌트
   정책을 단다. 뷰는 security_invoker라 아래 정책을 그대로 물려받는다. */

do $$
declare t text;
begin
  foreach t in array array[
    'lesson_packages', 'session_ledger', 'attendance_contacts',
    'attendance_corrections', 'booking_restrictions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy tenant_isolation on public.%I
         for all to authenticated
         using (tenant_id = public.jwt_tenant_id())
         with check (tenant_id = public.jwt_tenant_id())', t);
  end loop;
end $$;

/* ---------- ⑨ schedule_span — 회차 점유 구간 ----------
   충돌 판정의 단일 기준. ends_at이 없는 기존 회차(00001부터 쌓인 단건 일정)는 기본 60분으로
   본다 — 없는 값을 0분으로 보면 같은 시각의 두 수업이 충돌하지 않는 것으로 새어 나간다. */

create or replace function public.schedule_span(p_at timestamptz, p_ends timestamptz)
returns tstzrange
language sql
immutable
set search_path = public
as $$
  select tstzrange(p_at, greatest(coalesce(p_ends, p_at + interval '60 minutes'),
                                  p_at + interval '1 minute'), '[)');
$$;

/* ---------- ⑩ activate_lesson_package — 묶음 활성화 (L-01) ----------
   정본 L-01 예외: "일정 생성이 결제·계약 완료를 대신하지 않는다". 그래서 활성화는 등록이
   active이고 계약이 동의된 경우에만 통과한다 — 두 조건을 UPDATE의 WHERE에 넣어 판정과 전환
   사이에 계약이 철회되는 창을 없앤다. */

create or replace function public.activate_lesson_package(
  p_tenant uuid,
  p_package uuid,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  update public.lesson_packages p
     set status = 'active', activated_at = now()
   where p.tenant_id = p_tenant
     and p.id = p_package
     and p.status = 'draft'
     and exists (
       select 1 from public.enrollments e
        where e.tenant_id = p.tenant_id and e.id = p.enrollment_id and e.status = 'active')
     and exists (
       select 1 from public.contracts c
        where c.tenant_id = p.tenant_id and c.id = p.contract_id and c.agreed_at is not null)
  returning p.id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'gate');
  end if;
  return jsonb_build_object('ok', true, 'package_id', v_id, 'actor', p_actor);
end $$;

/* ---------- ⑪ generate_package_sessions — 전체 회차 후보 생성·충돌 분리 (L-01) ----------
   정본 L-01 주 전환: "전체 회차 후보 생성 → 기존 일정·휴무와 충돌 확인 → 정상 회차 확정 →
   충돌 회차 재협의 → 전체 결과 안내". 예외: "일부 충돌: 정상 회차는 유지하고 충돌 회차만
   미확정 업무로 분리".

   그래서 충돌한 후보를 버리지 않는다 — status='conflict'로 남기고 업무를 만든다. 전체 결과가
   confirmed + conflicted + skipped = total로 대사되어야 "누락 없이 안내"가 성립한다(L-07의
   대사 원칙과 같은 계열).

   후보 시각 계산(요일·시간·타임존·건너뛸 날)은 앱이 한다 — DB는 충돌 판정과 확정만 맡는다.
   같은 슬롯 재실행은 부분 유니크가 걸러 skipped로 센다(멱등). */

create or replace function public.generate_package_sessions(
  p_tenant uuid,
  p_package uuid,
  p_candidates jsonb,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg       record;
  v_item      jsonb;
  v_at        timestamptz;
  v_ends      timestamptz;
  v_conflict  boolean;
  v_id        uuid;
  v_total     int := 0;
  v_requested int := 0;
  v_before    int := 0;
  v_after     int := 0;
  v_confirmed int := 0;
  v_conflicted int := 0;
  v_skipped   int := 0;
begin
  select * into v_pkg from public.lesson_packages
   where tenant_id = p_tenant and id = p_package and status = 'active';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'package_not_active');
  end if;

  if jsonb_typeof(p_candidates) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'bad_candidates');
  end if;
  v_requested := jsonb_array_length(p_candidates);

  -- 같은 학생의 일정을 동시에 만드는 두 요청이 서로의 미커밋 행을 못 봐 겹치는 회차를 함께
  -- 확정하는 창을 닫는다(L-01 "동시 수정"). 자문 잠금은 트랜잭션 끝에 자동 해제된다.
  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant::text || ':' || v_pkg.student_id::text, 0));

  -- 하나라도 형식이 어긋나면 아무것도 만들지 않는다(반쪽 생성 금지 — 전체 결과 대사의 전제).
  if exists (
    select 1 from jsonb_array_elements(p_candidates) e
     where nullif(e.value ->> 'at', '') is null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'bad_candidates');
  end if;

  select count(*) into v_before from public.schedules
   where tenant_id = p_tenant and package_id = p_package;

  for v_item in select value from jsonb_array_elements(p_candidates) loop
    v_total := v_total + 1;
    v_at   := (v_item ->> 'at')::timestamptz;
    v_ends := nullif(v_item ->> 'ends_at', '')::timestamptz;

    select exists (
      select 1 from public.schedules s
       where s.tenant_id = p_tenant
         and s.student_id = v_pkg.student_id
         and s.status in ('planned', 'done', 'makeup')
         and public.schedule_span(s.scheduled_at, s.ends_at)
             && public.schedule_span(v_at, v_ends)
    ) into v_conflict;

    v_id := null;
    insert into public.schedules (
      tenant_id, student_id, scheduled_at, ends_at,
      package_id, contract_id, status, conflict_reason
    ) values (
      p_tenant, v_pkg.student_id, v_at, v_ends,
      p_package, v_pkg.contract_id,
      case when v_conflict then 'conflict' else 'planned' end,
      case when v_conflict then '기존 일정과 시간이 겹칩니다 — 재협의 후 시각 조정 또는 취소' end
    )
    on conflict (tenant_id, package_id, scheduled_at) where package_id is not null
      do nothing
    returning id into v_id;

    if v_id is null then
      v_skipped := v_skipped + 1;
    elsif v_conflict then
      v_conflicted := v_conflicted + 1;
      insert into public.work_items (
        tenant_id, kind, title, detail, source_type, source_id, priority, next_action
      ) values (
        p_tenant, 'schedule_conflict',
        '충돌 회차 재협의 필요',
        to_char(v_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') || ' 회차가 기존 일정과 겹칩니다.',
        'schedule', v_id::text, 'normal',
        '대상자와 재협의해 시각을 조정하거나 해당 회차를 취소하세요.'
      )
      on conflict do nothing;
    else
      v_confirmed := v_confirmed + 1;
    end if;
  end loop;

  -- 대사는 루프 카운터끼리 맞춰봐야 항상 참인 동어반복이다. 실제로 대조할 것은 두 가지다:
  --  ① 받은 후보 수와 처리한 수가 같은가 ② 새로 생긴 회차 수가 확정+충돌과 같은가.
  -- 이 둘이 어긋나면 조용히 삼켜진 INSERT가 있다는 뜻이다(L-01 "전체 결과 안내").
  select count(*) into v_after from public.schedules
   where tenant_id = p_tenant and package_id = p_package;

  return jsonb_build_object(
    'ok', true,
    'requested', v_requested,
    'total', v_total,
    'confirmed', v_confirmed,
    'conflicted', v_conflicted,
    'skipped', v_skipped,
    'reconciled', v_total = v_requested
                  and (v_after - v_before) = (v_confirmed + v_conflicted),
    'actor', p_actor
  );
end $$;

/* ---------- ⑫ settle_attendance — 출결 확정·회차 차감 (L-03 · L-04 · L-05 · L-10) ----------
   회차당 최종 출결은 하나다(L-04) — attendance is null인 회차만 확정된다. 바꾸려면 정정
   흐름을 거쳐야 한다.

   차감 게이트 셋을 UPDATE의 WHERE에 함께 넣는다:
    · 귀속 미확정 회차는 차감하지 않는다(L-10 "환불·잔액 계산에서 확정 사실처럼 사용하지 않는다").
    · 활성 보강이 달린 원 회차는 차감하지 않는다(L-05 "원 회차와 대체 회차를 동시에 차감하지 않는다").
    · 노쇼는 확정 게이트(10·20·30분 전부 무응답 + 30분 경과)를 통과해야 한다(L-04) —
      그 전에는 잔액 계산에 반영되지 않는다.

   lessons.absent 미러: 연결된 수업기록이 있으면 함께 갱신한다. 출결의 정본은 여기이고
   lessons.absent는 기존 화면·리포트 호환 미러다. */

create or replace function public.settle_attendance(
  p_tenant uuid,
  p_schedule uuid,
  p_attendance text,
  p_deduct boolean,
  p_reason text,
  p_actor text,
  p_actual_started_at timestamptz default null,
  p_actual_ended_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row        record;
  v_no_answer  int;
  v_marks      int;
  v_sched_at   timestamptz;
  v_student    uuid;
  v_noshows    int;
  v_remaining  int;
begin
  if p_attendance not in ('present', 'late', 'early_leave', 'excused_absence', 'absent', 'noshow') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_attendance');
  end if;

  select scheduled_at, student_id into v_sched_at, v_student
    from public.schedules
   where tenant_id = p_tenant and id = p_schedule;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- 회차가 시작하기 전에는 출결을 확정하지 않는다(L-03 "회차 시작 → 출결 → … → 잔액 반영").
  -- 목록에서 한 줄 잘못 눌러 다음 달 회차가 소진되는 일을 막는다. 사전 취소는 cancel_schedule 몫.
  if now() < v_sched_at then
    return jsonb_build_object('ok', false, 'reason', 'not_started');
  end if;

  -- 노쇼 확정 게이트(L-04): 10·20·30분 연락이 모두 기록되고 모두 무응답이며 30분이 지나야 한다.
  -- 연락 "시각"도 본다 — 수업 3시간 전에 세 건을 미리 찍어두면 게이트가 뜻을 잃는다.
  if p_attendance = 'noshow' then
    select count(*),
           count(*) filter (
             where result = 'no_answer'
               and contacted_at >= v_sched_at + make_interval(mins => minute_mark))
      into v_marks, v_no_answer
      from public.attendance_contacts
     where tenant_id = p_tenant and schedule_id = p_schedule;
    if v_marks < 3 or v_no_answer < 3 then
      return jsonb_build_object('ok', false, 'reason', 'noshow_contacts_incomplete');
    end if;
    if now() < v_sched_at + interval '30 minutes' then
      return jsonb_build_object('ok', false, 'reason', 'noshow_too_early');
    end if;
  end if;

  update public.schedules s
     set attendance = p_attendance,
         attendance_settled_at = now(),
         status = 'done',
         deduction_state = case when p_deduct then 'deducted' else 'waived' end,
         actual_started_at = coalesce(p_actual_started_at, s.actual_started_at),
         actual_ended_at = coalesce(p_actual_ended_at, s.actual_ended_at)
   where s.tenant_id = p_tenant
     and s.id = p_schedule
     and s.attendance is null
     and s.status in ('planned', 'makeup')
     and (not p_deduct or (s.package_id is not null and s.contract_id is not null))
     -- 종료된 묶음의 회차는 더 이상 잔액을 움직이지 않는다. 종료가 곧 정산 기산점이라
     -- 그 뒤의 차감은 이미 확정한 환불·정산 근거를 사후에 흔든다(검수 45).
     and (not p_deduct or exists (
           select 1 from public.lesson_packages p
            where p.tenant_id = s.tenant_id and p.id = s.package_id and p.status = 'active'))
     and (not p_deduct or not exists (
           select 1 from public.schedules m
            where m.tenant_id = s.tenant_id
              and m.origin_schedule_id = s.id
              and m.status <> 'canceled'))
  returning s.* into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'gate');
  end if;

  if p_deduct then
    insert into public.session_ledger (
      tenant_id, package_id, schedule_id, kind, delta, correction_no, reason, actor_email
    ) values (
      p_tenant, v_row.package_id, p_schedule, 'deduct', -1, v_row.correction_count,
      coalesce(nullif(btrim(p_reason), ''), '회차 소진: ' || p_attendance), p_actor
    );
  end if;

  -- 호환 미러(기존 수업기록 화면·리포트 생성이 읽는 값)
  if v_row.lesson_id is not null then
    update public.lessons
       set absent = (p_attendance in ('absent', 'noshow', 'excused_absence')),
           updated_at = now()
     where tenant_id = p_tenant and id = v_row.lesson_id;
  end if;

  -- L-08: 확정 노쇼가 누적되면 "예약 위험 검토 업무"만 만든다. 제한은 걸지 않는다(자동 제한 금지).
  if p_attendance = 'noshow' then
    select count(*) into v_noshows
      from public.schedules
     where tenant_id = p_tenant and student_id = v_student
       and attendance = 'noshow'
       and scheduled_at >= now() - interval '90 days';
    if v_noshows >= 3
       and not exists (select 1 from public.booking_restrictions br
                        where br.tenant_id = p_tenant and br.student_id = v_student
                          and br.status = 'active') then
      insert into public.work_items (
        tenant_id, kind, title, detail, source_type, source_id, priority, next_action
      ) values (
        p_tenant, 'booking_risk_review', '반복 노쇼 — 예약 위험 검토',
        '최근 90일 확정 노쇼 ' || v_noshows || '회.',
        'student', v_student::text, 'risk',
        '원 출결·정정·연락 이력을 확인한 뒤 제한 없음 / 추가 확인 / 위험 확정 중 하나로 판단하세요.'
      )
      on conflict do nothing;
    end if;
  end if;

  if v_row.package_id is not null then
    select remaining into v_remaining from public.lesson_package_balances
     where tenant_id = p_tenant and package_id = v_row.package_id;
  end if;

  return jsonb_build_object(
    'ok', true, 'attendance', p_attendance, 'deducted', p_deduct,
    'package_id', v_row.package_id, 'remaining', v_remaining, 'actor', p_actor
  );
end $$;

/* ---------- ⑬ cancel_schedule — 회차 취소·차감 판정 (L-05) ----------
   정본 L-05 판정 분기: "차감 변경·취소 → 원 회차 종료 → 잔액 반영" / "무차감 변경 → 원 회차
   종료 → 대체 회차". 취소는 출결 확정이 아니라 회차 종료다 — attendance는 남기지 않고
   deduction_state만 확정한다.

   활성 보강이 달린 회차는 차감 취소를 할 수 없다(이중 차감 금지) — 보강을 먼저 취소해야 한다. */

create or replace function public.cancel_schedule(
  p_tenant uuid,
  p_schedule uuid,
  p_deduct boolean,
  p_reason text,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row record;
begin
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  update public.schedules s
     set status = 'canceled',
         deduction_state = case when p_deduct then 'deducted' else 'waived' end
   where s.tenant_id = p_tenant
     and s.id = p_schedule
     and s.status in ('planned', 'makeup', 'conflict')
     and s.deduction_state = 'none'
     and (not p_deduct or (s.package_id is not null and s.contract_id is not null))
     and (not p_deduct or exists (
           select 1 from public.lesson_packages p
            where p.tenant_id = s.tenant_id and p.id = s.package_id and p.status = 'active'))
     and (not p_deduct or not exists (
           select 1 from public.schedules m
            where m.tenant_id = s.tenant_id
              and m.origin_schedule_id = s.id
              and m.status <> 'canceled'))
  returning s.* into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'gate');
  end if;

  if p_deduct then
    insert into public.session_ledger (
      tenant_id, package_id, schedule_id, kind, delta, correction_no, reason, actor_email
    ) values (
      p_tenant, v_row.package_id, p_schedule, 'deduct', -1, v_row.correction_count,
      btrim(p_reason), p_actor
    );
  end if;

  -- 열려 있던 충돌 업무는 취소로 해소된다.
  update public.work_items
     set status = 'done', resolution = '회차 취소로 해소', resolved_at = now(), updated_at = now()
   where tenant_id = p_tenant and kind = 'schedule_conflict'
     and source_type = 'schedule' and source_id = p_schedule::text
     and status in ('open', 'in_progress');

  return jsonb_build_object('ok', true, 'deducted', p_deduct, 'package_id', v_row.package_id);
end $$;

/* ---------- ⑭ create_makeup — 원 회차 종료 + 대체 회차 (L-05) ----------
   정본 L-05: "무차감 변경 → 원 회차 종료 → 대체 회차". 두 일이 한 문장 안에서 끝나야 한다 —
   원 회차만 닫히고 대체가 안 생기거나, 대체만 생기고 원 회차가 남는 반쪽 상태를 만들지 않는다.

   대체 회차는 원 회차의 묶음·계약을 그대로 물려받는다(L-10 "파생 회차는 원 회차 기준으로
   재계산"). 차감은 대체 회차에서 일어난다 — 원 회차는 waived로 닫히므로 이중 차감이 없다.
   "대체 회차는 충돌 확인 후 확정"(L-05): 겹치면 만들지 않고 거절한다. */

create or replace function public.create_makeup(
  p_tenant uuid,
  p_origin uuid,
  p_at timestamptz,
  p_ends_at timestamptz,
  p_reason text,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origin record;
  v_new    uuid;
begin
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  select * into v_origin from public.schedules
   where tenant_id = p_tenant and id = p_origin;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- 겹침 검사와 INSERT가 두 문장이라, 같은 학생의 보강을 동시에 잡는 두 요청이 서로의 미커밋
  -- 행을 못 보고 둘 다 통과할 수 있다(L-05 "대체 회차는 충돌 확인 후 확정"). 학생 단위 자문
  -- 잠금으로 직렬화한다 — generate_package_sessions와 같은 키라 두 경로도 서로를 막는다.
  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant::text || ':' || v_origin.student_id::text, 0));

  -- 이미 차감된 회차는 대체하지 않는다 — 차감 취소는 그 자체로 종료다(L-05 판정 분기).
  if v_origin.deduction_state = 'deducted' then
    return jsonb_build_object('ok', false, 'reason', 'origin_already_deducted');
  end if;

  if exists (
    select 1 from public.schedules s
     where s.tenant_id = p_tenant
       and s.student_id = v_origin.student_id
       and s.id <> p_origin
       and s.status in ('planned', 'done', 'makeup')
       and public.schedule_span(s.scheduled_at, s.ends_at)
           && public.schedule_span(p_at, p_ends_at)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'conflict');
  end if;

  -- 원 회차 종료(무차감). 이미 닫힌 회차라면 0행 → 대체도 만들지 않는다.
  update public.schedules
     set status = 'canceled', deduction_state = 'waived'
   where tenant_id = p_tenant and id = p_origin
     and status in ('planned', 'makeup', 'conflict')
     and deduction_state = 'none';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'origin_not_open');
  end if;

  -- 활성 보강 단일성은 schedules_one_active_makeup_per_origin이 강제한다 — 두 번째는 여기서 깨진다.
  insert into public.schedules (
    tenant_id, student_id, scheduled_at, ends_at, class_type,
    package_id, contract_id, status, origin_schedule_id
  ) values (
    p_tenant, v_origin.student_id, p_at, p_ends_at, v_origin.class_type,
    v_origin.package_id, v_origin.contract_id, 'makeup', p_origin
  )
  returning id into v_new;

  return jsonb_build_object('ok', true, 'makeup_id', v_new, 'origin_id', p_origin, 'actor', p_actor);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'makeup_exists');
end $$;

/* ---------- ⑮ decide_attendance_correction — 정정 승인·거절 (L-06) ----------
   정본 L-06: "승인 시 조정 이력 생성 → 출결·잔액·환불·보고서 영향 재계산 → 대상자 안내".

   조정 이력 = 원장의 반대 부호 행이다. 원 기입을 고치지 않는다(append-only) — restore 행이
   reverses_id로 원 차감을 가리켜 "무엇이 왜 되돌려졌는지"가 남는다.
   correction_count를 올린 뒤 재차감하므로 원장 부분 유니크(차수)와 충돌하지 않으면서도
   같은 차수의 중복 기입은 여전히 막힌다.

   보고서 영향(L-06 "이미 게시된 보고서 영향: 정정본 생성 → 재승인·재게시"): 자동으로 회수하지
   않는다 — 운영자 판단이 필요한 일이므로 업무만 만든다.
   진행 중인 환불(L-06 "정정 전 계산으로 진행 중인 환불: 실행 중단 → 새 계산으로 재검토"):
   같은 이유로 업무를 만들어 사람이 멈추게 한다. */

create or replace function public.decide_attendance_correction(
  p_tenant uuid,
  p_correction uuid,
  p_approve boolean,
  p_decider text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cor      record;
  v_sched    record;
  v_prev     uuid;
  v_round    int;
  v_marks    int;
  v_no_answer int;
  v_restored boolean := false;
  v_deducted boolean := false;
  v_reports  int := 0;
begin
  if not p_approve and length(btrim(coalesce(p_reason, ''))) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  update public.attendance_corrections c
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = p_decider,
         decided_at = now(),
         decision_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where c.tenant_id = p_tenant and c.id = p_correction and c.status = 'pending'
  returning c.* into v_cor;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;

  if not p_approve then
    return jsonb_build_object('ok', true, 'approved', false);
  end if;

  select * into v_sched from public.schedules
   where tenant_id = p_tenant and id = v_cor.schedule_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'schedule_missing');
  end if;

  -- 정정은 "이미 판정이 끝난 회차"를 고치는 흐름이다(L-06 "원 기록 확인"). 아직 아무 판정도
  -- 없는 회차를 정정 승인으로 확정하면 settle_attendance의 게이트(귀속·보강·노쇼·시각)를
  -- 통째로 우회한다. 다만 취소는 출결을 남기지 않는 판정이므로(cancel_schedule) 정정 대상이다 —
  -- 차감 취소를 되돌릴 길이 없으면 잘못된 차감이 원장에 영구히 남는다.
  if v_sched.attendance is null and v_sched.status <> 'canceled' then
    return jsonb_build_object('ok', false, 'reason', 'not_settled');
  end if;

  -- 노쇼 확정 게이트(L-04)는 정정 경로에도 그대로 적용된다 — 정정이 게이트의 뒷문이 되면
  -- "연락 없이 확정된 노쇼"가 잔액·예약 위험 판단에 들어간다.
  if v_cor.to_attendance = 'noshow' then
    select count(*),
           count(*) filter (
             where result = 'no_answer'
               and contacted_at >= v_sched.scheduled_at + make_interval(mins => minute_mark))
      into v_marks, v_no_answer
      from public.attendance_contacts
     where tenant_id = p_tenant and schedule_id = v_sched.id;
    if v_marks < 3 or v_no_answer < 3
       or now() < v_sched.scheduled_at + interval '30 minutes' then
      return jsonb_build_object('ok', false, 'reason', 'noshow_gate');
    end if;
  end if;

  -- 이번 정정 차수. 이 라운드에 쌓이는 원장 행은 전부 이 번호를 쓴다 — 한 라운드에 같은 종류의
  -- 기입이 둘일 수 없다는 것이 부분 유니크(schedule, kind, correction_no)의 뜻이다.
  v_round := v_sched.correction_count + 1;

  -- 되돌릴 대상은 "아직 되돌려지지 않은 마지막 차감"이다. 차수로 찾으면 안 된다 — 차감을 유지한
  -- 정정(예: 출석→지각, 차감 유지)이 한 번이라도 끼면 correction_count와 차감 기입의 차수가
  -- 어긋나, 다음 정정에서 원 차감을 못 찾고 잔액만 새는 상태가 된다.
  if v_sched.deduction_state = 'deducted' and not v_cor.to_deduct then
    select l.id into v_prev
      from public.session_ledger l
     where l.tenant_id = p_tenant and l.schedule_id = v_sched.id and l.kind = 'deduct'
       and not exists (
         select 1 from public.session_ledger r
          where r.tenant_id = l.tenant_id and r.reverses_id = l.id)
     order by l.created_at desc
     limit 1;
    if v_prev is not null then
      insert into public.session_ledger (
        tenant_id, package_id, schedule_id, kind, delta, correction_no, reason, actor_email, reverses_id
      ) values (
        p_tenant, v_sched.package_id, v_sched.id, 'restore', 1, v_round,
        '출결 정정 승인: ' || v_cor.reason, p_decider, v_prev
      );
      v_restored := true;
    end if;
  end if;

  -- 취소 회차의 정정은 차감 판정만 되돌린다 — 취소된 회차에 출결을 새로 붙이면 "열리지 않은
  -- 수업의 출석"이 생긴다. 확정된 회차는 출결과 차감을 함께 갱신한다.
  if v_sched.attendance is null and v_sched.status = 'canceled' then
    update public.schedules
       set correction_count = v_round,
           deduction_state = case when v_cor.to_deduct then 'deducted' else 'waived' end
     where tenant_id = p_tenant and id = v_sched.id;
  else
    update public.schedules
       set attendance = v_cor.to_attendance,
           attendance_settled_at = now(),
           correction_count = v_round,
           deduction_state = case when v_cor.to_deduct then 'deducted' else 'waived' end
     where tenant_id = p_tenant and id = v_sched.id;
  end if;

  -- 정정 결과가 차감이고 아직 차감 상태가 아니었다면 이번 차수로 기입한다.
  if v_cor.to_deduct and v_sched.deduction_state <> 'deducted'
     and v_sched.package_id is not null and v_sched.contract_id is not null then
    insert into public.session_ledger (
      tenant_id, package_id, schedule_id, kind, delta, correction_no, reason, actor_email
    ) values (
      p_tenant, v_sched.package_id, v_sched.id, 'deduct', -1, v_round,
      '출결 정정 승인: ' || v_cor.reason, p_decider
    );
    v_deducted := true;
  end if;

  -- 게시된 보고서 영향 — 자동 회수하지 않고 정정본 재승인 업무를 만든다.
  select count(*) into v_reports from public.ai_reports r
   where r.tenant_id = p_tenant
     and r.student_id = v_sched.student_id
     and r.status in ('approved', 'sent')
     and r.created_at >= v_sched.scheduled_at - interval '1 day';
  if v_reports > 0 then
    insert into public.work_items (
      tenant_id, kind, title, detail, source_type, source_id, priority, next_action
    ) values (
      p_tenant, 'report_recheck', '출결 정정 — 게시된 보고서 재검토',
      '정정된 회차와 겹치는 승인·발송 보고서 ' || v_reports || '건.',
      'schedule', v_sched.id::text, 'normal',
      '영향 보고서의 정정본을 만들어 재승인·재게시하세요(기존 승인본은 유지).'
    )
    on conflict do nothing;
  end if;

  -- 잔액이 실제로 움직였고 환불 대상이 될 결제가 남아 있으면, 정정 전 계산으로 진행되던 환불을
  -- 멈추고 새 잔액으로 다시 계산해야 한다(L-06). 잔액이 그대로면 환불 근거도 그대로이므로
  -- 업무를 만들지 않는다 — 모든 정정마다 뜨는 업무는 아무도 읽지 않는다.
  if (v_restored or v_deducted) and exists (
    select 1 from public.payments pay
     where pay.tenant_id = p_tenant and pay.student_id = v_sched.student_id
       and pay.status = 'paid' and pay.refunded_at is null
  ) then
    insert into public.work_items (
      tenant_id, kind, title, detail, source_type, source_id, priority, next_action
    ) values (
      p_tenant, 'refund_recheck', '출결 정정 — 진행 중 환불 재검토',
      '정정 전 계산으로 진행 중인 환불이 있습니다.',
      'schedule', v_sched.id::text, 'money',
      '진행 중 환불 실행을 멈추고 정정 후 잔액으로 다시 계산하세요.'
    )
    on conflict do nothing;
  end if;

  return jsonb_build_object(
    'ok', true, 'approved', true,
    'restored', v_restored, 'deducted', v_deducted,
    'reports_affected', v_reports
  );
end $$;

/* ---------- ⑯ resolve_schedule_contract — 회차 계약 귀속 확정 (L-10) ----------
   정본 L-10 예외: "운영자가 후보가 아닌 계약을 임의 선택해 귀속하지 않는다". 그래서 이 함수는
   운영자가 고른 계약을 그대로 받아 적지 않는다 — 후보를 다시 계산하고, 후보가 정확히 하나이며
   그것이 운영자가 고른 것과 같을 때만 확정한다.

   후보 = 그 학생의 등록 중 회차 시각을 포함하는 기간의, 동의된 계약. 파생 회차(보강)는 원
   회차의 귀속을 따른다 — 원 회차가 미확정이면 파생도 확정하지 않는다.
   후보가 없거나 둘 이상이면 계약 원장·등록 기간을 먼저 정정해야 한다(정본 분기). */

create or replace function public.resolve_schedule_contract(
  p_tenant uuid,
  p_schedule uuid,
  p_contract uuid,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sched     record;
  v_candidate uuid;
  v_count     int;
  v_package   uuid;
begin
  select * into v_sched from public.schedules
   where tenant_id = p_tenant and id = p_schedule;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_sched.contract_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_resolved');
  end if;

  if v_sched.origin_schedule_id is not null then
    -- 파생 회차: 원 회차부터 해결한다.
    select contract_id into v_candidate from public.schedules
     where tenant_id = p_tenant and id = v_sched.origin_schedule_id;
    if v_candidate is null then
      return jsonb_build_object('ok', false, 'reason', 'origin_unresolved');
    end if;
    v_count := 1;
  else
    select count(*), (array_agg(c.id))[1] into v_count, v_candidate
      from public.contracts c
      join public.enrollments e
        on e.tenant_id = c.tenant_id and e.id = c.enrollment_id
     where c.tenant_id = p_tenant
       and c.agreed_at is not null
       and e.student_id = v_sched.student_id
       and e.activated_at is not null
       and e.activated_at <= v_sched.scheduled_at
       and (e.ended_at is null or e.ended_at >= v_sched.scheduled_at);
  end if;

  if v_count = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_candidate');
  end if;
  if v_count > 1 then
    return jsonb_build_object('ok', false, 'reason', 'ambiguous', 'candidates', v_count);
  end if;
  if p_contract is distinct from v_candidate then
    return jsonb_build_object('ok', false, 'reason', 'not_a_candidate', 'candidate', v_candidate);
  end if;

  select id into v_package from public.lesson_packages
   where tenant_id = p_tenant and contract_id = v_candidate and status in ('draft', 'active')
   limit 1;

  update public.schedules
     set contract_id = v_candidate,
         package_id = coalesce(package_id, v_package)
   where tenant_id = p_tenant and id = p_schedule and contract_id is null;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'raced');
  end if;

  return jsonb_build_object('ok', true, 'contract_id', v_candidate, 'package_id',
                            coalesce(v_sched.package_id, v_package), 'actor', p_actor);
end $$;

/* ---------- ⑰ 실행 권한 ----------
   전부 service_role 전용이다 — 앱의 service client만 부른다(00013·00015·00018과 같은 규약).

   **revoke가 grant보다 먼저여야 한다.** 새 함수의 proacl은 NULL로 남고 NULL은
   acldefault(`{=X/postgres,postgres=X/postgres}`)로 해석되는데 여기엔 PUBLIC EXECUTE가 붙어 있다.
   anon·authenticated는 PUBLIC의 일원이므로, revoke를 빠뜨리면 apikey(anon)만으로
   /rest/v1/rpc/settle_attendance 를 호출해 임의 테넌트의 회차 차감·출결 확정·정정 승인을
   실행할 수 있다 — 이 함수들은 전부 security definer라 RLS도 우회한다.
   00011이 정확히 이 사고(automation_call_flush 무단 호출)를 겪고 쓰인 마이그레이션이고,
   00013:383 · 00015 · 00017 · 00018이 모두 같은 revoke를 명시한다. */

revoke execute on function public.activate_lesson_package(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.generate_package_sessions(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function public.settle_attendance(uuid, uuid, text, boolean, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.cancel_schedule(uuid, uuid, boolean, text, text) from public, anon, authenticated;
revoke execute on function public.create_makeup(uuid, uuid, timestamptz, timestamptz, text, text) from public, anon, authenticated;
revoke execute on function public.decide_attendance_correction(uuid, uuid, boolean, text, text) from public, anon, authenticated;
revoke execute on function public.resolve_schedule_contract(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.schedule_span(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.session_ledger_append_only() from public, anon, authenticated;
revoke execute on function public.attendance_contacts_append_only() from public, anon, authenticated;

grant execute on function public.activate_lesson_package(uuid, uuid, text) to service_role;
grant execute on function public.generate_package_sessions(uuid, uuid, jsonb, text) to service_role;
grant execute on function public.settle_attendance(uuid, uuid, text, boolean, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.cancel_schedule(uuid, uuid, boolean, text, text) to service_role;
grant execute on function public.create_makeup(uuid, uuid, timestamptz, timestamptz, text, text) to service_role;
grant execute on function public.decide_attendance_correction(uuid, uuid, boolean, text, text) to service_role;
grant execute on function public.resolve_schedule_contract(uuid, uuid, uuid, text) to service_role;
grant execute on function public.schedule_span(timestamptz, timestamptz) to service_role;
