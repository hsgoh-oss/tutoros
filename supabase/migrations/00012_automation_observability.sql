-- 00012: 자동화 무동작을 크론 상태로 드러나게 + 함수 search_path 고정
--
-- 배경(운영 실측): 크론 12잡이 전부 `succeeded`인데 net._http_response·net.http_request_queue가
-- 0건이었다. 원인은 vault.secrets가 비어 있어 automation_call_edge_function/_flush가
-- `raise notice` 후 조용히 return한 것. 순수 SQL 잡 3종(payment_overdue_flag·
-- content_backup_daily·schedule_autoclean)만 실제로 동작했고, 엣지 함수 경유 8종 +
-- notify_queue_flush는 12일간 한 번도 발사되지 않았다.
--
-- notice는 cron.job_run_details.status에 남지 않는다 → 실패가 성공으로 보고되어
-- 운영 중 발견이 불가능했다. 설정 부재를 exception으로 승격해 status='failed'로 남긴다.
-- 부팅 순서상 "아직 설정 전"이 정상인 구간은 없다: 시크릿은 크론 등록보다 먼저 채워져야 한다.

/* ---------- 1) 발사 기록 — request_id로 사후 대조 ---------- */

-- net.http_post는 비동기라 반환된 request_id만이 "실제로 쐈다"는 증거다.
-- net._http_response는 TTL(기본 6시간)로 정리되므로 자체 로그를 남긴다.
create table if not exists public.automation_runs (
  id bigint generated always as identity primary key,
  job_name text not null,
  request_id bigint,
  created_at timestamptz not null default now()
);

create index if not exists automation_runs_created_at_idx
  on public.automation_runs (created_at desc);

-- 테넌트 스코프가 없는 플랫폼 운영 로그 — 정책 없이 RLS만 켜서 anon·authenticated 전면 차단.
-- (admin_otps·admin_accounts와 동일한 패턴: service_role·크론만 접근)
alter table public.automation_runs enable row level security;

/* ---------- 2) 엣지 함수 호출 헬퍼 — 설정 부재 시 실패로 남긴다 ---------- */

create or replace function public.automation_call_edge_function(job_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_url text;
  v_service_key text;
  v_request_id bigint;
  -- 파라미터명이 automation_runs.job_name 컬럼과 같아 INSERT에서 헷갈리기 쉽다. 지역 변수로 옮겨 둔다.
  v_job constant text := job_name;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception '[automation] pg_net 미설치 — % 발사 불가. scripts/setup-supabase.sh 1단계 또는 대시보드에서 활성화하세요.', job_name;
  end if;

  select decrypted_secret into v_base_url
    from vault.decrypted_secrets where name = 'automation_base_url' limit 1;
  select decrypted_secret into v_service_key
    from vault.decrypted_secrets where name = 'automation_service_role_key' limit 1;

  if v_base_url is null or v_service_key is null then
    raise exception '[automation] Vault 시크릿(automation_base_url/automation_service_role_key) 미설정 — % 발사 불가. docs/cron-definitions.md 배포 전 준비 참조', job_name;
  end if;

  select net.http_post(
    url := v_base_url || '/functions/v1/automation?job=' || v_job,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := '{}'::jsonb
  ) into v_request_id;

  insert into public.automation_runs (job_name, request_id)
  values (v_job, v_request_id);
end;
$$;

create or replace function public.automation_call_flush()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app_url text;
  v_secret text;
  v_request_id bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception '[automation] pg_net 미설치 — notify_queue_flush 발사 불가.';
  end if;

  select decrypted_secret into v_app_url
    from vault.decrypted_secrets where name = 'app_base_url' limit 1;
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret' limit 1;

  if v_app_url is null or v_secret is null then
    raise exception '[automation] Vault 시크릿(app_base_url/cron_secret) 미설정 — notify_queue_flush 발사 불가. docs/cron-definitions.md 배포 전 준비 참조';
  end if;

  select net.http_post(
    url := v_app_url || '/api/cron/flush',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb
  ) into v_request_id;

  insert into public.automation_runs (job_name, request_id)
  values ('notify_queue_flush', v_request_id);
end;
$$;

-- ---------- 3) search_path 고정 (Supabase 어드바이저 function_search_path_mutable) ----------
-- search_path가 role 설정에 좌우되면 호출자가 동명 객체를 앞선 스키마에 심어 함수 동작을
-- 바꿀 수 있다. 본문은 이미 전부 스키마 한정(public. / auth. 접두)이라 동작 변화 없이 고정만 한다.
-- 위 두 함수는 이미 `set search_path = public`을 갖고 있다. 나머지 5개를 덮는다.

create or replace function public.set_updated_at()
returns trigger language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function public.jwt_tenant_id()
returns uuid language sql stable
set search_path = public
as $$
  select case
    when coalesce(auth.jwt() ->> 'tenant_id', '')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (auth.jwt() ->> 'tenant_id')::uuid
  end
$$;

-- job 3: due_date < 오늘(KST) 인 pending → overdue
create or replace function public.automation_payment_overdue_flag()
returns void
language sql
set search_path = public
as $$
  update public.payments
     set status = 'overdue'
   where status = 'pending'
     and due_date < (now() at time zone 'Asia/Seoul')::date;
$$;

-- job 7: tenant별 site_settings 스냅샷 적재 + target별 최신 12개 순환
create or replace function public.automation_content_backup_daily()
returns void
language plpgsql
set search_path = public
as $$
declare
  r record;
begin
  for r in (
    select tenant_id, jsonb_object_agg(key, value) as snapshot
      from public.site_settings
     group by tenant_id
  ) loop
    insert into public.backups (tenant_id, target, snapshot)
    values (r.tenant_id, 'settings:daily', r.snapshot);
  end loop;

  delete from public.backups b
   where b.target = 'settings:daily'
     and b.id in (
       select id from (
         select id, row_number() over (
           partition by tenant_id order by created_at desc
         ) as rn
         from public.backups
         where target = 'settings:daily'
       ) ranked
       where ranked.rn > 12
     );
end;
$$;

-- job 8: 어제 이전 planned 일정 건수를 선생님 내부 알림으로 큐잉(상태는 건드리지 않음)
create or replace function public.automation_schedule_autoclean()
returns void
language plpgsql
set search_path = public
as $$
declare
  r record;
  v_today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
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
    if r.tutor_phone is null or length(trim(r.tutor_phone)) = 0 then
      raise notice '[automation] tenant % 연락처(site_settings.site_info.phone) 미설정 — schedule_autoclean 알림 스킵(관리자 페이지 수동 확인 권장): 미처리 %건',
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

/* ---------- 4) create or replace로 되살아난 기본 EXECUTE 재회수 (00011과 동일 취지) ----------
   함수를 재정의하면 proacl이 초기화돼 default privileges가 다시 적용된다.
   00011이 alter default privileges로 anon·authenticated를 끊어 뒀지만, PUBLIC 의사롤은
   여전히 붙으므로 00002와 같은 회수를 다시 건다. */
revoke execute on function public.automation_call_edge_function(text) from public, anon, authenticated;
revoke execute on function public.automation_call_flush() from public, anon, authenticated;
revoke execute on function public.automation_payment_overdue_flag() from public, anon, authenticated;
revoke execute on function public.automation_content_backup_daily() from public, anon, authenticated;
revoke execute on function public.automation_schedule_autoclean() from public, anon, authenticated;
