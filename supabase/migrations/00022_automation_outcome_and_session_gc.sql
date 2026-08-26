-- 00022: 크론 성패를 남긴다 · 만료 세션을 정리한다
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ① 크론 성패 기록 (관측 공백)
--
-- 지금 automation_runs에는 job_name과 request_id만 남는다. 실제 결과(HTTP 상태·본문)는
-- pg_net이 net._http_response에 잠깐 담아 두고 TTL(기본 6시간)이 지나면 지운다.
-- 그래서 "어젯밤 크론이 성공했나"를 확인할 방법이 없다 — 일 1회 크론 8개가 전부 여기 해당한다.
--
-- 이게 실제로 사고를 숨긴 적이 있다: 앱이 DB보다 먼저 배포돼 알림 크론이 매시간 500을 뱉는데도
-- cron.job_run_details는 'succeeded'였다. pg_cron은 HTTP를 쏜 것까지만 성공으로 보기 때문이다.
--
-- 고치는 방법: 응답이 지워지기 전에 automation_runs로 옮겨 적고, 실패는 업무로 승격한다.
--   · 컬럼 추가 — status_code·response·settled_at
--   · automation_settle_runs()가 아직 안 옮긴 행을 net._http_response에서 채운다
--   · 200이 아니면 work_items(kind='automation_failed')로 올린다 — 운영자가 화면에서 본다
--   · 10분마다 돌린다(TTL 6시간보다 훨씬 촘촘해 유실이 없다)
--
-- 응답 본문은 2KB까지만 남긴다. 진단에는 앞부분이면 충분하고, 잡이 큰 JSON을 돌려줄 때
-- 테이블이 불필요하게 커지는 것을 막는다.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ② 만료 세션 정리
--
-- portal_sessions는 초대 링크를 누를 때마다 새로 쌓인다(설계상 의도 — 매번 새 세션 발급).
-- 그런데 지우는 쪽이 없어 무한히 증식한다. admin_sessions·admin_otps도 같다.
--
-- 만료된 뒤에도 90일은 남긴다 — "누가 언제 들어왔나"는 사고 조사에 필요한 기록이고,
-- 회수 사유(revoked_reason)도 여기 있다. 90일이 지나면 조사 가치가 없으므로 지운다.
-- OTP는 10분짜리라 하루만 지나면 아무 의미가 없다.

/* ---------- ① 크론 성패 기록 ---------- */

alter table public.automation_runs
  add column if not exists status_code int,
  add column if not exists response text,
  add column if not exists settled_at timestamptz;

-- 아직 결과를 못 옮긴 행만 빠르게 찾기 위한 부분 인덱스.
create index if not exists automation_runs_unsettled
  on public.automation_runs (created_at)
  where settled_at is null;

create index if not exists automation_runs_job_time
  on public.automation_runs (job_name, created_at desc);

create or replace function public.automation_settle_runs()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid;
  r record;
begin
  -- 응답을 automation_runs로 옮겨 적는다. 아직 응답이 없는 건(막 쏜 것)은 다음 회차에 잡힌다.
  update public.automation_runs a
     set status_code = h.status_code,
         response    = left(coalesce(h.content, h.error_msg, ''), 2048),
         settled_at  = now()
    from net._http_response h
   where h.id = a.request_id
     and a.settled_at is null;

  -- 응답이 끝내 안 온 건(pg_net이 TTL로 지워 버린 뒤): 영원히 unsettled로 남지 않게 닫는다.
  -- 상태를 0으로 두어 "성공도 실패도 확인 못 함"을 구분한다 — 200으로 오해하지 않게.
  update public.automation_runs
     set status_code = 0,
         response    = '응답을 확인하지 못했습니다(pg_net 보관 기간 경과).',
         settled_at  = now()
   where settled_at is null
     and created_at < now() - interval '12 hours';

  -- 실패를 업무로 승격 — 화면에 뜨지 않는 실패는 없는 것과 같다.
  -- 잡 이름 + 실행일자를 원본 키로 삼아 같은 잡의 같은 날 실패는 한 건으로 모은다.
  for r in
    select a.job_name,
           (a.created_at at time zone 'Asia/Seoul')::date as run_date,
           count(*) as fail_count,
           max(a.status_code) as sample_code,
           (array_agg(left(a.response, 200) order by a.created_at desc))[1] as sample_body
      from public.automation_runs a
     where a.settled_at > now() - interval '30 minutes'
       and a.status_code is distinct from 200
     group by 1, 2
  loop
    -- 자동화는 테넌트 단위가 아니라 전역으로 도는 잡이 섞여 있어, 업무는 기본 테넌트에 남긴다.
    select id into v_tenant from public.tenants order by created_at limit 1;
    if v_tenant is null then
      continue;
    end if;

    insert into public.work_items
      (tenant_id, kind, title, detail, source_type, source_id, priority, next_action)
    values
      (v_tenant, 'automation_failed',
       format('자동화 실패 — %s (%s건)', r.job_name, r.fail_count),
       format('응답 코드 %s. %s', coalesce(r.sample_code::text, '없음'), coalesce(r.sample_body, '')),
       'cron', r.job_name || ':' || r.run_date::text,
       case when r.job_name in ('notify_queue_flush', 'notify_retry') then 'high' else 'normal' end,
       '크론 정의서의 확인 절차로 원인을 좁힌 뒤 수동 실행하거나 코드를 고쳐 주세요')
    on conflict (tenant_id, kind, source_type, coalesce(source_id, ''))
      where status in ('open', 'in_progress')
    do nothing;
  end loop;
end;
$$;

revoke execute on function public.automation_settle_runs() from public, anon, authenticated;
grant execute on function public.automation_settle_runs() to service_role;

/* ---------- ② 만료 세션·OTP 정리 ---------- */

create or replace function public.automation_session_gc()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_portal int;
  v_admin int;
  v_otp int;
  v_runs int;
begin
  -- 만료 후 90일까지는 남긴다(사고 조사·회수 사유 확인). 그 뒤로는 보관 가치가 없다.
  delete from public.portal_sessions where expires_at < now() - interval '90 days';
  get diagnostics v_portal = row_count;

  delete from public.admin_sessions where expires_at < now() - interval '90 days';
  get diagnostics v_admin = row_count;

  -- OTP는 10분짜리다 — 하루 지난 것은 어떤 판단에도 쓰이지 않는다.
  delete from public.admin_otps where expires_at < now() - interval '1 day';
  get diagnostics v_otp = row_count;

  -- 자동화 실행 기록도 1년이면 충분하다(월별 추이 확인 용도).
  delete from public.automation_runs where created_at < now() - interval '365 days';
  get diagnostics v_runs = row_count;

  raise notice '[gc] portal_sessions=% admin_sessions=% admin_otps=% automation_runs=%',
    v_portal, v_admin, v_otp, v_runs;
end;
$$;

revoke execute on function public.automation_session_gc() from public, anon, authenticated;
grant execute on function public.automation_session_gc() to service_role;

/* ---------- 크론 등록 ---------- */

-- 10분마다: 응답이 지워지기 전에 결과를 옮겨 적는다.
select cron.schedule('automation_settle', '*/10 * * * *',
                     'select public.automation_settle_runs();');

-- 매일 03:20 UTC(12:20 KST): 만료 세션·OTP 정리.
select cron.schedule('session_gc', '20 3 * * *',
                     'select public.automation_session_gc();');

-- 지금까지 쌓인 것도 한 번 정리해 둔다(이 마이그레이션 이전 행은 전부 unsettled다).
select public.automation_settle_runs();
select public.automation_session_gc();
