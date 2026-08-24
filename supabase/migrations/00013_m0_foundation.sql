-- 00013: M0 기반·불변식 — 단일 활성 운영자·세션 회수(P-10), 감사 fail-closed·append-only(P-11),
-- 업무 성공과 전달 성공의 분리(N-02), 오늘 업무 큐(시나리오 50), 원자적 승계(시나리오 67·68).
--
-- 근거: docs/flow-canon/07_rollout_plan.md M0 · 01_atlas_02_portal_lessons.md(P-10·P-11)
--       · 01_atlas_04_money_notify.md(N-02) · 03_scenarios_133.md(50·67·68)
--
-- 채택 시점: ④ adjustments(조정 이력 공통 테이블)의 실제 호출부 연결은 M3(출결·성적 정정)·
-- M5(채점·보고서 철회)에서 이뤄진다 — 여기서는 append-only 공통 패턴(테이블+거부 트리거)만 깐다.

/* ---------- ① admin_sessions — 서버측 회수 가능 세션 (P-10) ----------
   기존 세션은 무상태 서명 쿠키라 회수가 불가능했다(01_atlas_02 P-10 갭). 세션을 DB 행으로
   두고 revoked_at으로 즉시 무효화할 수 있게 한다. token_hash만 저장(원문 토큰은 쿠키에만).
   RLS는 정책 없이 켠다 = service_role 전용(00010 패턴 — 인증 전 단계라 authenticated 컨텍스트가 없다).
   만료·회수된 행의 물리 정리는 이후 크론 몫 — 여기서는 스키마만. */

create table public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text
);

-- 승계·로그아웃 시 "이 운영자의 세션 전부"를 찾는 경로
create index idx_admin_sessions_tenant_email on public.admin_sessions (tenant_id, email);

alter table public.admin_sessions enable row level security;

/* ---------- ② admin_accounts — 단일 활성 운영자 (P-10) ----------
   정본: "한 시점에 두 명의 활성 운영자를 남기지 않는다". 00007이 '관리자 1인 제약 완화'로
   다중 활성을 허용했던 것을 status로 되돌린다 — 행 삭제 대신 inactive 전환(이력 보존). */

alter table public.admin_accounts
  add column status text not null default 'active'
    check (status in ('active', 'inactive'));

-- 백필: 각 테넌트에서 tenants.email과 일치하는 행만 active, 나머지 inactive.
-- 일치 행이 없으면 가장 오래된 행을 active로 남긴다(운영자 부재 방지 — 시나리오 67
-- "운영자가 사라지는 반쪽 전환 금지"). (tenant_id, email)이 PK라 일치 행은 테넌트당 최대 1개.
with ranked as (
  select a.tenant_id, a.email,
         row_number() over (
           partition by a.tenant_id
           order by (lower(a.email) = lower(t.email)) desc, a.created_at asc, a.email asc
         ) as rn
    from public.admin_accounts a
    join public.tenants t on t.id = a.tenant_id
)
update public.admin_accounts a
   set status = case when r.rn = 1 then 'active' else 'inactive' end
  from ranked r
 where a.tenant_id = r.tenant_id
   and a.email = r.email;

-- 어떤 경로(수동 SQL·버그 포함)로도 2인 활성이 못 남게 DB가 차단한다.
create unique index admin_accounts_one_active_per_tenant
  on public.admin_accounts (tenant_id)
  where status = 'active';

/* ---------- ③ activity_log 확장 + append-only 강제 (P-11 · 시나리오 68) ----------
   정본: 중요행위는 행위자·대상·이전 결과·새 결과·사유가 연결되어야 하고(P-11 주 전환),
   "감사 확인이 원 기록 수정 권한을 주지 않는다". 기존 summary 문자열만으로는 대조가
   불가능했다 — before/after/reason을 추가하고, phase로 fail-closed 2단 기록
   (pending 선기록 → 전환 실행 → committed/aborted 확정)을 지원한다. */

