-- TUTOR OS Phase 1 — 자동화 8종 (기획서 원문 미보유, "계약 확정 전 초안" — §14 검수 시 대조 필요)
-- 원칙: Make·구글시트 등 중간 도구 금지 — pg_cron + Edge Functions만.
-- 시간은 전부 KST(Asia/Seoul) 기준으로 설계하고 주석에 UTC를 병기한다(Supabase pg_cron 기본 tz=UTC).
-- 구조 결정·시각 조작 테스트 절차는 docs/cron-definitions.md 참조.
--
-- 방어적 설계: pg_cron/pg_net 확장은 scripts/setup-supabase.sh 1단계가 미리 활성화하지만,
-- (a) 대시보드에서 수동 활성화가 실패했거나 (b) 이 파일만 별도로 재적용하는 경우에도
-- ON_ERROR_STOP 마이그레이션 전체가 깨지지 않도록, 확장이 없으면 등록을 건너뛰고
-- NOTICE만 남긴다(cron.schedule/net.http_post 호출이 최상위 문이면 확장 부재 시 즉시 에러난다).

/* ---------- 1) 엣지 함수 호출 헬퍼 (job 1·2·4·6 — DB 조인/멱등 체크가 필요한 4종) ---------- */

-- Vault 시크릿(automation_base_url, automation_service_role_key)이 배포 후 채워지기 전에는
-- NOTICE만 남기고 스킵한다 — 배포 전 초기 상태에서도 마이그레이션 자체는 안전하게 적용된다.
create or replace function public.automation_call_edge_function(job_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_url text;
  v_service_key text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice '[automation] pg_net 미설치 — % 스킵', job_name;
    return;
  end if;

  select decrypted_secret into v_base_url
    from vault.decrypted_secrets where name = 'automation_base_url' limit 1;
  select decrypted_secret into v_service_key
    from vault.decrypted_secrets where name = 'automation_service_role_key' limit 1;

  if v_base_url is null or v_service_key is null then
    raise notice '[automation] Vault 시크릿(automation_base_url/automation_service_role_key) 미설정 — % 스킵. docs/cron-definitions.md 배포 전 준비 참조', job_name;
    return;
  end if;

  perform net.http_post(
    url := v_base_url || '/functions/v1/automation?job=' || job_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := '{}'::jsonb
  );
end;
$$;

-- job 5(notify_queue_flush) 전용 — Next API(/api/cron/flush)를 CRON_SECRET으로 직접 호출한다.
-- (엣지 함수를 경유하지 않는다 — 실 Solapi 발송 로직은 lib/notify/send.ts에만 있어 Next에서만 재사용 가능)
create or replace function public.automation_call_flush()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app_url text;
  v_secret text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice '[automation] pg_net 미설치 — notify_queue_flush 스킵';
    return;
  end if;

  select decrypted_secret into v_app_url
    from vault.decrypted_secrets where name = 'app_base_url' limit 1;
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret' limit 1;

  if v_app_url is null or v_secret is null then
    raise notice '[automation] Vault 시크릿(app_base_url/cron_secret) 미설정 — notify_queue_flush 스킵. docs/cron-definitions.md 배포 전 준비 참조';
    return;
  end if;

  perform net.http_post(
    url := v_app_url || '/api/cron/flush',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb
  );
end;
$$;

/* ---------- 2) 순수 SQL 잡 (job 3·7·8 — DB 내부 연산만으로 충분) ---------- */

-- job 3: payment_overdue_flag — due_date < 오늘(KST) 인 pending → overdue 전환.
create or replace function public.automation_payment_overdue_flag()
returns void
language sql
as $$
  update public.payments
     set status = 'overdue'
   where status = 'pending'
     and due_date < (now() at time zone 'Asia/Seoul')::date;
$$;

-- job 7: content_backup_daily — tenant별 site_settings 전 키를 하나의 스냅샷으로 묶어
-- backups(target='settings:daily')에 적재하고, target별 최신 12개만 남기고 정리한다.
create or replace function public.automation_content_backup_daily()
returns void
language plpgsql
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

-- job 8: schedule_autoclean — 어제(KST) 이전 planned 일정은 상태를 그대로 두고
-- (자동 취소·삭제하지 않음), tenant별 미처리 건수를 집계해 선생님 내부 알림으로 큐잉한다.
-- 정직한 한계: notifications.phone은 NOT NULL이라 연락처가 없으면 채널을 만들어낼 수 없다.
-- site_settings(key='site_info').value->>'phone'이 비어 있는 테넌트는 자동 알림을 스킵하고
-- NOTICE만 남긴다 — 이 경우 관리자 대시보드에서 수동 확인을 권장한다(docs/cron-definitions.md 명시).
create or replace function public.automation_schedule_autoclean()
returns void
language plpgsql
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

/* ---------- 3) pg_cron 등록 (자동화 8종) ----------
   시간 = KST 기준, 괄호는 UTC (pg_cron 기본 tz=UTC). pg_cron 미설치 시 전체를 건너뛴다. */

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '[automation] pg_cron 미설치 — 크론 잡 등록을 생략합니다. scripts/setup-supabase.sh 1단계 또는 대시보드에서 pg_cron 활성화 후 이 파일을 재적용하세요.';
    return;
  end if;

  -- job 1: lesson_reminder — 매일 18:00 KST (09:00 UTC)
  perform cron.schedule(
    'lesson_reminder', '0 9 * * *',
    $c$select public.automation_call_edge_function('lesson_reminder');$c$
  );

  -- job 2: payment_d3 — 매일 10:00 KST (01:00 UTC)
  perform cron.schedule(
    'payment_d3', '0 1 * * *',
    $c$select public.automation_call_edge_function('payment_d3');$c$
  );

  -- job 3: payment_overdue_flag — 매일 00:30 KST (전일 15:30 UTC)
  perform cron.schedule(
    'payment_overdue_flag', '30 15 * * *',
    $c$select public.automation_payment_overdue_flag();$c$
  );

  -- job 4: payment_overdue_notice — 매일 10:30 KST (01:30 UTC)
  perform cron.schedule(
    'payment_overdue_notice', '30 1 * * *',
    $c$select public.automation_call_edge_function('payment_overdue_notice');$c$
  );

  -- job 5: notify_queue_flush — 매시 10분 (시간대 무관 — 매시 반복이라 KST=UTC 표기 동일)
  perform cron.schedule(
    'notify_queue_flush', '10 * * * *',
    $c$select public.automation_call_flush();$c$
  );

  -- job 6: weekly_report_draft — 매주 월요일 09:00 KST (월요일 00:00 UTC)
  perform cron.schedule(
    'weekly_report_draft', '0 0 * * 1',
    $c$select public.automation_call_edge_function('weekly_report_draft');$c$
  );

  -- job 7: content_backup_daily — 매일 03:00 KST (전일 18:00 UTC)
  perform cron.schedule(
    'content_backup_daily', '0 18 * * *',
    $c$select public.automation_content_backup_daily();$c$
  );

  -- job 8: schedule_autoclean — 매일 04:00 KST (전일 19:00 UTC)
  perform cron.schedule(
    'schedule_autoclean', '0 19 * * *',
    $c$select public.automation_schedule_autoclean();$c$
  );
end
$$;

/* ---------- 4) 자동화 함수 실행 권한 회수 (심층방어) ----------
   PostgREST는 public 스키마의 함수를 RPC(POST /rest/v1/rpc/<name>)로 노출하고,
   Postgres 기본값은 EXECUTE TO PUBLIC이다. 회수하지 않으면 anon/authenticated가
   automation_call_flush()나 automation_call_edge_function('weekly_report_draft')를 직접 호출해
   오프스케줄 대량 발송·AI 토큰 비용 유발이 가능하다.
   특히 앞의 두 함수는 security definer로 Vault 시크릿(service_role 키·CRON_SECRET)을 읽는다.

   이 함수들은 pg_cron(소유자 권한으로 실행)만 호출하면 되므로 PUBLIC에서 전부 회수한다.
   소유자는 회수 대상이 아니라 크론 잡은 정상 동작한다. */
revoke execute on function public.automation_call_edge_function(text) from public;
revoke execute on function public.automation_call_flush() from public;
revoke execute on function public.automation_payment_overdue_flag() from public;
revoke execute on function public.automation_content_backup_daily() from public;
revoke execute on function public.automation_schedule_autoclean() from public;