alter table public.activity_log
  add column category text not null default 'other'
    check (category in ('money', 'permission', 'grade', 'privacy', 'other')),
  add column phase text not null default 'committed'
    check (phase in ('pending', 'committed', 'aborted')),
  add column before_data jsonb,
  add column after_data jsonb,
  add column reason text;

-- pending 잔존(전환 결과 불명) 점검 경로 — 결과 불명은 성공이 아니다(오늘 업무로 수렴 대상)
create index idx_activity_log_pending
  on public.activity_log (tenant_id, created_at)
  where phase = 'pending';

-- append-only 강제: 허용되는 유일한 UPDATE는 phase pending→committed|aborted 확정이며,
-- 그때 사유(reason) 기재까지만 함께 허용한다(abort 시 실패 사유를 남기는 경로 —
-- lib/data/activity.ts abortCriticalActivity). 그 외 컬럼 변경·DELETE는 전면 거부.
-- 트리거는 service_role(BYPASSRLS)에도 적용된다 — RLS가 아닌 무결성 규칙이기 때문.
create or replace function public.activity_log_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '[audit] activity_log은 append-only — DELETE 금지 (P-11: 감사 확인이 원 기록 수정 권한을 주지 않는다)';
  end if;
  if old.phase = 'pending'
     and new.phase in ('committed', 'aborted')
     and (to_jsonb(old) - 'phase' - 'reason') = (to_jsonb(new) - 'phase' - 'reason') then
    return new;
  end if;
  raise exception '[audit] activity_log UPDATE는 phase pending→committed|aborted 확정(+reason)만 허용 — 현재 %→%',
    old.phase, new.phase;
end $$;

create trigger trg_activity_log_append_only
  before update or delete on public.activity_log
  for each row execute function public.activity_log_append_only();

/* ---------- ④ adjustments — 조정 이력 append-only 공통 테이블 ----------
   정본 불변식: "승인된 사실은 덮어쓰지 않는다 — 정정·취소·철회는 새 이력"(07_rollout_plan M0-③).
   원 레코드를 고치는 대신 무엇을(target) 어떤 값에서(before) 어떤 값으로(after) 왜(reason)
   바꿨는지를 행으로 쌓는다. target_id는 도메인별 다형 참조라 의도적으로 FK 없음
   (consents.subject_id와 동일한 사유 — 원본이 삭제돼도 이력은 보존). */

create table public.adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  domain text not null,        -- money | grade | attendance | report 등 (채택 마일스톤에서 확정)
  target_type text not null,   -- payment | grade_record | lesson | ai_report 등
  target_id uuid not null,
  before_data jsonb,           -- 조정 전 값(신규 생성 조정이면 null)
  after_data jsonb not null,   -- 조정 후 값 — 새 사실
  reason text not null,        -- 사유 없는 조정은 없다
  actor_email text,
  created_at timestamptz not null default now()
);

create index idx_adjustments_tenant on public.adjustments (tenant_id, domain, created_at desc);
create index idx_adjustments_target on public.adjustments (tenant_id, target_type, target_id);

-- 조정 이력 자체도 승인된 사실 — 수정·삭제 전면 거부(정정하려면 새 조정 행을 쌓는다).
create or replace function public.append_only_reject()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '[audit] %는 append-only — % 금지. 정정·취소·철회는 새 이력을 쌓는다',
    tg_table_name, tg_op;
end $$;

create trigger trg_adjustments_append_only
  before update or delete on public.adjustments
  for each row execute function public.append_only_reject();

-- RLS: activity_log과 동일 계열 — 테넌트 격리 정책(00006 패턴)
alter table public.adjustments enable row level security;
create policy tenant_isolation on public.adjustments
  for all to authenticated
  using (tenant_id = public.jwt_tenant_id())
  with check (tenant_id = public.jwt_tenant_id());

/* ---------- ⑤ work_items — 오늘 업무 큐 (시나리오 50) ----------
   정본: "모든 오늘 업무에는 원본, 처리자, 다음 행동, 완료 또는 종결 상태가 있다."
   전 도메인의 예외(알림 소진·결과 불명·자동화 실패·감사 pending 장기 미처리 등)가
   여기로 수렴한다(07_rollout_plan M0-⑤). 열린 상태에는 담당자와 다음 행동이 있다. */

create table public.work_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null,           -- notify_exhausted | report_send_failed | schedule_unresolved 등 (lib/data/work.ts)
  title text not null,
  detail text,
  source_type text not null,    -- 원본 사건의 종류 (notify_queue | report | cron | automation_run 등)
  source_id text,               -- 원본 사건의 id (없으면 null — dedup에선 ''로 취급)
  priority text not null default 'normal'
    check (priority in ('risk', 'money', 'privacy', 'normal')),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'done', 'dismissed')),
  assignee_email text,
  next_action text not null,    -- 담당자가 해야 할 다음 행동 — 열린 업무의 필수 요소
  resolution text,              -- 완결 시 처리 내용
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- 한 사건 한 업무: 같은 원본의 열린 업무는 하나만 존재한다(중복 생성 금지).
-- 완결(done·dismissed) 후 같은 사건이 재발하면 새 업무는 다시 만들 수 있다(부분 인덱스).
create unique index work_items_open_dedup
  on public.work_items (tenant_id, kind, source_type, coalesce(source_id, ''))
  where status in ('open', 'in_progress');

create index idx_work_items_tenant on public.work_items (tenant_id, status, created_at desc);

create trigger trg_work_items_updated_at
  before update on public.work_items
  for each row execute function public.set_updated_at();

-- RLS: activity_log 계열 — 테넌트 격리 정책
alter table public.work_items enable row level security;
create policy tenant_isolation on public.work_items
  for all to authenticated
  using (tenant_id = public.jwt_tenant_id())
  with check (tenant_id = public.jwt_tenant_id());

/* ---------- ⑥ ai_reports — 업무 상태와 전달 상태의 분리 (N-02) ----------
   정본: "보고서 알림 실패 → 게시 상태 유지". 기존 코드는 발송 실패 시 status를 'failed'로
   뒤집어 승인된 리포트가 포털 목록(approved·sent만 노출)에서 사라졌다(01_atlas_04 N-02 갭).
   업무 상태(status: 초안→승인)와 전달 상태(delivery_status)를 분리한다. */

alter table public.ai_reports
  add column delivery_status text not null default 'none'
    check (delivery_status in ('none', 'queued', 'sent', 'failed'));

-- 백필: 발송 실패로 뒤집혔던 행을 "승인 유지 + 전달만 실패"로 복원(게시 상태 회복),
-- 발송 완료 행은 전달 완료로 표시. 승인된 사실(승인 이력)은 이 갱신으로 사라지지 않는다.
update public.ai_reports
   set status = 'approved', delivery_status = 'failed'
 where status = 'failed';

update public.ai_reports
   set delivery_status = 'sent'
 where status = 'sent';

-- 이제 'failed'는 업무 상태가 아니다 — CHECK 축소(전달 실패는 delivery_status가 담당).
alter table public.ai_reports drop constraint ai_reports_status_check;
alter table public.ai_reports add constraint ai_reports_status_check
  check (status in ('draft', 'approved', 'sent'));

/* ---------- ⑦ notifications — 리포트 역참조 + 발송 중 클레임 (N-02) ----------
   report_id: 알림 전달 결과를 ai_reports.delivery_status로 역전파하기 위한 연결.
   'sending': 발송 시도 직전에 클레임해 이중 발송을 막는다. sending 장기 체류(결과 불명)는
   성공이 아니다 — 코드(크론)가 work_items(kind='notify_unknown_result')로 수렴시킨다. */

alter table public.notifications
  add column report_id uuid references public.ai_reports (id) on delete set null;

create index idx_notifications_report
  on public.notifications (report_id)
  where report_id is not null;

alter table public.notifications drop constraint notifications_status_check;
alter table public.notifications add constraint notifications_status_check
  check (status in ('queued', 'sending', 'sent', 'failed'));

-- sending 클레임 시각 — 결과 불명(장기 체류) 판정 기준. created_at은 야간 대기·재큐잉으로
-- 수 시간 전일 수 있어 판정 기준으로 쓰면 정상 발송 중 행을 오탐한다(클레임 시 코드가 스탬프).
alter table public.notifications
  add column claimed_at timestamptz;

/* ---------- ⑧ 원자적 승계 RPC — admin_replace_operator (시나리오 67·68) ----------
   정본: "운영자 지위 이전·기존 운영자 접근 종료·기존 세션 회수를 하나의 전환으로 실행"(P-10),
   "일부 전환 실패 시 모두 취소 → 기존 운영자 유지". 한 트랜잭션 안에서 지위 이전 + 세션 회수 +
   OTP 폐기 + 감사 기록을 전부 수행한다 — 어느 하나(감사 insert 포함)라도 실패하면 예외로
   전체 롤백되어 fail-closed가 트랜잭션으로 자연 성립한다(시나리오 68).
   security definer: search_path 고정 + 본문 전부 스키마 한정 + 아래에서 EXECUTE 회수. */

create or replace function public.admin_replace_operator(
  p_tenant_id uuid,
  p_from_email text,
  p_to_email text,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from text := lower(trim(p_from_email));
  v_to text := lower(trim(p_to_email));
  v_from_status text;
begin
  if p_tenant_id is null or coalesce(v_from, '') = '' or coalesce(v_to, '') = '' then
    raise exception '[admin_replace_operator] tenant_id·from·to 이메일은 필수입니다';
  end if;
  if v_from = v_to then
    raise exception '[admin_replace_operator] from과 to가 같은 이메일(%)입니다', v_to;
  end if;
  -- 사유 없는 권한 전환은 없다(P-11: 행위자·대상·이전·이후·사유 연결)
  if coalesce(trim(p_reason), '') = '' then
    raise exception '[admin_replace_operator] 사유(p_reason) 없이 승계를 실행할 수 없습니다';
  end if;

  -- from 행 잠금 — 동시 승계 요청이 서로의 중간 상태를 밟지 못하게 직렬화
  select status into v_from_status
    from public.admin_accounts
   where tenant_id = p_tenant_id and email = v_from
   for update;

  if v_from_status is null then
    raise exception '[admin_replace_operator] 현 운영자(%)가 admin_accounts에 없습니다', v_from;
  end if;
  if v_from_status <> 'active' then
    raise exception '[admin_replace_operator] 현 운영자(%)가 active가 아닙니다(현재 %) — 이미 승계됐는지 확인하세요',
      v_from, v_from_status;
  end if;

  -- 지위 이전: from 종료 → to 활성. inactive를 먼저 확정해야
  -- admin_accounts_one_active_per_tenant(즉시 검사)와 충돌하지 않는다.
  -- 만에 하나 다른 경로로 2인 활성이 되려 하면 부분 유니크가 예외로 차단 → 전체 롤백(반쪽 전환 없음).
  update public.admin_accounts
     set status = 'inactive'
   where tenant_id = p_tenant_id and email = v_from;

  insert into public.admin_accounts (tenant_id, email, status)
  values (p_tenant_id, v_to, 'active')
  on conflict (tenant_id, email) do update set status = 'active';

  -- 기존 운영자 접근 종료: 활성 세션 전부 회수 + 미사용 OTP 폐기
  update public.admin_sessions
     set revoked_at = now(),
         revoked_reason = 'admin_replace_operator: ' || trim(p_reason)
   where tenant_id = p_tenant_id and email = v_from and revoked_at is null;

  delete from public.admin_otps
   where tenant_id = p_tenant_id and email = v_from;

  -- 감사 기록 — 이 insert가 실패하면 위 전환 전부가 롤백된다(fail-closed).
  -- admin_accounts에는 uuid 대상이 없어 target_id는 null, 대상은 before/after에 담는다.
  insert into public.activity_log
    (tenant_id, actor_email, action, target_type, target_id, summary,
     category, phase, before_data, after_data, reason)
  values
    (p_tenant_id, v_from, 'admin_replace_operator', 'admin_account', null,
     format('운영자 승계: %s → %s', v_from, v_to),
     'permission', 'committed',
     jsonb_build_object('active_email', v_from),
     jsonb_build_object('active_email', v_to),
     trim(p_reason));
end $$;

/* ---------- ⑨ automation_schedule_autoclean 개정 — 오늘 업무로 수렴 (시나리오 50) ----------
   00012 정의를 유지(SMS 큐잉·연락처 미설정 시 스킵)하되, 알림(전달)과 무관하게 work_items에
   업무를 남긴다 — 연락처가 없어 알림이 못 나가도 업무는 사라지지 않는다(N-02 분리 원칙,
   00012에서 notice로만 남아 은폐되던 케이스의 수렴 경로). */

create or replace function public.automation_schedule_autoclean()
returns void
language plpgsql
set search_path = public
as $$
declare
  r record;
  v_today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  v_run_date text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD');
begin
  for r in (
    select s.tenant_id,
           count(*) as unresolved_count,
           (ss.value ->> 'phone') as tutor_phone
      from public.schedules s
      left join public.site_settings ss
        on ss.tenant_id = s.tenant_id and ss.key = 'site_info'
     where s.status = 'planned'
       and s.scheduled_at < v_today_start
     group by s.tenant_id, ss.value ->> 'phone'
  ) loop
    -- 오늘 업무 적재 — 실행일자를 원본 id로 삼아 하루 한 건. 같은 날 이미 열린 업무가 있으면
    -- 새로 만들지 않는다(한 사건 한 업무 — work_items_open_dedup과 on conflict do nothing).
    insert into public.work_items
      (tenant_id, kind, title, detail, source_type, source_id, priority, next_action)
    values
      (r.tenant_id, 'schedule_unresolved',
       format('어제 이전 미처리 일정 %s건', r.unresolved_count),
       '상태가 planned로 남은 지난 일정입니다. 완료·취소·보강으로 정리해 주세요.',
       'cron', v_run_date, 'normal', '미처리 일정 정리')
    on conflict (tenant_id, kind, source_type, coalesce(source_id, ''))
      where status in ('open', 'in_progress')
    do nothing;

    -- 이하 00012와 동일: 연락처가 있으면 내부 SMS 큐잉(일정 상태는 건드리지 않음)
    if r.tutor_phone is null or length(trim(r.tutor_phone)) = 0 then
      raise notice '[automation] tenant % 연락처(site_settings.site_info.phone) 미설정 — schedule_autoclean 알림 스킵(오늘 업무에는 적재됨): 미처리 %건',
        r.tenant_id, r.unresolved_count;
      continue;
    end if;

    insert into public.notifications (tenant_id, student_id, type, channel, phone, message, is_ad, status)
    values (
      r.tenant_id, null, 'schedule_unresolved', 'sms', r.tutor_phone,
      format('[TUTOR OS] 어제 이전 미처리 일정이 %s건 있습니다. 관리자 페이지에서 확인해 주세요.', r.unresolved_count),
      false, 'queued'
    );
  end loop;
end;
$$;

/* ---------- EXECUTE 회수 (00012 §4와 동일 취지) ----------
   create (or replace)된 함수는 proacl이 초기화돼 PUBLIC 의사롤 EXECUTE가 되살아난다.
   admin_replace_operator는 security definer라 노출 시 즉시 권한 탈취 경로가 된다 — 필수 회수.
   트리거 함수 2종은 직접 호출이 불가능하지만(returns trigger) 같은 수칙으로 회수해 둔다. */
revoke execute on function public.admin_replace_operator(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.automation_schedule_autoclean() from public, anon, authenticated;
revoke execute on function public.activity_log_append_only() from public, anon, authenticated;
revoke execute on function public.append_only_reject() from public, anon, authenticated;
