-- 계약 제14장 인수 항목: "테스트 테넌트 2~3개 시딩, 교차 접근 0건 + RLS 정책 문서"
-- 이 파일은 그 "0건"을 실제로 증명한다. 통과 조건: 마지막 요약의 FAIL = 0.

\set QUIET on
\pset pager off
\set T1 '00000000-0000-0000-0000-000000000001'
\set T2 '00000000-0000-0000-0000-000000000002'

create temp table rls_result (
  seq int generated always as identity,
  scenario text,
  detail text,
  expected text,
  actual text,
  verdict text
);

/* ───────── 0. baseline: RLS를 우회하는 owner 시점의 실제 행 수 ─────────
   교차 노출 0건이 "데이터가 원래 없어서"가 아니라 "RLS가 막아서"임을 증명하려면
   막지 않았을 때 보이는 행이 실제로 존재해야 한다. */
insert into rls_result (scenario, detail, expected, actual, verdict)
select 'baseline', 'faqs 전체(owner 시점)', '>= 12',
       count(*)::text,
       case when count(*) >= 12 then 'PASS' else 'FAIL' end
from public.faqs;

insert into rls_result (scenario, detail, expected, actual, verdict)
select 'baseline', '타테넌트(T2·T3) faqs 존재', '= 2',
       count(*)::text,
       case when count(*) = 2 then 'PASS' else 'FAIL' end
from public.faqs where tenant_id <> :'T1';

insert into rls_result (scenario, detail, expected, actual, verdict)
select 'baseline', '타테넌트(T2·T3) students 존재', '= 2',
       count(*)::text,
       case when count(*) = 2 then 'PASS' else 'FAIL' end
from public.students where tenant_id <> :'T1';

/* ───────── 1. 전 계정별 테이블 교차 노출 스캔 (authenticated / T1 클레임) ─────────
   각 테이블마다 먼저 owner 시점(RLS 우회)으로 타테넌트 행이 실제 존재하는지 세고,
   존재할 때에만 authenticated 시점의 0건을 PASS로 인정한다.
   타테넌트 행이 애초에 없으면 0건은 아무것도 증명하지 못하므로 INCONCLUSIVE로 남긴다. */
do $$
declare
  t text;
  seeded_n bigint;   -- owner 시점: 타테넌트 행이 실제로 몇 건 있는가
  visible_n bigint;  -- authenticated(T1) 시점: 그중 몇 건이 보이는가
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  -- 00001의 18개 + 테넌트 정책 계열 12개(activity_log(00006)·adjustments·work_items(00013)
  -- ·payssam_events(00014)·homework_assignments·homework_submissions·homework_questions(00015)
  -- ·lesson_packages·session_ledger·attendance_contacts·attendance_corrections
  -- ·booking_restrictions(00020)
  -- ·trial_sessions·trial_results·enrollments·contracts·waitlist_offers(00018))
  tables constant text[] := array[
    'site_settings','theme_settings','ddays','recruit_status','page_contents',
    'students','reviews','faqs','lessons','ai_reports','schedules','grade_records',
    'lesson_materials','payments','consultations','consents','notifications','backups',
    'activity_log','adjustments','work_items','payssam_events',
    'homework_assignments','homework_submissions','homework_questions',
    'trial_sessions','trial_results','enrollments','contracts','waitlist_offers',
    'lesson_packages','session_ledger','attendance_contacts','attendance_corrections',
    'booking_restrictions'
  ];
begin
  foreach t in array tables loop
    -- owner(테이블 소유자)는 RLS를 우회하므로 이 값이 "막지 않았다면 보였을 행 수"다.
    execute format('select count(*) from public.%I where tenant_id <> %L', t, t1) into seeded_n;

    perform set_config('request.jwt.claims', json_build_object('tenant_id', t1)::text, true);
    execute 'set local role authenticated';
    execute format('select count(*) from public.%I where tenant_id <> %L', t, t1) into visible_n;
    execute 'reset role';

    insert into rls_result (scenario, detail, expected, actual, verdict)
    values ('교차노출 스캔',
            format('%s (타테넌트 실행 %s건)', t, seeded_n),
            '0 노출',
            visible_n::text || '건 노출',
            case
              when seeded_n = 0 then 'INCONCLUSIVE'
              when visible_n = 0 then 'PASS'
              else 'FAIL'
            end);
  end loop;
end $$;

/* ───────── 2. 자기 테넌트 데이터는 정상적으로 보여야 한다 (과잉 차단 아님) ───────── */
do $$
declare n bigint;
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  perform set_config('request.jwt.claims', json_build_object('tenant_id', t1)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.faqs;
  execute 'reset role';
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('자기 테넌트 조회', 'T1이 자기 faqs 조회', '10', n::text,
          case when n = 10 then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 3. T2 클레임은 T2 데이터만 ───────── */
do $$
declare own_n bigint; foreign_n bigint;
  t2 constant uuid := '00000000-0000-0000-0000-000000000002';
begin
  perform set_config('request.jwt.claims', json_build_object('tenant_id', t2)::text, true);
  execute 'set local role authenticated';
  select count(*) filter (where tenant_id = t2), count(*) filter (where tenant_id <> t2)
    into own_n, foreign_n from public.faqs;
  execute 'reset role';
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('테넌트 전환', 'T2가 자기 faqs 조회', '1', own_n::text,
          case when own_n = 1 then 'PASS' else 'FAIL' end);
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('테넌트 전환', 'T2가 타테넌트 faqs 조회', '0', foreign_n::text,
          case when foreign_n = 0 then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 4. 쓰기 차단: T1이 T2 소유 데이터를 만들거나 바꿀 수 없어야 한다 ───────── */
-- 4a. 타테넌트 tenant_id로 INSERT → WITH CHECK 위반으로 예외
do $$
declare
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  t2 constant uuid := '00000000-0000-0000-0000-000000000002';
  blocked boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('tenant_id', t1)::text, true);
  execute 'set local role authenticated';
  begin
    execute format(
      'insert into public.faqs (tenant_id, category, question, answer, sort_order)
       values (%L, ''침투'', ''침투 질문'', ''침투 답변'', 99)', t2);
  exception when insufficient_privilege or check_violation then
    blocked := true;
  end;
  execute 'reset role';
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('쓰기 차단', 'T1 → T2 tenant_id로 INSERT', '차단(예외)',
          case when blocked then '차단됨' else '삽입 성공(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);
end $$;

-- 4b. 타테넌트 행 UPDATE → 대상 행이 안 보이므로 0 rows
do $$
declare
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  t2 constant uuid := '00000000-0000-0000-0000-000000000002';
  affected bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('tenant_id', t1)::text, true);
  execute 'set local role authenticated';
  execute format('update public.faqs set answer = ''변조됨'' where tenant_id = %L', t2);
  get diagnostics affected = row_count;
  execute 'reset role';
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('쓰기 차단', 'T1 → T2 행 UPDATE', '0 rows', affected::text || ' rows',
          case when affected = 0 then 'PASS' else 'FAIL' end);
end $$;

-- 4c. 타테넌트 행 DELETE → 0 rows
do $$
declare
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  t2 constant uuid := '00000000-0000-0000-0000-000000000002';
  affected bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('tenant_id', t1)::text, true);
  execute 'set local role authenticated';
  execute format('delete from public.students where tenant_id = %L', t2);
  get diagnostics affected = row_count;
  execute 'reset role';
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('쓰기 차단', 'T1 → T2 행 DELETE', '0 rows', affected::text || ' rows',
          case when affected = 0 then 'PASS' else 'FAIL' end);
end $$;

-- 4d. UPDATE로 자기 행을 타테넌트로 넘기기(tenant_id 탈취) → WITH CHECK 위반
do $$
declare
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  t2 constant uuid := '00000000-0000-0000-0000-000000000002';
  blocked boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('tenant_id', t1)::text, true);
  execute 'set local role authenticated';
  begin
    execute format('update public.faqs set tenant_id = %L where tenant_id = %L', t2, t1);
  exception when insufficient_privilege or check_violation then
    blocked := true;
  end;
  execute 'reset role';
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('쓰기 차단', 'T1 행의 tenant_id를 T2로 변경(탈취)', '차단(예외)',
          case when blocked then '차단됨' else '변경 성공(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 5. fail-closed: 클레임 누락/오염 시 전면 차단이어야 한다 ───────── */
do $$
declare n bigint;
begin
  -- 5a. 클레임 자체가 없음
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role authenticated';
  select count(*) into n from public.faqs;
  execute 'reset role';
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('fail-closed', 'JWT 클레임 없음', '0', n::text,
          case when n = 0 then 'PASS' else 'FAIL' end);
end $$;

do $$
declare n bigint;
begin
  -- 5b. tenant_id가 UUID가 아닌 쓰레기 값 → jwt_tenant_id()가 NULL (cast 에러로 죽지 않아야)
  perform set_config('request.jwt.claims', '{"tenant_id":"not-a-uuid; drop table faqs;"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.faqs;
  execute 'reset role';
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('fail-closed', '오염된 tenant_id 클레임', '0', n::text,
          case when n = 0 then 'PASS' else 'FAIL' end);
exception when others then
  execute 'reset role';
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('fail-closed', '오염된 tenant_id 클레임', '0', 'ERROR: ' || sqlerrm, 'FAIL');
end $$;

/* ───────── 6. anon 역할: 정책 없음 = 전체 차단 ───────── */
do $$
declare n_faq bigint; n_stu bigint; n_ten bigint;
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  select count(*) into n_faq from public.faqs;
  select count(*) into n_stu from public.students;
  select count(*) into n_ten from public.tenants;
  execute 'reset role';
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('anon 차단', 'anon이 faqs 조회', '0', n_faq::text, case when n_faq = 0 then 'PASS' else 'FAIL' end),
         ('anon 차단', 'anon이 students 조회', '0', n_stu::text, case when n_stu = 0 then 'PASS' else 'FAIL' end),
         ('anon 차단', 'anon이 tenants 조회', '0', n_ten::text, case when n_ten = 0 then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 7. tenants: 본인 테넌트 행만 SELECT ───────── */
do $$
declare own_n bigint; foreign_n bigint;
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  perform set_config('request.jwt.claims', json_build_object('tenant_id', t1)::text, true);
  execute 'set local role authenticated';
  select count(*) filter (where id = t1), count(*) filter (where id <> t1)
    into own_n, foreign_n from public.tenants;
  execute 'reset role';
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('tenants 격리', 'T1이 자기 tenants 행 조회', '1', own_n::text,
          case when own_n = 1 then 'PASS' else 'FAIL' end),
         ('tenants 격리', 'T1이 타 tenants 행 조회', '0', foreign_n::text,
          case when foreign_n = 0 then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 8. admin_otps: 정책 미부여 → authenticated 전면 차단 ───────── */
do $$
declare n bigint; seeded bigint;
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  -- owner 시점: 실제로 OTP 행이 있어야 "0건"이 차단의 증거가 된다.
  select count(*) into seeded from public.admin_otps;

  perform set_config('request.jwt.claims', json_build_object('tenant_id', t1)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.admin_otps;
  execute 'reset role';

  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('OTP 보호', format('authenticated가 admin_otps 조회 (실행 %s건)', seeded), '0', n::text,
          case
            when seeded = 0 then 'INCONCLUSIVE'
            when n = 0 then 'PASS'
            else 'FAIL'
          end);
end $$;

/* ───────── 8b. admin_otps: tenant_id 컬럼 존재 (전 테이블 tenant_id 규칙) ───────── */
insert into rls_result (scenario, detail, expected, actual, verdict)
select 'OTP 보호', 'admin_otps에 tenant_id 컬럼', '존재',
       case when count(*) = 1 then '존재' else '없음' end,
       case when count(*) = 1 then 'PASS' else 'FAIL' end
from information_schema.columns
where table_schema = 'public' and table_name = 'admin_otps' and column_name = 'tenant_id';

/* ───────── 8c. UPSERT 경유 우회 차단 (insert … on conflict) ─────────
   WITH CHECK는 INSERT/UPDATE에 걸리지만 on conflict do update 경로도 함께 막히는지 확인한다. */
do $$
declare
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  t2 constant uuid := '00000000-0000-0000-0000-000000000002';
  blocked boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('tenant_id', t1)::text, true);
  execute 'set local role authenticated';
  begin
    execute format(
      'insert into public.site_settings (tenant_id, key, value)
       values (%L, ''site_info'', ''{"brandName":"침투"}''::jsonb)
       on conflict (tenant_id, key) do update set value = excluded.value', t2);
  exception when insufficient_privilege or check_violation then
    blocked := true;
  end;
  execute 'reset role';
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('쓰기 차단', 'T1 → T2 UPSERT (on conflict do update)', '차단(예외)',
          case when blocked then '차단됨' else 'UPSERT 성공(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 8d. UPDATE … RETURNING 으로 타테넌트 행 유출 차단 ───────── */
do $$
declare
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  t2 constant uuid := '00000000-0000-0000-0000-000000000002';
  leaked bigint := 0;
begin
  perform set_config('request.jwt.claims', json_build_object('tenant_id', t1)::text, true);
  execute 'set local role authenticated';
  execute format(
    'with upd as (update public.faqs set answer = answer where tenant_id = %L returning 1)
     select count(*) from upd', t2) into leaked;
  execute 'reset role';
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('쓰기 차단', 'T1 → T2 UPDATE … RETURNING 유출', '0행', leaked::text || '행',
          case when leaked = 0 then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 8e. 자동화 함수 RPC 실행 차단 (security definer 남용 방지) ─────────
   PostgREST는 public 스키마 함수를 RPC로 노출한다. automation_* 는 pg_cron 전용이어야 한다. */
do $$
declare
  fn text;
  fns constant text[] := array[
    'automation_call_flush()',
    'automation_payment_overdue_flag()',
    'automation_content_backup_daily()',
    'automation_schedule_autoclean()'
  ];
  blocked boolean;
begin
  foreach fn in array fns loop
    blocked := false;
    execute 'set local role authenticated';
    begin
      -- EXECUTE 안은 SQL이어야 한다(plpgsql의 PERFORM 불가). 결과는 버린다.
      execute format('select public.%s', fn);
    exception
      when insufficient_privilege then blocked := true;
      when others then blocked := false; -- 실행됐다는 뜻(다른 이유로 실패해도 권한은 통과)
    end;
    execute 'reset role';

    insert into rls_result (scenario, detail, expected, actual, verdict)
    values ('함수 실행 차단', format('authenticated가 %s 실행', split_part(fn, '(', 1)),
            '권한 거부',
            case when blocked then '거부됨' else '실행 가능(위반)' end,
            case when blocked then 'PASS' else 'FAIL' end);
  end loop;
end $$;

do $$
declare blocked boolean := false;
begin
  execute 'set local role authenticated';
  begin
    execute 'select public.automation_call_edge_function(''lesson_reminder'')';
  exception
    when insufficient_privilege then blocked := true;
    when others then blocked := false;
  end;
  execute 'reset role';
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('함수 실행 차단', 'authenticated가 automation_call_edge_function 실행', '권한 거부',
          case when blocked then '거부됨' else '실행 가능(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);
end $$;

-- admin_replace_operator(00013)는 security definer — 노출되면 anon 키만으로 운영자 탈취가
-- 가능하므로 자동화 함수와 동일하게 EXECUTE 회수를 검증한다.
do $$
declare blocked boolean := false;
begin
  execute 'set local role authenticated';
  begin
    execute 'select public.admin_replace_operator(''00000000-0000-0000-0000-000000000001''::uuid, ''a@b.c'', ''d@e.f'', ''탈취 시도'')';
  exception
    when insufficient_privilege then blocked := true;
    when others then blocked := false;
  end;
  execute 'reset role';
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('함수 실행 차단', 'authenticated가 admin_replace_operator 실행', '권한 거부',
          case when blocked then '거부됨' else '실행 가능(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 8f. admin_sessions(00013): 정책 미부여 → anon·authenticated 전면 차단 ─────────
   admin_otps와 동일 패턴 — 픽스처가 T2 세션 행을 심어 두므로 0건이 곧 차단의 증거다. */
do $$
declare seeded bigint; n_auth bigint; n_anon bigint;
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  select count(*) into seeded from public.admin_sessions;

  perform set_config('request.jwt.claims', json_build_object('tenant_id', t1)::text, true);
  execute 'set local role authenticated';
  select count(*) into n_auth from public.admin_sessions;
  execute 'reset role';

  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  select count(*) into n_anon from public.admin_sessions;
  execute 'reset role';

  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('세션 보호', format('authenticated가 admin_sessions 조회 (실행 %s건)', seeded), '0', n_auth::text,
          case when seeded = 0 then 'INCONCLUSIVE' when n_auth = 0 then 'PASS' else 'FAIL' end),
         ('세션 보호', format('anon이 admin_sessions 조회 (실행 %s건)', seeded), '0', n_anon::text,
          case when seeded = 0 then 'INCONCLUSIVE' when n_anon = 0 then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 8g. append-only 강제(00013 P-11): 트리거는 service_role조차 예외 없이 막는다 ─────────
   owner(BYPASSRLS 동급)로 실행해 "RLS가 아닌 무결성 규칙"임을 증명한다 —
   허용되는 유일한 쓰기: activity_log의 phase pending→committed|aborted 확정. */
do $$
declare
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  v_id uuid;
  blocked boolean;
  transitioned boolean := false;
begin
  insert into public.activity_log (tenant_id, actor_email, action, target_type, summary, category, phase)
  values (t1, 'rls-test@example.com', 'test_critical', 'test', '트리거 검증용 pending', 'money', 'pending')
  returning id into v_id;

  -- (a) phase 외 컬럼 변경 → 거부
  blocked := false;
  begin
    update public.activity_log set summary = '변조 시도' where id = v_id;
  exception when others then blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('감사 append-only', 'activity_log 일반 컬럼 UPDATE', '차단(예외)',
          case when blocked then '차단됨' else '변경 성공(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (b) DELETE → 전면 거부
  blocked := false;
  begin
    delete from public.activity_log where id = v_id;
  exception when others then blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('감사 append-only', 'activity_log DELETE', '차단(예외)',
          case when blocked then '차단됨' else '삭제 성공(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (c) 허용 경로: pending→committed 확정은 통과해야 한다(과잉 차단 아님)
  begin
    update public.activity_log set phase = 'committed' where id = v_id;
    transitioned := true;
  exception when others then transitioned := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('감사 append-only', 'activity_log phase pending→committed', '허용',
          case when transitioned then '전환됨' else '차단됨(과잉)' end,
          case when transitioned then 'PASS' else 'FAIL' end);

  -- (d) 확정된 기록의 되돌리기(committed→pending) → 거부
  blocked := false;
  begin
    update public.activity_log set phase = 'pending' where id = v_id;
  exception when others then blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('감사 append-only', 'activity_log phase committed→pending 역전', '차단(예외)',
          case when blocked then '차단됨' else '역전 성공(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);
end $$;

do $$
declare
  t2 constant uuid := '00000000-0000-0000-0000-000000000002';
  blocked boolean;
begin
  -- adjustments(조정 이력)는 UPDATE·DELETE 전면 거부 — 정정은 새 이력으로만.
  blocked := false;
  begin
    update public.adjustments set reason = '변조 시도' where tenant_id = t2;
  exception when others then blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('감사 append-only', 'adjustments UPDATE', '차단(예외)',
          case when blocked then '차단됨' else '변경 성공(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  blocked := false;
  begin
    delete from public.adjustments where tenant_id = t2;
  exception when others then blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('감사 append-only', 'adjustments DELETE', '차단(예외)',
          case when blocked then '차단됨' else '삭제 성공(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 8h. 한 사건 한 업무(00013 시나리오 50): work_items 열린 업무 dedup ───────── */
do $$
declare
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  blocked boolean := false;
  reopened boolean := false;
begin
  insert into public.work_items (tenant_id, kind, title, source_type, source_id, next_action)
  values (t1, 'manual', 'dedup 검증 업무', 'rls_test', 'dedup-1', '검증');

  -- 같은 사건의 열린 업무 중복 생성 → 부분 유니크가 차단
  begin
    insert into public.work_items (tenant_id, kind, title, source_type, source_id, next_action)
    values (t1, 'manual', 'dedup 검증 업무(중복)', 'rls_test', 'dedup-1', '검증');
  exception when unique_violation then blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('오늘 업무 dedup', '같은 사건의 열린 업무 중복 INSERT', '차단(unique)',
          case when blocked then '차단됨' else '중복 생성(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- 완결 후 같은 사건 재발 → 새 업무는 만들 수 있어야 한다(부분 인덱스 — 과잉 차단 아님)
  update public.work_items
     set status = 'done', resolution = '검증 완료', resolved_at = now()
   where tenant_id = t1 and source_type = 'rls_test' and source_id = 'dedup-1'
     and status = 'open';
  begin
    insert into public.work_items (tenant_id, kind, title, source_type, source_id, next_action)
    values (t1, 'manual', 'dedup 검증 업무(재발)', 'rls_test', 'dedup-1', '재검증');
    reopened := true;
  exception when unique_violation then reopened := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('오늘 업무 dedup', '완결 후 같은 사건 재발 시 새 업무 생성', '허용',
          case when reopened then '생성됨' else '차단됨(과잉)' end,
          case when reopened then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 8i. 단일 활성 운영자·원자적 승계(00013 P-10 · 시나리오 67·68) ───────── */
-- 부분 유니크: 한 테넌트에 활성 운영자 2명은 어떤 경로로도 불가
do $$
declare
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  blocked boolean := false;
begin
  begin
    insert into public.admin_accounts (tenant_id, email, status)
    values (t1, 'second-active@example.com', 'active');
  exception when unique_violation then blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('단일 활성 운영자', 'T1에 두 번째 active 운영자 INSERT', '차단(unique)',
          case when blocked then '차단됨' else '2인 활성(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);
end $$;

-- 승계 RPC: 지위 이전·세션 회수·감사 기록이 한 전환으로 끝나고 반쪽 전환이 남지 않는다
do $$
declare
  t3 constant uuid := '00000000-0000-0000-0000-000000000003';
  n_active int; n_live_session int; n_audit int;
  rerun_blocked boolean := false;
begin
  -- 준비: 회수 대상 세션 1개
  insert into public.admin_sessions (tenant_id, email, token_hash, expires_at)
  values (t3, 'test-korean@example.com', 'dummy-session-hash-t3', now() + interval '12 hours');

  perform public.admin_replace_operator(
    t3, 'test-korean@example.com', 'new-korean@example.com', 'RLS 검증용 승계');

  select count(*) into n_active
    from public.admin_accounts where tenant_id = t3 and status = 'active';
  select count(*) into n_live_session
    from public.admin_sessions
   where tenant_id = t3 and email = 'test-korean@example.com' and revoked_at is null;
  select count(*) into n_audit
    from public.activity_log
   where tenant_id = t3 and action = 'admin_replace_operator'
     and category = 'permission' and phase = 'committed';

  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('원자적 승계', '승계 후 T3 활성 운영자 수', '1', n_active::text,
          case when n_active = 1 then 'PASS' else 'FAIL' end),
         ('원자적 승계', '승계 후 이전 운영자 미회수 세션', '0', n_live_session::text,
          case when n_live_session = 0 then 'PASS' else 'FAIL' end),
         ('원자적 승계', '승계 감사 기록(permission·committed)', '1', n_audit::text,
          case when n_audit = 1 then 'PASS' else 'FAIL' end);

  -- 이미 승계된(inactive) 운영자로 재승계 시도 → raise (from이 active가 아니면 실행 금지)
  begin
    perform public.admin_replace_operator(
      t3, 'test-korean@example.com', 'another@example.com', '중복 승계 시도');
  exception when others then rerun_blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('원자적 승계', 'inactive 운영자로 재승계 시도', '차단(예외)',
          case when rerun_blocked then '차단됨' else '실행됨(위반)' end,
          case when rerun_blocked then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 8j. 승인 통보 멱등(00014 검수 36): payssam_events applied dedup ─────────
   같은 승인 통보(테넌트·bill_id·apprNum·경로)는 한 번만 '적용'될 수 있다 — 부분 유니크가
   DB에서 이중 수납 반영을 차단한다. 중복 수신의 '기록'(outcome=duplicate)은 허용돼야 한다
   (원장은 전부 보존 — 과잉 차단 아님). */
do $$
declare
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  blocked boolean := false;
  logged boolean := false;
begin
  insert into public.payssam_events (tenant_id, bill_id, event_type, appr_state, appr_num, appr_price, payload, outcome)
  values (t1, 'T1BILLDEDUP00000001', 'callback', 'F', 'APPR-DEDUP-1', 10000,
          '{"apprState":"F","apprNum":"APPR-DEDUP-1"}'::jsonb, 'applied');

  -- 같은 승인 통보의 두 번째 '적용' → 차단(중복 통보는 한 결제 — 검수 36)
  begin
    insert into public.payssam_events (tenant_id, bill_id, event_type, appr_state, appr_num, appr_price, payload, outcome)
    values (t1, 'T1BILLDEDUP00000001', 'callback', 'F', 'APPR-DEDUP-1', 10000,
            '{"apprState":"F","apprNum":"APPR-DEDUP-1"}'::jsonb, 'applied');
  exception when unique_violation then blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('승인 통보 멱등', '같은 승인 통보 2회 적용(applied) INSERT', '차단(unique)',
          case when blocked then '차단됨' else '이중 적용(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- 재수신 기록은 duplicate로 남는다 — 부분 인덱스라 applied 외에는 제한 없음
  begin
    insert into public.payssam_events (tenant_id, bill_id, event_type, appr_state, appr_num, appr_price, payload, outcome)
    values (t1, 'T1BILLDEDUP00000001', 'callback', 'F', 'APPR-DEDUP-1', 10000,
            '{"apprState":"F","apprNum":"APPR-DEDUP-1"}'::jsonb, 'duplicate');
    logged := true;
  exception when unique_violation then logged := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('승인 통보 멱등', '재수신의 duplicate 기록 INSERT', '허용',
          case when logged then '기록됨' else '차단됨(과잉)' end,
          case when logged then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 8k. 결제 컬럼 CHECK(00014 ①·②): refunded 허용·스냅샷 오염 차단 ───────── */
do $$
declare
  t2 constant uuid := '00000000-0000-0000-0000-000000000002';
  s2 uuid;
  refunded_ok boolean := false;
  bad_state_blocked boolean := false;
begin
  select id into strict s2 from public.students where tenant_id = t2 limit 1;

  -- 환불 완료는 별도 업무 상태다(검수 45) — status CHECK 재생성이 refunded를 허용해야 한다
  begin
    insert into public.payments (tenant_id, student_id, period_start, period_end, amount, method,
                                 status, refund_appr_num, refunded_at, refund_reason)
    values (t2, s2, '2026-08-01', '2026-08-28', 480000, 'payssaem',
            'refunded', 'T2-REFUND-0001', now(), '검증용 환불');
    refunded_ok := true;
  exception when check_violation then refunded_ok := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('결제 CHECK', 'payments.status = refunded INSERT', '허용',
          case when refunded_ok then '허용됨' else '차단됨(과잉)' end,
          case when refunded_ok then 'PASS' else 'FAIL' end);

  -- 승인 스냅샷은 F/W/C/D만 — 스펙 밖 값은 스냅샷 오염이므로 DB가 거부한다
  begin
    insert into public.payments (tenant_id, student_id, period_start, period_end, amount, method, appr_state)
    values (t2, s2, '2026-09-01', '2026-09-28', 480000, 'payssaem', 'X');
  exception when check_violation then bad_state_blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('결제 CHECK', 'payments.appr_state 스펙 밖 값(X) INSERT', '차단(check)',
          case when bad_state_blocked then '차단됨' else '오염 허용(위반)' end,
          case when bad_state_blocked then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 8l. 제출 원문 불변(00015 검수 27 · H-07): 트리거는 service_role조차 막는다 ─────────
   owner(BYPASSRLS 동급)로 실행해 "RLS가 아닌 무결성 규칙"임을 증명한다 — 8g와 동일 계열.
   허용되는 유일한 UPDATE: 검토·피드백·철회 필드 갱신. DELETE는 직접 삭제만 거부하고
   부모 과제 CASCADE 삭제(학생·테넌트 삭제 경로)는 통과해야 한다(과잉 차단 아님). */
do $$
declare
  -- 시드에 학생이 있는 테넌트는 T2·T3뿐 — 8k와 동일하게 T2 학생을 쓴다(owner 시점 무결성 검증).
  t2 constant uuid := '00000000-0000-0000-0000-000000000002';
  s2 uuid;
  v_assignment uuid;
  v_submission uuid;
  blocked boolean;
  allowed boolean;
  remaining bigint;
begin
  select id into strict s2 from public.students where tenant_id = t2 limit 1;

  insert into public.homework_assignments (tenant_id, student_id, title, status, assigned_at)
  values (t2, s2, '불변 트리거 검증용 과제', 'assigned', now())
  returning id into v_assignment;

  insert into public.homework_submissions (tenant_id, assignment_id, attempt_no, content)
  values (t2, v_assignment, 1, '원문 제출 내용')
  returning id into v_submission;

  -- (a) 제출 원문(content) UPDATE → 거부 (재제출은 새 행으로 — 검수 27)
  blocked := false;
  begin
    update public.homework_submissions set content = '변조 시도' where id = v_submission;
  exception when others then blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('제출 append-only', 'homework_submissions 원문(content) UPDATE', '차단(예외)',
          case when blocked then '차단됨' else '변경 성공(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (b) 제출 시각(submitted_at) UPDATE → 거부 (지연 사실·실제 시각 연결 — H-02)
  blocked := false;
  begin
    update public.homework_submissions set submitted_at = now() - interval '1 day'
     where id = v_submission;
  exception when others then blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('제출 append-only', 'homework_submissions submitted_at UPDATE', '차단(예외)',
          case when blocked then '차단됨' else '변경 성공(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (c) 직접 DELETE → 거부 (과제 취소가 제출물을 지우지 않는다 — H-07)
  blocked := false;
  begin
    delete from public.homework_submissions where id = v_submission;
  exception when others then blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('제출 append-only', 'homework_submissions 직접 DELETE', '차단(예외)',
          case when blocked then '차단됨' else '삭제 성공(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (d) 허용 경로: 검토·피드백 필드 갱신은 통과해야 한다(과잉 차단 아님 — H-03)
  allowed := true;
  begin
    update public.homework_submissions
       set review_status = 'reviewed', feedback = '피드백 초안', feedback_status = 'draft',
           review_result = 'complete'
     where id = v_submission;
  exception when others then allowed := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('제출 append-only', 'homework_submissions 검토·피드백 필드 UPDATE', '허용',
          case when allowed then '갱신됨' else '차단됨(과잉)' end,
          case when allowed then 'PASS' else 'FAIL' end);

  -- (e) 재제출: 같은 회차(attempt_no) 중복 INSERT → unique 차단, 다음 회차는 허용(검수 27)
  blocked := false;
  begin
    insert into public.homework_submissions (tenant_id, assignment_id, attempt_no, content)
    values (t2, v_assignment, 1, '같은 회차 중복 제출');
  exception when unique_violation then blocked := true;
  end;
  allowed := true;
  begin
    insert into public.homework_submissions (tenant_id, assignment_id, attempt_no, content)
    values (t2, v_assignment, 2, '재제출 — 새 행이 최신 검토 대상');
  exception when others then allowed := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('제출 append-only', '같은 회차(attempt_no=1) 중복 INSERT', '차단(unique)',
          case when blocked then '차단됨' else '중복 생성(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end),
         ('제출 append-only', '재제출(attempt_no=2) 새 행 INSERT', '허용',
          case when allowed then '생성됨' else '차단됨(과잉)' end,
          case when allowed then 'PASS' else 'FAIL' end);

  -- (f) 부모 과제 CASCADE 삭제는 트리거가 막지 않는다 — 학생·테넌트 삭제 경로 보전.
  --     (과제 행 삭제 자체는 앱 코드에서 금지 — 여기서는 무결성 규칙의 범위만 증명)
  allowed := true;
  begin
    delete from public.homework_assignments where id = v_assignment;
  exception when others then allowed := false;
  end;
  select count(*) into remaining
    from public.homework_submissions where assignment_id = v_assignment;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('제출 append-only', '부모 과제 CASCADE 삭제(학생·테넌트 삭제 경로)', '허용',
          case when allowed and remaining = 0 then '통과됨'
               when not allowed then '차단됨(과잉)'
               else format('제출 %s건 잔존', remaining) end,
          case when allowed and remaining = 0 then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 8m. 정본 충돌 해소(00016 A-06·G-03·S-01): 철회 상태·대체 연결·비공개 기본값 ─────────
   owner(BYPASSRLS 동급)로 실행해 "RLS가 아닌 무결성 규칙"임을 증명한다 — 8k와 동일 계열. */
do $$
declare
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  t2 constant uuid := '00000000-0000-0000-0000-000000000002';
  s2 uuid;
  v_old uuid;
  v_new uuid;
  v_foreign uuid;
  v_status text;
  allowed boolean;
  blocked boolean;
begin
  select id into strict s2 from public.students where tenant_id = t2 limit 1;

  -- (a) G-03: status CHECK 재생성이 retracted를 허용해야 한다(철회는 업무 상태)
  allowed := false;
  begin
    insert into public.ai_reports (tenant_id, student_id, type, status, retracted_at, retract_reason)
    values (t2, s2, 'lesson', 'retracted', now(), '검증용 철회')
    returning id into v_old;
    allowed := true;
  exception when check_violation then allowed := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('보고서 철회(00016)', 'ai_reports.status = retracted INSERT', '허용',
          case when allowed then '허용됨' else '차단됨(과잉)' end,
          case when allowed then 'PASS' else 'FAIL' end);

  -- (b) 00013 ⑥의 분리 유지: 'failed'는 여전히 업무 상태가 아니다(CHECK 재생성이 되돌리지 않음)
  blocked := false;
  begin
    insert into public.ai_reports (tenant_id, student_id, type, status)
    values (t2, s2, 'lesson', 'failed');
  exception when check_violation then blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('보고서 철회(00016)', 'ai_reports.status = failed INSERT(00013 분리 유지)', '차단(check)',
          case when blocked then '차단됨' else '전달 상태 혼입(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (c) G-03 대체 표시: 같은 테넌트의 새 본 연결은 허용
  allowed := false;
  begin
    insert into public.ai_reports (tenant_id, student_id, type, status)
    values (t2, s2, 'lesson', 'approved')
    returning id into v_new;
    update public.ai_reports set superseded_by = v_new where id = v_old;
    allowed := true;
  exception when foreign_key_violation then allowed := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('보고서 철회(00016)', 'superseded_by 동일 테넌트 새 본 연결', '허용',
          case when allowed then '연결됨' else '차단됨(과잉)' end,
          case when allowed then 'PASS' else 'FAIL' end);

  -- (d) 대체 연결이 테넌트 경계를 넘으면 복합 FK가 차단한다(타테넌트 본을 "최신본"으로 오염 금지)
  insert into public.ai_reports (tenant_id, type, status)
  values (t1, 'lesson', 'approved')
  returning id into v_foreign;
  blocked := false;
  begin
    update public.ai_reports set superseded_by = v_foreign where id = v_old;
  exception when foreign_key_violation then blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('보고서 철회(00016)', 'superseded_by 타테넌트 보고서 연결', '차단(fk)',
          case when blocked then '차단됨' else '교차 연결 허용(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);
  delete from public.ai_reports where id = v_foreign; -- 검증용 T1 행 정리(교차노출 스캔과 무관하나 잔존 방지)

  -- (e) S-01 등록 즉시 공개 금지: 상태를 지정하지 않은 신규 후기는 draft로 태어난다
  insert into public.reviews (tenant_id, reviewer_type, content)
  values (t2, 'parent', '검증용 신규 후기 — 기본값 확인')
  returning status into v_status;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('후기 승인 게시(00016)', '신규 후기 INSERT 기본 status', 'draft(비공개)',
          v_status,
          case when v_status = 'draft' then 'PASS' else 'FAIL' end);

  -- (f) 후기 상태는 정본 흐름의 4개뿐 — 스펙 밖 값은 CHECK가 거부한다
  blocked := false;
  begin
    insert into public.reviews (tenant_id, reviewer_type, content, status)
    values (t2, 'parent', '검증용 오염 상태', 'open');
  exception when check_violation then blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('후기 승인 게시(00016)', 'reviews.status 스펙 밖 값(open) INSERT', '차단(check)',
          case when blocked then '차단됨' else '오염 허용(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (g) A-06 소프트 삭제: 원 행을 남긴 채 deleted_at 스탬프 UPDATE가 가능해야 한다
  allowed := false;
  begin
    update public.grade_records
       set deleted_at = now(), deleted_reason = '검증용 철회(물리 삭제 금지)'
     where tenant_id = t2 and exam_name = 'T2 전용 모의고사' and deleted_at is null;
    allowed := found;
  exception when others then allowed := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('성적 소프트 삭제(00016)', 'grade_records deleted_at 스탬프 UPDATE', '허용',
          case when allowed then '스탬프됨(원 행 보존)' else '차단·대상 없음' end,
          case when allowed then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 8n. 역할별 포털 4종(00017): 정책 없는 RLS → anon·authenticated 전면 차단 ─────────
   admin_otps·admin_sessions(8f)와 동일 패턴(00010). 포털 이용자는 Supabase authenticated 주체가
   아니고 관리자 조회도 service client 경유라 테넌트 정책이 평가될 자리가 없다 — 정책을 만들지
   않는 대신 anon·authenticated는 한 행도 읽지 못해야 한다.
   픽스처가 T2 사람·관계·링크·세션을 한 벌 심어 두므로 0건이 곧 차단의 증거다. */
do $$
declare
  t text;
  seeded bigint; n_auth bigint; n_anon bigint;
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  tables constant text[] := array[
    'portal_contacts', 'portal_relations', 'portal_access_links', 'portal_sessions'
  ];
begin
  foreach t in array tables loop
    execute format('select count(*) from public.%I', t) into seeded;

    perform set_config('request.jwt.claims', json_build_object('tenant_id', t1)::text, true);
    execute 'set local role authenticated';
    execute format('select count(*) from public.%I', t) into n_auth;
    execute 'reset role';

    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
    execute format('select count(*) from public.%I', t) into n_anon;
    execute 'reset role';

    insert into rls_result (scenario, detail, expected, actual, verdict)
    values ('포털 권한(00017)', format('authenticated가 %s 조회 (실행 %s건)', t, seeded), '0', n_auth::text,
            case when seeded = 0 then 'INCONCLUSIVE' when n_auth = 0 then 'PASS' else 'FAIL' end),
           ('포털 권한(00017)', format('anon이 %s 조회 (실행 %s건)', t, seeded), '0', n_anon::text,
            case when seeded = 0 then 'INCONCLUSIVE' when n_anon = 0 then 'PASS' else 'FAIL' end);
  end loop;
end $$;

-- accept_portal_link는 security definer — RPC로 노출되면 토큰 해시만 알아내면(또는 무차별 대입으로)
-- 관계를 활성화할 수 있다. 자동화 함수·admin_replace_operator(8e)와 동일하게 EXECUTE 회수를 검증한다.
do $$
declare
  r text;
  roles constant text[] := array['authenticated', 'anon'];
  blocked boolean;
begin
  foreach r in array roles loop
    blocked := false;
    execute format('set local role %I', r);
    begin
      execute 'select * from public.accept_portal_link(''dummy-portal-link-hash-t2'', ''00000000-0000-0000-0000-000000000002''::uuid)';
    exception
      when insufficient_privilege then blocked := true;
      when others then blocked := false; -- 실행됐다는 뜻(다른 이유로 실패해도 권한은 통과)
    end;
    execute 'reset role';

    insert into rls_result (scenario, detail, expected, actual, verdict)
    values ('함수 실행 차단', format('%s가 accept_portal_link 실행', r), '권한 거부',
            case when blocked then '거부됨' else '실행 가능(위반)' end,
            case when blocked then 'PASS' else 'FAIL' end);
  end loop;
end $$;

-- 회수가 과했는지도 함께 본다: PUBLIC 회수는 service_role의 EXECUTE까지 없앨 수 있어
-- (00017 말미 주석) 서버 호출 경로 자체가 죽는다. 차단만 검사하면 이 사고를 못 잡는다.
do $$
declare allowed boolean := false;
begin
  execute 'set local role service_role';
  begin
    execute 'select * from public.accept_portal_link(''rls-service-role-probe'', ''00000000-0000-0000-0000-000000000001''::uuid)';
    allowed := true;
  exception
    when insufficient_privilege then allowed := false;
    when others then allowed := true; -- 권한은 통과(다른 이유로 실패해도 EXECUTE는 있었다)
  end;
  execute 'reset role';

  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('함수 실행 허용', 'service_role이 accept_portal_link 실행(서버 호출 경로)', '실행 가능',
          case when allowed then '실행됨' else '권한 거부(서버 경로 단절)' end,
          case when allowed then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 8o. 원자적 수락(00017 ⑤ · 검수 124·125): 첫 클릭 = 수락, 재클릭 = no-op ─────────
   정본 P-01: "초대 수락 중 일부 연결 실패 → 수락 전체를 완료로 표시하지 않음"(검수 125),
   "한 번 완료된 초대 재사용 → 기존 결과로 수렴, 새 관계 중복 생성 금지"(검수 124).
   owner 시점으로 실행한다 — 이건 RLS가 아니라 트랜잭션·무결성 규칙이라 service_role도 예외가 없다. */
do $$
declare
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  s1 uuid; ca uuid; ra uuid;
  v_status text; v_role text; v_first boolean;
  v_acc1 timestamptz; v_acc2 timestamptz;
  n bigint;
begin
  -- 하네스 시드에는 T1 학생이 없다(시드의 students는 T2·T3만) — 검증용 학생을 직접 만든다.
  insert into public.students (tenant_id, name, parent_phone)
    values (t1, 'RLS 검증 학생(포털)', '01055550000') returning id into s1;

  insert into public.portal_contacts (tenant_id, name, phone)
    values (t1, 'RLS 검증 학생본인', '01055550001') returning id into ca;
  insert into public.portal_relations (tenant_id, contact_id, student_id, role)
    values (t1, ca, s1, 'student') returning id into ra;
  insert into public.portal_access_links (tenant_id, relation_id, token_hash)
    values (t1, ra, 'rls-portal-link-a');

  -- 첫 클릭: 링크 검증 → 관계 invited→active + accepted_at 스탬프가 한 트랜잭션에서
  select a.status, a.role, a.accepted_at, a.first_accept
    into v_status, v_role, v_acc1, v_first
    from public.accept_portal_link('rls-portal-link-a', '00000000-0000-0000-0000-000000000001'::uuid) a;

  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('포털 수락(검수 125)', '첫 링크 클릭 = 수락(상태·시각·역할 동시 확정)',
          'active/student/시각 있음/최초',
          format('%s/%s/%s/%s', coalesce(v_status, '없음'), coalesce(v_role, '없음'),
                 case when v_acc1 is null then '시각 없음' else '시각 있음' end,
                 case when v_first then '최초' else '재수락' end),
          case when v_status = 'active' and v_role = 'student'
                and v_acc1 is not null and v_first then 'PASS' else 'FAIL' end);

  -- 재클릭: 이미 active면 아무것도 바꾸지 않는다(수락 시각 불변 · first_accept=false)
  select a.status, a.accepted_at, a.first_accept
    into v_status, v_acc2, v_first
    from public.accept_portal_link('rls-portal-link-a', '00000000-0000-0000-0000-000000000001'::uuid) a;

  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('포털 수락(검수 124)', '같은 링크 재클릭 = no-op(수락 시각 불변)',
          'active/시각 동일/재수락',
          format('%s/%s/%s', coalesce(v_status, '없음'),
                 case when v_acc2 = v_acc1 then '시각 동일' else '시각 변경(위반)' end,
                 case when v_first then '최초(위반)' else '재수락' end),
          case when v_status = 'active' and v_acc2 = v_acc1 and not v_first then 'PASS' else 'FAIL' end);

  -- 재수락이 관계를 새로 만들지 않는다(검수 124 "중복 생성 금지")
  select count(*) into n from public.portal_relations
   where tenant_id = t1 and contact_id = ca and student_id = s1;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('포털 수락(검수 124)', '재수락 후 관계 행 수', '1', n::text,
          case when n = 1 then 'PASS' else 'FAIL' end);
end $$;

-- 반쪽 수락 금지의 DB측 보강: active인데 수락 시각이 없는 관계는 owner도 만들 수 없다.
do $$
declare
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  s1 uuid; ca uuid; blocked boolean := false;
begin
  select id into strict s1 from public.students
   where tenant_id = t1 and name = 'RLS 검증 학생(포털)';
  select id into strict ca from public.portal_contacts where tenant_id = t1 and phone = '01055550001';
  begin
    insert into public.portal_relations (tenant_id, contact_id, student_id, role, status, accepted_at)
      values (t1, ca, s1, 'contractor', 'active', null);
  exception when check_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('포털 수락(검수 125)', 'accepted_at 없는 active 관계 INSERT', '차단',
          case when blocked then '차단됨' else '허용됨(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);
end $$;

-- 원자성 실측: 수락 UPDATE 직후 후속 연결이 실패하는 상황을 트리거로 주입한다.
-- 전체가 롤백되어 관계는 invited로 남아야 한다 — "반쪽 수락 금지"(검수 125)의 증명.
do $$
declare
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  s1 uuid; cb uuid; rb uuid;
  v_status text; v_acc timestamptz;
  failed boolean := false;
begin
  select id into strict s1 from public.students
   where tenant_id = t1 and name = 'RLS 검증 학생(포털)';

  insert into public.portal_contacts (tenant_id, name, phone)
    values (t1, 'RLS 검증 보호자', '01055550002') returning id into cb;
  insert into public.portal_relations (tenant_id, contact_id, student_id, role)
    values (t1, cb, s1, 'guardian') returning id into rb;
  insert into public.portal_access_links (tenant_id, relation_id, token_hash)
    values (t1, rb, 'rls-portal-link-b');

  execute $fn$
    create or replace function public.rls_test_accept_fail_injection()
    returns trigger language plpgsql as $body$
    begin
      raise exception '[rls-test] 수락 후속 연결 실패 주입';
    end $body$
  $fn$;
  execute 'create trigger trg_rls_test_accept_fail after update on public.portal_relations
             for each row execute function public.rls_test_accept_fail_injection()';

  begin
    perform 1 from public.accept_portal_link('rls-portal-link-b', '00000000-0000-0000-0000-000000000001'::uuid);
  exception when others then failed := true;
  end;

  execute 'drop trigger trg_rls_test_accept_fail on public.portal_relations';
  execute 'drop function public.rls_test_accept_fail_injection()';

  select r.status, r.accepted_at into v_status, v_acc
    from public.portal_relations r where r.id = rb;

  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('포털 수락(검수 125)', '수락 도중 실패 주입 → 반쪽 수락 잔존 여부',
          '예외 + invited 유지',
          format('%s + %s/%s', case when failed then '예외' else '무예외(위반)' end, v_status,
                 case when v_acc is null then '시각 없음' else '시각 스탬프(위반)' end),
          case when failed and v_status = 'invited' and v_acc is null then 'PASS' else 'FAIL' end);

  -- 실패 주입을 걷어낸 뒤 같은 링크로 재시도하면 정상 수락된다(P-01 "전체 재시도").
  select a.status into v_status from public.accept_portal_link('rls-portal-link-b', '00000000-0000-0000-0000-000000000001'::uuid) a;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('포털 수락(검수 125)', '원인 제거 후 같은 링크 재시도', 'active', coalesce(v_status, '없음'),
          case when v_status = 'active' then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 8p. 링크 재발급·관계 회수(00017 ③④ · 검수 20·21·109) ─────────
   정본 P-01: "새 초대 발급 → 이전 초대 즉시 무효", P-06: "관계 종료 → 기존 세션·초대·공유링크 회수".
   링크가 살아 있어도 관계가 끝났으면 수락 경로 자체가 닫혀야 한다(검수 109 직접 이동 차단). */
do $$
declare
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  ra uuid; n_old bigint; n_new bigint; n_revoked bigint; blocked boolean := false;
begin
  select l.relation_id into strict ra
    from public.portal_access_links l where l.token_hash = 'rls-portal-link-a';

  -- 재발급: 이전 링크를 무효로 돌리지 않으면 새 링크 INSERT 자체가 부분 유니크에 걸린다.
  blocked := false;
  begin
    insert into public.portal_access_links (tenant_id, relation_id, token_hash)
      values (t1, ra, 'rls-portal-link-a-dup');
  exception when unique_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('포털 링크(검수 20)', '이전 링크를 살려 둔 채 새 링크 발급', '차단(관계당 활성 1개)',
          case when blocked then '차단됨' else '허용됨(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  update public.portal_access_links
     set rotated_at = now(), revoked_at = now(), revoked_reason = '재발급(RLS 검증)'
   where relation_id = ra and revoked_at is null;
  insert into public.portal_access_links (tenant_id, relation_id, token_hash)
    values (t1, ra, 'rls-portal-link-a2');

  select count(*) into n_old from public.accept_portal_link('rls-portal-link-a', '00000000-0000-0000-0000-000000000001'::uuid);
  select count(*) into n_new from public.accept_portal_link('rls-portal-link-a2', '00000000-0000-0000-0000-000000000001'::uuid);

  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('포털 링크(검수 20)', '재발급 후 이전 링크로 수락 시도', '0행', n_old::text || '행',
          case when n_old = 0 then 'PASS' else 'FAIL' end),
         ('포털 링크(검수 20)', '재발급된 새 링크로 수락', '1행', n_new::text || '행',
          case when n_new = 1 then 'PASS' else 'FAIL' end);

  -- 관계 회수: 링크는 살아 있어도(회수 누락 상황을 일부러 재현) 수락 경로가 닫혀야 한다.
  update public.portal_relations
     set status = 'revoked', revoked_at = now(), revoked_reason = '관계 종료(RLS 검증)'
   where id = ra;

  select count(*) into n_revoked from public.accept_portal_link('rls-portal-link-a2', '00000000-0000-0000-0000-000000000001'::uuid);
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('포털 회수(검수 21·109)', '관계 회수 후 살아 있는 링크로 수락 시도', '0행', n_revoked::text || '행',
          case when n_revoked = 0 then 'PASS' else 'FAIL' end);
end $$;

-- 존재 비노출(P-02 "계정 존재를 노출하지 않는 확인"): 없는 토큰도 0행으로 같게 응답한다.
do $$
declare n_none bigint; n_empty bigint;
begin
  select count(*) into n_none from public.accept_portal_link('rls-portal-link-does-not-exist', '00000000-0000-0000-0000-000000000001'::uuid);
  select count(*) into n_empty from public.accept_portal_link('', '00000000-0000-0000-0000-000000000001'::uuid);
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('포털 수락(P-02)', '없는 토큰·빈 토큰 수락 시도', '둘 다 0행',
          format('%s행/%s행', n_none, n_empty),
          case when n_none = 0 and n_empty = 0 then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 8q. 역할 독립·테넌트 경계(00017 ② · 검수 16·18) ─────────
   정본 P-01: "한 사람이 여러 역할 → 한 계정에 역할을 각각 연결", P-05: "학습 영역과 금전 영역을
   역할별로 분리". 겸임은 역할별 행이고 한 역할의 회수가 다른 역할을 건드리지 않아야 한다. */
do $$
declare
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  s1 uuid; s_other uuid; ca uuid; rp uuid;
  v_payer text; v_student text;
  blocked boolean;
begin
  select id into strict s1 from public.students
   where tenant_id = t1 and name = 'RLS 검증 학생(포털)';
  select id into strict s_other from public.students where tenant_id <> t1 limit 1;
  select id into strict ca from public.portal_contacts where tenant_id = t1 and phone = '01055550001';

  -- 같은 사람·같은 학생에 다른 역할 추가 → 별개 권한 행으로 공존한다(직전 8p에서 student 역할은 회수됨)
  insert into public.portal_relations (tenant_id, contact_id, student_id, role)
    values (t1, ca, s1, 'payer') returning id into rp;

  select r.status into v_payer from public.portal_relations r where r.id = rp;
  select r.status into v_student from public.portal_relations r
   where r.tenant_id = t1 and r.contact_id = ca and r.student_id = s1 and r.role = 'student';

  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('포털 역할 독립(검수 16)', 'student 역할 회수 후 payer 역할 신규 연결',
          'payer=invited / student=revoked',
          format('payer=%s / student=%s', coalesce(v_payer, '없음'), coalesce(v_student, '없음')),
          case when v_payer = 'invited' and v_student = 'revoked' then 'PASS' else 'FAIL' end);

  -- 같은 사람·학생·역할 중복 행 금지 — 재초대는 같은 행을 되살린다(관계는 하나)
  blocked := false;
  begin
    insert into public.portal_relations (tenant_id, contact_id, student_id, role)
      values (t1, ca, s1, 'payer');
  exception when unique_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('포털 역할 독립(검수 16)', '같은 사람·학생·역할 중복 관계 INSERT', '차단',
          case when blocked then '차단됨' else '허용됨(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- 테넌트 경계: T1 사람을 타테넌트 학생에 연결하려는 시도는 복합 FK가 막는다(검수 18의 DB측 바닥)
  blocked := false;
  begin
    insert into public.portal_relations (tenant_id, contact_id, student_id, role)
      values (t1, ca, s_other, 'guardian');
  exception when foreign_key_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('포털 테넌트 경계(검수 18)', 'T1 사람 × 타테넌트 학생 관계 INSERT', '차단(복합 FK)',
          case when blocked then '차단됨' else '허용됨(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- 링크도 마찬가지 — 관계의 테넌트와 링크의 테넌트가 어긋나면 타테넌트 관계로 로그인할 수 있다
  blocked := false;
  begin
    insert into public.portal_access_links (tenant_id, relation_id, token_hash)
      values ('00000000-0000-0000-0000-000000000002', rp, 'rls-portal-link-cross-tenant');
  exception when foreign_key_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('포털 테넌트 경계(검수 18)', '타테넌트 tenant_id로 링크 INSERT', '차단(복합 FK)',
          case when blocked then '차단됨' else '허용됨(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- 전화 정규화: 하이픈 표기가 들어오면 같은 사람이 둘로 갈라진다 — DB가 막는다
  blocked := false;
  begin
    insert into public.portal_contacts (tenant_id, name, phone)
      values (t1, 'RLS 검증 비정규 번호', '010-5555-0001');
  exception when check_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('포털 사람(검수 124)', '비정규 전화번호(하이픈) INSERT', '차단',
          case when blocked then '차단됨' else '허용됨(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- 같은 사람 중복 등록 금지 — 재초대가 새 사람을 만들지 않는 근거(검수 124)
  blocked := false;
  begin
    insert into public.portal_contacts (tenant_id, name, phone)
      values (t1, 'RLS 검증 학생본인(중복)', '01055550001');
  exception when unique_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('포털 사람(검수 124)', '같은 테넌트·같은 번호 사람 중복 INSERT', '차단',
          case when blocked then '차단됨' else '허용됨(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 8r. 유입 신청폼(00018 ①): 정책 없는 RLS → anon·authenticated 전면 차단 ─────────
   admin_otps·admin_sessions(8f)·역할별 포털 4종(8n)과 동일 패턴(00010). 공개 폼 방문자는
   Supabase authenticated 주체가 아니라 토큰 링크를 든 손님이고, 조회·제출·발급이 전부
   service client 경유라 테넌트 정책이 평가될 자리가 없다 — 정책을 만들지 않는 대신 두 역할은
   한 행도 읽지 못해야 한다. 픽스처가 T2 신청폼을 심어 두므로 0건이 곧 차단의 증거다. */
do $$
declare
  t text;
  seeded bigint; n_auth bigint; n_anon bigint;
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  tables constant text[] := array['intake_forms'];
begin
  foreach t in array tables loop
    execute format('select count(*) from public.%I', t) into seeded;

    perform set_config('request.jwt.claims', json_build_object('tenant_id', t1)::text, true);
    execute 'set local role authenticated';
    execute format('select count(*) from public.%I', t) into n_auth;
    execute 'reset role';

    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
    execute format('select count(*) from public.%I', t) into n_anon;
    execute 'reset role';

    insert into rls_result (scenario, detail, expected, actual, verdict)
    values ('신청폼 권한(00018)', format('authenticated가 %s 조회 (실행 %s건)', t, seeded), '0', n_auth::text,
            case when seeded = 0 then 'INCONCLUSIVE' when n_auth = 0 then 'PASS' else 'FAIL' end),
           ('신청폼 권한(00018)', format('anon이 %s 조회 (실행 %s건)', t, seeded), '0', n_anon::text,
            case when seeded = 0 then 'INCONCLUSIVE' when n_anon = 0 then 'PASS' else 'FAIL' end);
  end loop;
end $$;

-- 두 RPC는 상태를 바꾸는 경로다(등록 활성화·자리 점유). RPC로 노출되면 공개 키만으로 등록을
-- 활성화하거나 남의 자리를 집을 수 있다 — 자동화 함수(8d)·accept_portal_link(8n)와 동일하게
-- anon·authenticated EXECUTE 회수를 검증한다.
do $$
declare
  r text;
  roles constant text[] := array['authenticated', 'anon'];
  calls constant text[] := array[
    'select public.activate_enrollment(''00000000-0000-0000-0000-000000000001''::uuid, gen_random_uuid())',
    'select public.offer_waitlist_seat(''00000000-0000-0000-0000-000000000001''::uuid, gen_random_uuid(), 999, now() - interval ''1 day'')'
  ];
  names constant text[] := array['activate_enrollment', 'offer_waitlist_seat'];
  i int;
  blocked boolean;
begin
  foreach r in array roles loop
    for i in 1 .. array_length(calls, 1) loop
      blocked := false;
      execute format('set local role %I', r);
      begin
        execute calls[i];
      exception
        when insufficient_privilege then blocked := true;
        when others then blocked := false; -- 실행됐다는 뜻(다른 이유로 실패해도 권한은 통과)
      end;
      execute 'reset role';

      insert into rls_result (scenario, detail, expected, actual, verdict)
      values ('함수 실행 차단', format('%s가 %s 실행', r, names[i]), '권한 거부',
              case when blocked then '거부됨' else '실행 가능(위반)' end,
              case when blocked then 'PASS' else 'FAIL' end);
    end loop;
  end loop;
end $$;

-- 회수가 과했는지도 함께 본다(00018 ⑩ 주석): PUBLIC 회수는 service_role의 EXECUTE까지 없앨 수
-- 있어 서버 호출 경로 자체가 죽는다. 차단만 검사하면 이 사고를 못 잡는다.
do $$
declare
  i int;
  allowed boolean;
  calls constant text[] := array[
    'select public.activate_enrollment(''00000000-0000-0000-0000-000000000001''::uuid, gen_random_uuid())',
    'select public.offer_waitlist_seat(''00000000-0000-0000-0000-000000000001''::uuid, gen_random_uuid(), 999, now() - interval ''1 day'')'
  ];
  names constant text[] := array['activate_enrollment', 'offer_waitlist_seat'];
begin
  for i in 1 .. array_length(calls, 1) loop
    allowed := false;
    execute 'set local role service_role';
    begin
      execute calls[i];
      allowed := true;
    exception
      when insufficient_privilege then allowed := false;
      when others then allowed := true; -- 권한은 통과(다른 이유로 실패해도 EXECUTE는 있었다)
    end;
    execute 'reset role';

    insert into rls_result (scenario, detail, expected, actual, verdict)
    values ('함수 실행 허용', format('service_role이 %s 실행(서버 호출 경로)', names[i]), '실행 가능',
            case when allowed then '실행됨' else '권한 거부(서버 경로 단절)' end,
            case when allowed then 'PASS' else 'FAIL' end);
  end loop;
end $$;

/* ───────── 8s. 신청폼 활성 1개(00018 ① · 검수 6·7) ─────────
   정본 C-05 예외: "결과 변경 시 기존 다음 단계 링크를 먼저 닫고 새 결과를 생성", 검수 7:
   "새 다음 단계 폼을 발급하면 이전 폼은 닫힌다". 코드 규율이 아니라 부분 유니크가 강제하는지를
   owner 시점으로 본다 — RLS가 아닌 무결성 규칙이라 service_role도 예외가 없다. */
do $$
declare
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  c1 uuid;
  f1 uuid;
  blocked boolean;
  allowed boolean;
begin
  insert into public.consultations (tenant_id, name, phone)
    values (t1, 'RLS 검증 상담(폼)', '01055552000') returning id into c1;

  insert into public.intake_forms (tenant_id, consultation_id, kind, token_hash)
    values (t1, c1, 'trial', 'rls-intake-trial-1') returning id into f1;

  -- (a) 이전 폼을 살려 둔 채 같은 종류로 재발급 → 차단(활성 1개)
  blocked := false;
  begin
    insert into public.intake_forms (tenant_id, consultation_id, kind, token_hash)
      values (t1, c1, 'trial', 'rls-intake-trial-2');
  exception when unique_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('신청폼 활성 1개(검수 7)', '이전 폼을 살려 둔 채 같은 종류 재발급', '차단(부분 유니크)',
          case when blocked then '차단됨' else '허용됨(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (b) 이전 폼을 닫으면 재발급이 통과한다(과잉 차단 아님 — T-01 "링크 만료 → 새 링크 발급")
  update public.intake_forms
     set status = 'closed', closed_at = now(), close_reason = '재발급(RLS 검증)'
   where id = f1;
  allowed := true;
  begin
    insert into public.intake_forms (tenant_id, consultation_id, kind, token_hash)
      values (t1, c1, 'trial', 'rls-intake-trial-2');
  exception when others then allowed := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('신청폼 활성 1개(검수 7)', '이전 폼을 닫은 뒤 재발급', '허용',
          case when allowed then '발급됨' else '차단됨(과잉)' end,
          case when allowed then 'PASS' else 'FAIL' end);

  -- (c) 종류가 다른 폼은 공존한다 — 시범 결과가 정규 제안일 때 정규 폼이 열려야 한다(검수 11).
  --     종류 간 배타(검수 6 "동시 활성 하나")는 상담 결과 전환 코드가 두 종류를 함께 닫아 지킨다.
  allowed := true;
  begin
    insert into public.intake_forms (tenant_id, consultation_id, kind, token_hash)
      values (t1, c1, 'regular', 'rls-intake-regular-1');
  exception when others then allowed := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('신청폼 활성 1개(검수 11)', '다른 종류(정규) 폼 동시 발급', '허용',
          case when allowed then '발급됨' else '차단됨(과잉)' end,
          case when allowed then 'PASS' else 'FAIL' end);

  -- (d) 제출은 시각과 내용이 함께여야 한다 — "제출됐다는데 볼 내용이 없다"는 검토 불가 상태다.
  blocked := false;
  begin
    insert into public.intake_forms (tenant_id, consultation_id, kind, token_hash,
                                     status, submitted_at)
      values (t1, c1, 'trial', 'rls-intake-nopayload', 'submitted', now());
  exception when check_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('신청폼 제출(T-01)', '내용(payload) 없는 submitted INSERT', '차단(check)',
          case when blocked then '차단됨' else '허용됨(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (e) 테넌트 경계: 타테넌트 상담에 폼을 발급하려는 시도는 복합 FK가 막는다
  blocked := false;
  begin
    insert into public.intake_forms (tenant_id, consultation_id, kind, token_hash)
      select t1, cs.id, 'trial', 'rls-intake-cross-tenant'
        from public.consultations cs where cs.tenant_id <> t1 limit 1;
  exception when foreign_key_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('신청폼 테넌트 경계', 'T1 폼 × 타테넌트 상담 INSERT', '차단(복합 FK)',
          case when blocked then '차단됨' else '허용됨(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 8t. 시범 확정 게이트·결과 append-only(00018 ②③ · 검수 8·9 · T-04) ─────────
   정본 T-02: "일정만 합의·결제 미확인 → 결제 대기, 예약 확정 아님", "무료 시범은 결제 단계를
   통과 처리하지 않고 결제 불필요 근거로 일정 확정". T-04: "결과가 바뀌면 이전 결과를 덮어쓰지
   않고 새 결정으로 연결한다". owner 시점 — RLS가 아니라 무결성 규칙이다. */
do $$
declare
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  c1 uuid;
  ts_free uuid;
  n_results bigint;
  remaining bigint;
  blocked boolean;
  allowed boolean;
begin
  insert into public.consultations (tenant_id, name, phone)
    values (t1, 'RLS 검증 상담(시범)', '01055553000') returning id into c1;

  -- (a) 일정만 합의(결제 미확인)인 유료 시범을 확정으로 올리려는 시도 → 차단(검수 8·9)
  blocked := false;
  begin
    insert into public.trial_sessions (tenant_id, consultation_id, scheduled_at, is_paid,
                                       schedule_confirmed, payment_confirmed, status)
      values (t1, c1, now() + interval '1 day', true, true, false, 'scheduled');
  exception when check_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('시범 확정 게이트(검수 9)', '유료 시범 결제 미확인 상태로 scheduled INSERT', '차단(check)',
          case when blocked then '차단됨' else '반쪽 확정(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (b) 유료 시범의 결제 확인에는 결제 행이 근거로 있어야 한다(대사 불가 확인 금지)
  blocked := false;
  begin
    insert into public.trial_sessions (tenant_id, consultation_id, scheduled_at, is_paid,
                                       schedule_confirmed, payment_confirmed, status)
      values (t1, c1, now() + interval '1 day', true, true, true, 'scheduled');
  exception when check_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('시범 확정 게이트(검수 9)', '결제 행 없이 payment_confirmed인 유료 시범 INSERT', '차단(check)',
          case when blocked then '차단됨' else '근거 없는 확인(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (c) 일정 확정에는 실제 일시가 필요하다 — 안내할 수 없는 확정은 확정이 아니다
  blocked := false;
  begin
    insert into public.trial_sessions (tenant_id, consultation_id, is_paid,
                                       schedule_confirmed, payment_confirmed)
      values (t1, c1, false, true, true);
  exception when check_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('시범 확정 게이트(T-02)', '일시 없이 schedule_confirmed INSERT', '차단(check)',
          case when blocked then '차단됨' else '허용됨(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (d) 무료 시범은 결제 불필요 근거(is_paid=false)로 확정된다(과잉 차단 아님 — T-02 예외)
  allowed := true;
  begin
    insert into public.trial_sessions (tenant_id, consultation_id, scheduled_at, is_paid,
                                       schedule_confirmed, payment_confirmed, status)
      values (t1, c1, now() + interval '1 day', false, true, true, 'scheduled')
      returning id into ts_free;
  exception when others then allowed := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('시범 확정 게이트(T-02)', '무료 시범(is_paid=false) 확정 INSERT', '허용',
          case when allowed then '확정됨(결제 불필요 근거 보존)' else '차단됨(과잉)' end,
          case when allowed then 'PASS' else 'FAIL' end);

  -- (e) 확정된 회차의 게이트를 사후에 내리는 UPDATE도 차단된다(확정의 근거는 사라지지 않는다)
  blocked := false;
  begin
    update public.trial_sessions set payment_confirmed = false where id = ts_free;
  exception when check_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('시범 확정 게이트(T-02)', '확정된 회차의 게이트 사후 해제 UPDATE', '차단(check)',
          case when blocked then '차단됨' else '허용됨(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (f) 결과 이력 append-only: UPDATE 전면 거부(T-04 "이전 결과를 덮어쓰지 않는다")
  insert into public.trial_results (tenant_id, trial_session_id, result, note, decided_by)
    values (t1, ts_free, 'retrial', '첫 결정 — 재시범', 'rls@example.com');

  blocked := false;
  begin
    update public.trial_results set result = 'regular_offer' where trial_session_id = ts_free;
  exception when others then blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('시범 결과 append-only(T-04)', 'trial_results 결과 UPDATE', '차단(예외)',
          case when blocked then '차단됨' else '덮어쓰기 성공(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (g) 직접 DELETE 거부 — 결정을 지우면 왜 바뀌었는지가 사라진다
  blocked := false;
  begin
    delete from public.trial_results where trial_session_id = ts_free;
  exception when others then blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('시범 결과 append-only(T-04)', 'trial_results 직접 DELETE', '차단(예외)',
          case when blocked then '차단됨' else '삭제 성공(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (h) 결과 변경 = 새 결정 행(과잉 차단 아님). 이력 2건이 남고 최신은 마지막 결정이다.
  allowed := true;
  begin
    insert into public.trial_results (tenant_id, trial_session_id, result, note, decided_by)
      values (t1, ts_free, 'regular_offer', '결과 변경 — 정규 제안', 'rls@example.com');
  exception when others then allowed := false;
  end;
  select count(*) into n_results from public.trial_results where trial_session_id = ts_free;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('시범 결과 append-only(T-04)', '결과 변경 → 새 결정 행 추가', '허용 + 이력 2건',
          format('%s / %s건', case when allowed then '추가됨' else '차단됨(과잉)' end, n_results),
          case when allowed and n_results = 2 then 'PASS' else 'FAIL' end);

  -- (i) 부모 회차 CASCADE 삭제는 트리거가 막지 않는다 — 상담·테넌트 삭제 경로 보전
  allowed := true;
  begin
    delete from public.trial_sessions where id = ts_free;
  exception when others then allowed := false;
  end;
  select count(*) into remaining from public.trial_results where trial_session_id = ts_free;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('시범 결과 append-only(T-04)', '부모 회차 CASCADE 삭제(상담·테넌트 삭제 경로)', '허용',
          case when allowed and remaining = 0 then '통과됨'
               when not allowed then '차단됨(과잉)'
               else format('결과 %s건 잔존', remaining) end,
          case when allowed and remaining = 0 then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 8u. 등록 4게이트 원자성(00018 ④⑤⑧ · 검수 12·13·14·15) ─────────
   정본 R-04: "네 조건 모두 충족 → 등록 활성화 / 하나라도 미완료 → 등록 준비 중",
   검수 15: "활성화 연결 중 하나가 실패하면 반쪽 등록이 남지 않는다".
   조건을 UPDATE의 WHERE에 넣은 단일 문장 RPC라 계수→갱신 사이의 창이 없다 — 게이트를 하나씩
   내려 보며 어떤 조합에서도 활성 0행임을 실측한다. owner 시점(트랜잭션·무결성 규칙). */
do $$
declare
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  s1 uuid;
  c1 uuid;
  en uuid;
  en2 uuid;
  g text;
  gates constant text[] := array['relation_ok', 'contract_ok', 'payment_ok', 'schedule_ok'];
  ok boolean;
  n_active bigint;
  v_student_status text;
  v_activated timestamptz;
  blocked boolean;
  allowed boolean;
begin
  -- 하네스 시드의 students는 T2·T3뿐이다(8o와 같은 사정) — 검증용 T1 학생을 직접 만든다.
  -- 미러 갱신을 관찰해야 하므로 활성이 아닌 상태(trial)로 시작한다.
  insert into public.students (tenant_id, name, parent_phone, status)
    values (t1, 'RLS 검증 학생(등록)', '01055554000', 'trial') returning id into s1;
  insert into public.consultations (tenant_id, name, phone)
    values (t1, 'RLS 검증 상담(등록)', '01055554000') returning id into c1;
  insert into public.enrollments (tenant_id, student_id, consultation_id)
    values (t1, s1, c1) returning id into en;

  -- (a) 네 게이트 중 하나라도 false면 활성 0행 — 검수 13·14의 "등록 준비 중"이 곧 이 상태다
  foreach g in array gates loop
    -- 지목한 게이트 하나만 false, 나머지 셋은 true — 네 조합을 차례로 만든다
    update public.enrollments
       set relation_ok = (g <> 'relation_ok'),
           contract_ok = (g <> 'contract_ok'),
           payment_ok  = (g <> 'payment_ok'),
           schedule_ok = (g <> 'schedule_ok')
     where id = en;

    ok := public.activate_enrollment(t1, en);
    select count(*) into n_active
      from public.enrollments where id = en and status = 'active';

    insert into rls_result (scenario, detail, expected, actual, verdict)
    values ('등록 4게이트(검수 12·15)', format('%s만 미완인 상태로 activate_enrollment', g),
            'false + 활성 0행',
            format('%s + 활성 %s행', case when ok then 'true(위반)' else 'false' end, n_active),
            case when not ok and n_active = 0 then 'PASS' else 'FAIL' end);
  end loop;

  -- (b) 네 게이트가 모두 서면 활성 + 활성 시각 + 학생 미러가 한 트랜잭션에서 함께 확정된다
  update public.enrollments
     set relation_ok = true, contract_ok = true, payment_ok = true, schedule_ok = true
   where id = en;

  ok := public.activate_enrollment(t1, en);
  select e.activated_at into v_activated from public.enrollments e where e.id = en;
  select s.status into v_student_status from public.students s where s.id = s1;

  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('등록 활성화(검수 12 · R-05)', '네 게이트 완비 후 activate_enrollment',
          'true + 활성 시각 + 학생 미러 active',
          format('%s / %s / students.status=%s',
                 case when ok then 'true' else 'false' end,
                 case when v_activated is null then '시각 없음' else '시각 있음' end,
                 coalesce(v_student_status, '없음')),
          case when ok and v_activated is not null and v_student_status = 'active'
               then 'PASS' else 'FAIL' end);

  -- (c) 멱등: 이미 활성인 등록의 재활성화는 false(활성 시각을 다시 찍지 않는다)
  ok := public.activate_enrollment(t1, en);
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('등록 활성화(검수 12)', '이미 활성인 등록 재활성화', 'false',
          case when ok then 'true(위반)' else 'false' end,
          case when ok then 'FAIL' else 'PASS' end);

  -- (d) RPC를 우회한 수동 UPDATE도 CHECK가 막는다 — 반쪽 활성의 DB측 바닥(검수 15)
  insert into public.enrollments (tenant_id, student_id, consultation_id, payment_ok)
    values (t1, s1, c1, true) returning id into en2;
  blocked := false;
  begin
    update public.enrollments set status = 'active', activated_at = now() where id = en2;
  exception when check_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('등록 활성화(검수 15)', 'RPC 우회 수동 UPDATE로 게이트 미완 등록 활성화', '차단(check)',
          case when blocked then '차단됨' else '반쪽 활성(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (e) 활성 등록은 학생당 하나(R-05 "활성 등록 1건") — 재등록은 새 등록이고 동시 활성은 아니다
  update public.enrollments
     set relation_ok = true, contract_ok = true, payment_ok = true, schedule_ok = true
   where id = en2;
  -- 부분 유니크에 걸리지만 호출부에는 예외가 아니라 게이트 미완과 같은 false로 수렴해야 한다
  -- (00018 ⑧ 예외 블록). 예외가 새면 관리자 화면이 500을 받는다.
  blocked := false;
  ok := true;
  begin
    ok := public.activate_enrollment(t1, en2);
  exception when others then blocked := true;
  end;
  select count(*) into n_active
    from public.enrollments where tenant_id = t1 and student_id = s1 and status = 'active';
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('등록 활성 1건(R-05)', '같은 학생의 두 번째 등록 활성화', 'false(예외 없음) + 활성 1건',
          format('%s + 활성 %s건',
                 case when blocked then '예외 누출(위반)'
                      when ok then 'true(위반)' else 'false' end, n_active),
          case when not blocked and not ok and n_active = 1 then 'PASS' else 'FAIL' end);

  -- (f) 계약: 동의에는 계약자 신원이 함께 있어야 한다(R-03 "성인 계약자 확인")
  blocked := false;
  begin
    insert into public.contracts (tenant_id, enrollment_id, terms, agreed_at)
      values (t1, en, '{"fee":400000}'::jsonb, now());
  exception when check_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('계약 동의(R-03)', '계약자 신원 없는 동의 INSERT', '차단(check)',
          case when blocked then '차단됨' else '허용됨(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (g) 유효 계약 1건(R-05): 조건 변경은 새 계약본 + 이전 동의 해제가 짝이어야 한다
  allowed := true;
  begin
    insert into public.contracts (tenant_id, enrollment_id, terms,
                                  agreed_at, agreed_by_name, agreed_by_phone)
      values (t1, en, '{"fee":400000}'::jsonb, now(), 'RLS 계약자', '01055554000');
  exception when others then allowed := false;
  end;
  blocked := false;
  begin
    insert into public.contracts (tenant_id, enrollment_id, terms,
                                  agreed_at, agreed_by_name, agreed_by_phone)
      values (t1, en, '{"fee":450000}'::jsonb, now(), 'RLS 계약자', '01055554000');
  exception when unique_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('계약 유효 1건(R-05)', '첫 동의 INSERT / 두 번째 동의 INSERT', '허용 / 차단',
          format('%s / %s',
                 case when allowed then '동의됨' else '차단됨(과잉)' end,
                 case when blocked then '차단됨' else '허용됨(위반)' end),
          case when allowed and blocked then 'PASS' else 'FAIL' end);

  -- (h) 미동의 계약본(제안)은 여러 개 공존한다 — 조건 재협의 중인 제안까지 막지 않는다
  allowed := true;
  begin
    insert into public.contracts (tenant_id, enrollment_id, terms)
      values (t1, en, '{"fee":450000,"note":"재협의 제안"}'::jsonb);
    insert into public.contracts (tenant_id, enrollment_id, terms)
      values (t1, en, '{"fee":470000,"note":"재협의 제안2"}'::jsonb);
  exception when others then allowed := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('계약 유효 1건(R-03)', '미동의 계약본(제안) 복수 INSERT', '허용',
          case when allowed then '허용됨' else '차단됨(과잉)' end,
          case when allowed then 'PASS' else 'FAIL' end);

  -- (i) 활성화 RPC는 테넌트 경계를 넘지 않는다 — 타테넌트 id로 부르면 0행(false)
  insert into public.enrollments (tenant_id, student_id, consultation_id,
                                  relation_ok, contract_ok, payment_ok, schedule_ok)
    values (t1, s1, c1, true, true, true, true) returning id into en2;
  ok := public.activate_enrollment('00000000-0000-0000-0000-000000000002', en2);
  select count(*) into n_active
    from public.enrollments where id = en2 and status = 'active';
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('등록 활성화 테넌트 경계', '타테넌트 p_tenant_id로 activate_enrollment', 'false + 활성 0행',
          format('%s + 활성 %s행', case when ok then 'true(위반)' else 'false' end, n_active),
          case when not ok and n_active = 0 then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 8v. 대기 자리 제안(00018 ⑥⑨ · 검수 61·62) ─────────
   정본 C-06 예외: "같은 자리를 여러 사람에게 동시에 제안하거나 확정하지 않는다"(검수 61),
   "거절·만료 → 제안 종료 → 자리 반환 → 다음 대기자 검토"(검수 62).
   부분 유니크가 최종 방어선이고 RPC는 그 위의 친절한 판정이다 — 둘 다 실측한다. */
do $$
declare
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  c_a uuid;
  c_b uuid;
  ok boolean;
  ok2 boolean;
  blocked boolean;
  n_offered bigint;
begin
  insert into public.consultations (tenant_id, name, phone)
    values (t1, 'RLS 검증 대기자 A', '01055555000') returning id into c_a;
  insert into public.consultations (tenant_id, name, phone)
    values (t1, 'RLS 검증 대기자 B', '01055555001') returning id into c_b;

  -- (a) 한 자리 한 사람: 첫 제안은 통과, 다른 대기자에게 같은 자리 제안은 false(예외 아님)
  ok := public.offer_waitlist_seat(t1, c_a, 7, now() + interval '2 days');
  ok2 := public.offer_waitlist_seat(t1, c_b, 7, now() + interval '2 days');
  select count(*) into n_offered
    from public.waitlist_offers where tenant_id = t1 and seat_no = 7 and status = 'offered';
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('자리 제안(검수 61)', '같은 자리(7번)를 두 대기자에게 제안', 'true / false + offered 1건',
          format('%s / %s + %s건',
                 case when ok then 'true' else 'false' end,
                 case when ok2 then 'true(위반)' else 'false' end, n_offered),
          case when ok and not ok2 and n_offered = 1 then 'PASS' else 'FAIL' end);

  -- (b) RPC를 우회한 직접 INSERT도 부분 유니크가 막는다(최종 방어선)
  blocked := false;
  begin
    insert into public.waitlist_offers (tenant_id, consultation_id, seat_no, expires_at)
      values (t1, c_b, 7, now() + interval '2 days');
  exception when unique_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('자리 제안(검수 61)', 'RPC 우회 직접 INSERT로 같은 자리 중복 제안', '차단(부분 유니크)',
          case when blocked then '차단됨' else '중복 제안(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (c) 거절 = 자리 반환(검수 62): 같은 자리를 다음 대기자에게 다시 제안할 수 있다
  update public.waitlist_offers
     set status = 'declined', responded_at = now()
   where tenant_id = t1 and seat_no = 7 and status = 'offered';
  ok := public.offer_waitlist_seat(t1, c_b, 7, now() + interval '2 days');
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('자리 반환(검수 62)', '거절 후 같은 자리 재제안', 'true',
          case when ok then 'true' else 'false(자리 미반환)' end,
          case when ok then 'PASS' else 'FAIL' end);

  -- (d) 만료도 반환이다 — 기한 경과 제안은 자리를 묶어두지 않는다
  update public.waitlist_offers
     set status = 'expired'
   where tenant_id = t1 and seat_no = 7 and status = 'offered';
  ok := public.offer_waitlist_seat(t1, c_a, 7, now() + interval '2 days');
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('자리 반환(검수 62)', '만료 후 같은 자리 재제안', 'true',
          case when ok then 'true' else 'false(자리 미반환)' end,
          case when ok then 'PASS' else 'FAIL' end);

  -- (e) 응답(수락·거절)에는 응답 시각이 함께 있어야 한다 — 언제 자리가 반환됐는지의 근거
  blocked := false;
  begin
    update public.waitlist_offers set status = 'accepted'
     where tenant_id = t1 and seat_no = 7 and status = 'offered';
  exception when check_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('자리 제안(C-06)', '응답 시각 없는 accepted UPDATE', '차단(check)',
          case when blocked then '차단됨' else '허용됨(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (f) 기간부 제안(C-06 "승인된 기간의 자리 제안"): 이미 지난 기한으로는 자리를 묶지 않는다
  ok := public.offer_waitlist_seat(t1, c_b, 8, now() - interval '1 day');
  select count(*) into n_offered
    from public.waitlist_offers where tenant_id = t1 and seat_no = 8;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('자리 제안(C-06)', '이미 지난 기한으로 제안', 'false + 0건',
          format('%s + %s건', case when ok then 'true(위반)' else 'false' end, n_offered),
          case when not ok and n_offered = 0 then 'PASS' else 'FAIL' end);

  -- (g) 번호 없는 제안(seat_no null)은 자리 경합 대상이 아니다 — 개별 협의는 서로 막지 않는다
  ok := public.offer_waitlist_seat(t1, c_a, null, now() + interval '2 days');
  ok2 := public.offer_waitlist_seat(t1, c_b, null, now() + interval '2 days');
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('자리 제안(C-06)', '번호 없는 제안 2건(개별 협의)', '둘 다 true',
          format('%s / %s',
                 case when ok then 'true' else 'false(과잉)' end,
                 case when ok2 then 'true' else 'false(과잉)' end),
          case when ok and ok2 then 'PASS' else 'FAIL' end);

  -- (h) 테넌트 경계: 자리 번호는 테넌트별로 독립이다(타테넌트의 7번 자리가 T1을 막지 않는다)
  ok := public.offer_waitlist_seat('00000000-0000-0000-0000-000000000002',
          (select cs.id from public.consultations cs
            where cs.tenant_id = '00000000-0000-0000-0000-000000000002' limit 1),
          7, now() + interval '2 days');
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('자리 제안 테넌트 경계', 'T1이 7번을 점유한 상태에서 T2의 7번 제안', 'true(독립)',
          case when ok then 'true' else 'false(교차 차단·과잉)' end,
          case when ok then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 8w. 회차 원장·이중 차감 금지(00020 ③⑫⑬⑭ · L-03·L-05) ─────────
   정본 L-05 예외: "원 회차와 대체 회차를 동시에 차감하지 않는다", "원 회차당 활성 보강은 하나".
   정본 L-04 예외: "회차당 최종 출결은 하나이며 정정은 새 조정 이력으로 남긴다",
   "노쇼 확정 전에는 환불·잔액 계산에 반영하지 않는다".
   정본 L-10 예외: "귀속 미확정 회차는 환불·잔액 계산에서 확정 사실처럼 사용하지 않는다".
   잔액은 저장값이 아니라 원장 합이므로, 검증도 원장과 뷰를 함께 본다. */
do $$
declare
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  st1 uuid;
  st2 uuid;
  en1 uuid;
  ct1 uuid;
  ct2 uuid;
  pk1 uuid;
  sd_a uuid;   -- 정상 차감 대상
  sd_b uuid;   -- 보강 원 회차
  sd_c uuid;   -- 귀속 미확정
  sd_d uuid;   -- 반복 정정 대상
  sd_e uuid;   -- 정정 게이트 우회 시도 대상(미확정)
  sd_f uuid;   -- 취소 슬롯 부활 검증
  sd_g uuid;   -- 삭제 연쇄 검증
  sd_h uuid;   -- 미래 회차 확정 검증
  sd_i uuid;   -- 연락 시각·종료 묶음 검증
  mk uuid;
  res jsonb;
  blocked boolean;
  n bigint;
  rem int;
begin
  select id into strict st1 from public.students where tenant_id = t1 limit 1;

  insert into public.enrollments (tenant_id, student_id, status, relation_ok, contract_ok,
                                  payment_ok, schedule_ok, activated_at)
    values (t1, st1, 'active', true, true, true, true, now() - interval '60 days')
    on conflict do nothing
    returning id into en1;
  if en1 is null then
    select id into strict en1 from public.enrollments
     where tenant_id = t1 and student_id = st1 and status = 'active' limit 1;
  end if;

  insert into public.contracts (tenant_id, enrollment_id, terms, agreed_at,
                                agreed_by_name, agreed_by_phone)
    values (t1, en1, '{"fee":400000}'::jsonb, now() - interval '60 days', 'RLS 검증 계약자', '01000000001')
    returning id into ct1;

  insert into public.lesson_packages (tenant_id, enrollment_id, contract_id, student_id,
                                      total_sessions, pattern, starts_on)
    values (t1, en1, ct1, st1, 8, '{"weekdays":[1],"time":"17:00","durationMin":60}'::jsonb,
            current_date)
    returning id into pk1;

  -- (a) draft 묶음에서는 회차를 만들지 않는다 — 일정 생성이 계약 완료를 대신하지 않는다(L-01)
  res := public.generate_package_sessions(t1, pk1, '[]'::jsonb, 'rls@test');
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('묶음 활성화(L-01)', 'draft 묶음에서 회차 생성', 'ok=false',
          coalesce(res ->> 'reason', 'ok'),
          case when (res ->> 'ok')::boolean is not true then 'PASS' else 'FAIL' end);

  res := public.activate_lesson_package(t1, pk1, 'rls@test');
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('묶음 활성화(L-01)', '활성 등록 + 동의 계약으로 활성화', 'ok=true',
          coalesce(res ->> 'reason', 'ok=true'),
          case when (res ->> 'ok')::boolean then 'PASS' else 'FAIL' end);

  -- (b) 후보 생성: 확정 + 충돌 + 기존 = 전체 (전체 결과 대사 — L-01 "전체 결과 안내")
  -- 후보는 과거 시각으로 만든다: 아래에서 출결 확정을 검증하는데, 확정은 시작한 회차만 가능하다.
  insert into public.schedules (tenant_id, student_id, scheduled_at, ends_at, status)
    values (t1, st1, now() - interval '31 days', now() - interval '31 days' + interval '1 hour', 'planned');
  res := public.generate_package_sessions(t1, pk1, jsonb_build_array(
    jsonb_build_object('at', (now() - interval '32 days')::text,
                       'ends_at', (now() - interval '32 days' + interval '1 hour')::text),
    jsonb_build_object('at', (now() - interval '31 days' + interval '20 minutes')::text,
                       'ends_at', (now() - interval '31 days' + interval '80 minutes')::text),
    jsonb_build_object('at', (now() - interval '30 days')::text,
                       'ends_at', (now() - interval '30 days' + interval '1 hour')::text)
  ), 'rls@test');
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('회차 후보 대사(L-01)', '3건 중 1건이 기존 일정과 충돌', '확정2·충돌1·대사true',
          format('확정%s·충돌%s·대사%s', res ->> 'confirmed', res ->> 'conflicted', res ->> 'reconciled'),
          case when (res ->> 'confirmed') = '2' and (res ->> 'conflicted') = '1'
                    and (res ->> 'reconciled')::boolean then 'PASS' else 'FAIL' end);

  -- (c) 멱등: 같은 슬롯 재실행은 skipped — 회차를 복제하지 않는다
  res := public.generate_package_sessions(t1, pk1, jsonb_build_array(
    jsonb_build_object('at', (now() - interval '32 days')::text,
                       'ends_at', (now() - interval '32 days' + interval '1 hour')::text)
  ), 'rls@test');
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('회차 생성 멱등(L-01)', '같은 시각 후보 재실행', 'skipped=1·confirmed=0',
          format('skipped=%s·confirmed=%s', res ->> 'skipped', res ->> 'confirmed'),
          case when (res ->> 'skipped') = '1' and (res ->> 'confirmed') = '0'
               then 'PASS' else 'FAIL' end);

  select id into strict sd_a from public.schedules
   where tenant_id = t1 and package_id = pk1 and status = 'planned'
   order by scheduled_at limit 1;

  -- (d) 출결 확정 + 차감 → 잔액 7 (뷰는 원장 합이다)
  res := public.settle_attendance(t1, sd_a, 'present', true, '', 'rls@test');
  select remaining into rem from public.lesson_package_balances
   where tenant_id = t1 and package_id = pk1;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('회차 차감(L-03)', '출석 확정 + 차감 후 잔액', 'ok=true·잔액7',
          format('ok=%s·잔액%s', res ->> 'ok', rem),
          case when (res ->> 'ok')::boolean and rem = 7 then 'PASS' else 'FAIL' end);

  -- (e) 최종 출결 단일성(L-04): 같은 회차 재확정은 거부되고 이중 차감도 없다
  res := public.settle_attendance(t1, sd_a, 'absent', true, '', 'rls@test');
  select count(*) into n from public.session_ledger
   where tenant_id = t1 and schedule_id = sd_a and kind = 'deduct';
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('최종 출결 단일성(L-04)', '확정된 회차 재확정 + 차감 기입 수', 'ok=false·기입1건',
          format('%s·%s건', coalesce(res ->> 'reason', 'ok=true(위반)'), n),
          case when (res ->> 'ok')::boolean is not true and n = 1 then 'PASS' else 'FAIL' end);

  -- (f) 이중 차감 금지의 DB 바닥: RPC를 우회한 직접 INSERT도 부분 유니크가 막는다
  blocked := false;
  begin
    insert into public.session_ledger (tenant_id, package_id, schedule_id, kind, delta,
                                       correction_no, reason)
      values (t1, pk1, sd_a, 'deduct', -1, 0, 'RPC 우회 이중 차감 시도');
  exception when unique_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('이중 차감 금지(L-05)', 'RPC 우회 직접 INSERT로 같은 차수 재차감', '차단(부분 유니크)',
          case when blocked then '차단됨' else '중복 차감(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (g) 원장 append-only: 되돌림도 새 행이어야 한다 — service_role도 예외가 아니다
  blocked := false;
  begin
    update public.session_ledger set delta = 0
     where tenant_id = t1 and schedule_id = sd_a and kind = 'deduct';
  exception when others then blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('원장 append-only(L-06)', 'session_ledger delta UPDATE', '차단(트리거 예외)',
          case when blocked then '차단됨' else '허용됨(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (h) 노쇼 확정 게이트(L-04): 연락 기록 없이는 확정되지 않는다 → 잔액도 움직이지 않는다
  select id into strict sd_b from public.schedules
   where tenant_id = t1 and package_id = pk1 and status = 'planned'
   order by scheduled_at limit 1;
  res := public.settle_attendance(t1, sd_b, 'noshow', true, '', 'rls@test');
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('노쇼 확정 게이트(L-04)', '10·20·30분 연락 없이 노쇼 확정', 'ok=false',
          coalesce(res ->> 'reason', 'ok=true(위반)'),
          case when (res ->> 'ok')::boolean is not true then 'PASS' else 'FAIL' end);

  -- (i) 귀속 미확정 회차는 차감되지 않는다(L-10)
  insert into public.schedules (tenant_id, student_id, scheduled_at, ends_at, status)
    values (t1, st1, now() - interval '40 days', now() - interval '40 days' + interval '1 hour', 'planned')
    returning id into sd_c;
  res := public.settle_attendance(t1, sd_c, 'present', true, '', 'rls@test');
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('귀속 미확정(L-10)', '계약 없는 회차의 차감 확정', 'ok=false',
          coalesce(res ->> 'reason', 'ok=true(위반)'),
          case when (res ->> 'ok')::boolean is not true then 'PASS' else 'FAIL' end);

  -- (j) 임의 귀속 금지(L-10): 후보가 아닌 계약을 지목하면 확정되지 않는다
  res := public.resolve_schedule_contract(t1, sd_c, gen_random_uuid(), 'rls@test');
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('임의 귀속 금지(L-10)', '후보가 아닌 계약 UUID로 귀속 시도', 'ok=false',
          coalesce(res ->> 'reason', 'ok=true(위반)'),
          case when (res ->> 'ok')::boolean is not true then 'PASS' else 'FAIL' end);

  -- (k) 보강: 원 회차는 무차감으로 닫히고 대체 회차가 생긴다(L-05)
  res := public.create_makeup(t1, sd_b, now() + interval '45 days',
                              now() + interval '45 days 1 hour', '학생 사정', 'rls@test');
  mk := (res ->> 'makeup_id')::uuid;
  select count(*) into n from public.schedules
   where tenant_id = t1 and id = sd_b and status = 'canceled' and deduction_state = 'waived';
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('보강 생성(L-05)', '원 회차 무차감 종료 + 대체 회차', 'ok=true·원회차 waived',
          format('ok=%s·%s건', res ->> 'ok', n),
          case when (res ->> 'ok')::boolean and n = 1 then 'PASS' else 'FAIL' end);

  -- (l) 활성 보강 단일성(L-05): RPC를 우회한 직접 INSERT도 부분 유니크가 막는다
  blocked := false;
  begin
    insert into public.schedules (tenant_id, student_id, scheduled_at, status, origin_schedule_id)
      values (t1, st1, now() + interval '46 days', 'makeup', sd_b);
  exception when unique_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('활성 보강 단일성(L-05)', '같은 원 회차에 두 번째 보강 직접 INSERT', '차단(부분 유니크)',
          case when blocked then '차단됨' else '중복 보강(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (m) 정정 승인 = 조정 이력(L-06): 원 차감을 고치지 않고 반대 부호 행이 쌓이며 잔액이 복원된다
  insert into public.attendance_corrections (tenant_id, schedule_id, requester_role, requested_by,
                                             from_attendance, from_deduction, to_attendance,
                                             to_deduct, reason)
    values (t1, sd_a, 'parent', 'RLS 검증 학부모', 'present', 'deducted', 'excused_absence',
            false, '진단서 제출');
  res := public.decide_attendance_correction(
           t1,
           (select id from public.attendance_corrections
             where tenant_id = t1 and schedule_id = sd_a and status = 'pending' limit 1),
           true, 'rls@test', '증빙 확인');
  select remaining into rem from public.lesson_package_balances
   where tenant_id = t1 and package_id = pk1;
  select count(*) into n from public.session_ledger
   where tenant_id = t1 and schedule_id = sd_a and kind = 'restore' and reverses_id is not null;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('정정 = 조정 이력(L-06)', '차감→무차감 정정 승인 후 잔액·복원 행', '잔액8·복원1건',
          format('잔액%s·복원%s건', rem, n),
          case when rem = 8 and n = 1 then 'PASS' else 'FAIL' end);

  -- (m2) 차감을 유지한 정정이 끼어도 다음 정정에서 원 차감을 찾아 되돌린다(L-06).
  --      차수로 원 차감을 찾으면 correction_count와 기입 차수가 어긋나 잔액만 새는 상태가 된다.
  insert into public.schedules (tenant_id, student_id, scheduled_at, ends_at,
                                package_id, contract_id, status)
    values (t1, st1, now() - interval '20 days', now() - interval '20 days' + interval '1 hour', pk1, ct1, 'planned')
    returning id into sd_d;
  res := public.settle_attendance(t1, sd_d, 'present', true, '', 'rls@test');
  insert into public.attendance_corrections (tenant_id, schedule_id, requester_role, requested_by,
                                             from_attendance, from_deduction, to_attendance,
                                             to_deduct, reason)
    values (t1, sd_d, 'operator', 'RLS 검증 운영자', 'present', 'deducted', 'late', true,
            '실제 시작 시각 확인 — 차감 유지');
  res := public.decide_attendance_correction(
           t1, (select id from public.attendance_corrections
                 where tenant_id = t1 and schedule_id = sd_d and status = 'pending' limit 1),
           true, 'rls@test', '확인');
  insert into public.attendance_corrections (tenant_id, schedule_id, requester_role, requested_by,
                                             from_attendance, from_deduction, to_attendance,
                                             to_deduct, reason)
    values (t1, sd_d, 'parent', 'RLS 검증 학부모', 'late', 'deducted', 'excused_absence', false,
            '진단서 제출');
  res := public.decide_attendance_correction(
           t1, (select id from public.attendance_corrections
                 where tenant_id = t1 and schedule_id = sd_d and status = 'pending' limit 1),
           true, 'rls@test', '증빙 확인');
  select coalesce(sum(delta), 0) into n from public.session_ledger
   where tenant_id = t1 and schedule_id = sd_d;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('반복 정정 잔액(L-06)', '차감 유지 정정 후 무차감 정정 — 회차 원장 합', 'restored=true·합0',
          format('restored=%s·합%s', res ->> 'restored', n),
          case when (res ->> 'restored')::boolean and n = 0 then 'PASS' else 'FAIL' end);

  -- (m3) 정정이 출결 확정 게이트의 뒷문이 되지 않는다(L-06 "원 기록 확인" · L-04 노쇼 게이트)
  insert into public.schedules (tenant_id, student_id, scheduled_at, ends_at,
                                package_id, contract_id, status)
    values (t1, st1, now() + interval '52 days', now() + interval '52 days 1 hour', pk1, ct1, 'planned')
    returning id into sd_e;
  insert into public.attendance_corrections (tenant_id, schedule_id, requester_role, requested_by,
                                             to_attendance, to_deduct, reason)
    values (t1, sd_e, 'operator', 'RLS 검증 운영자', 'noshow', true, '미확정 회차 우회 시도');
  res := public.decide_attendance_correction(
           t1, (select id from public.attendance_corrections
                 where tenant_id = t1 and schedule_id = sd_e and status = 'pending' limit 1),
           true, 'rls@test', '');
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('정정 게이트 우회 차단(L-06)', '미확정 회차를 정정 승인으로 확정', 'ok=false',
          coalesce(res ->> 'reason', 'ok=true(위반)'),
          case when (res ->> 'reason') = 'not_settled' then 'PASS' else 'FAIL' end);

  insert into public.attendance_corrections (tenant_id, schedule_id, requester_role, requested_by,
                                             from_attendance, from_deduction, to_attendance,
                                             to_deduct, reason)
    values (t1, sd_d, 'operator', 'RLS 검증 운영자', 'excused_absence', 'waived', 'noshow', true,
            '연락 기록 없이 노쇼 우회 시도');
  res := public.decide_attendance_correction(
           t1, (select id from public.attendance_corrections
                 where tenant_id = t1 and schedule_id = sd_d and status = 'pending' limit 1),
           true, 'rls@test', '');
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('정정 게이트 우회 차단(L-04)', '연락 기록 없이 노쇼로 정정 승인', 'ok=false',
          coalesce(res ->> 'reason', 'ok=true(위반)'),
          case when (res ->> 'reason') = 'noshow_gate' then 'PASS' else 'FAIL' end);

  -- (n) 심사 중 정정은 회차당 하나(L-06)
  insert into public.attendance_corrections (tenant_id, schedule_id, requester_role, requested_by,
                                             to_attendance, reason)
    values (t1, sd_c, 'operator', 'RLS 검증 운영자', 'present', '첫 요청');
  blocked := false;
  begin
    insert into public.attendance_corrections (tenant_id, schedule_id, requester_role, requested_by,
                                               to_attendance, reason)
      values (t1, sd_c, 'operator', 'RLS 검증 운영자', 'absent', '두 번째 요청');
  exception when unique_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('정정 단일 심사(L-06)', '같은 회차에 두 번째 pending 정정', '차단(부분 유니크)',
          case when blocked then '차단됨' else '중복 접수(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (o) 연락 기록 append-only(L-04): 시각·경로·결과는 사후에 바뀌지 않는다
  insert into public.attendance_contacts (tenant_id, schedule_id, minute_mark, channel, result)
    values (t1, sd_c, 10, 'call', 'no_answer');
  blocked := false;
  begin
    update public.attendance_contacts set result = 'reached'
     where tenant_id = t1 and schedule_id = sd_c;
  exception when others then blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('연락 기록 append-only(L-04)', 'attendance_contacts result UPDATE', '차단(트리거 예외)',
          case when blocked then '차단됨' else '허용됨(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (p) 예약 제한은 학생당 하나(L-08). 자동 생성 경로는 없고 이 INSERT가 유일한 경로다.
  insert into public.booking_restrictions (tenant_id, student_id, reason, review_on, decided_by)
    values (t1, st1, 'RLS 검증 제한', current_date + 30, 'rls@test');
  blocked := false;
  begin
    insert into public.booking_restrictions (tenant_id, student_id, reason, review_on, decided_by)
      values (t1, st1, '중복 제한 시도', current_date + 30, 'rls@test');
  exception when unique_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('예약 제한 단일성(L-08)', '같은 학생에게 두 번째 활성 제한', '차단(부분 유니크)',
          case when blocked then '차단됨' else '중복 제한(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (q) 해제에는 해제자·시각·사유가 함께 있어야 한다(자동 만료 없음 — 사람이 푼다)
  blocked := false;
  begin
    update public.booking_restrictions set status = 'lifted'
     where tenant_id = t1 and student_id = st1 and status = 'active';
  exception when check_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('예약 제한 해제(L-08)', '해제자·사유 없는 lifted UPDATE', '차단(check)',
          case when blocked then '차단됨' else '허용됨(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (q2) 잔액 뷰도 RLS를 우회하지 않는다. 뷰는 기본이 definer 권한이라 그대로 두면 테넌트 정책을
  --      건너뛰는 조회 경로가 하나 더 생긴다 — security_invoker로 호출자 권한 평가를 강제한다.
  perform set_config('request.jwt.claims',
                     json_build_object('tenant_id', t1)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.lesson_package_balances where tenant_id <> t1;
  execute 'reset role';
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('잔액 뷰 테넌트 경계', 'authenticated(T1)가 보는 타테넌트 잔액 행', '0',
          n::text, case when n = 0 then 'PASS' else 'FAIL' end);

  -- (s) 취소된 슬롯은 부활하지 않는다(적대적 검토 high①). 취소를 슬롯 유니크에서 빼면 회차를
  --     더 만들려고 후보를 다시 펼칠 때 그 시각이 planned로 되살아나, 취소 차감과 부활 회차
  --     차감이 원장에 둘 다 남는다(L-05 "이중 차감 금지").
  insert into public.schedules (tenant_id, student_id, scheduled_at, ends_at,
                                package_id, contract_id, status)
    values (t1, st1, now() + interval '60 days', now() + interval '60 days 1 hour', pk1, ct1, 'planned')
    returning id into sd_f;
  res := public.cancel_schedule(t1, sd_f, true, '학부모 요청 — 차감 취소', 'rls@test');
  res := public.generate_package_sessions(t1, pk1, jsonb_build_array(
    jsonb_build_object('at', (now() + interval '60 days')::text,
                       'ends_at', (now() + interval '60 days 1 hour')::text)
  ), 'rls@test');
  select count(*) into n from public.schedules
   where tenant_id = t1 and package_id = pk1 and scheduled_at = (
     select scheduled_at from public.schedules where id = sd_f);
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('취소 슬롯 부활 차단(L-05)', '차감 취소한 시각으로 후보 재생성', 'skipped=1·같은 시각 1건',
          format('skipped=%s·%s건', res ->> 'skipped', n),
          case when (res ->> 'skipped') = '1' and n = 1 then 'PASS' else 'FAIL' end);

  -- (t) append-only 트리거가 CASCADE를 막지 않는다(적대적 검토 high②). 막으면 회차·학생 삭제가
  --     통째로 실패해 D 도메인 파기 흐름이 진행되지 못한다.
  insert into public.schedules (tenant_id, student_id, scheduled_at, ends_at,
                                package_id, contract_id, status)
    values (t1, st1, now() + interval '62 days', now() + interval '62 days 1 hour', pk1, ct1, 'planned')
    returning id into sd_g;
  insert into public.attendance_contacts (tenant_id, schedule_id, minute_mark, channel, result)
    values (t1, sd_g, 10, 'call', 'no_answer');
  insert into public.session_ledger (tenant_id, package_id, schedule_id, kind, delta,
                                     correction_no, reason)
    values (t1, pk1, sd_g, 'deduct', -1, 0, '삭제 연쇄 검증용');
  blocked := false;
  begin
    delete from public.schedules where tenant_id = t1 and id = sd_g;
  exception when others then blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('삭제 연쇄 허용', '연락 기록·원장이 달린 회차 삭제', '성공(트리거가 막지 않음)',
          case when blocked then '차단됨(파기 흐름 막힘)' else '성공' end,
          case when blocked then 'FAIL' else 'PASS' end);

  -- (u) 시작 전 회차는 확정하지 않는다(적대적 검토 medium④ · L-03 전환 순서)
  insert into public.schedules (tenant_id, student_id, scheduled_at, ends_at,
                                package_id, contract_id, status)
    values (t1, st1, now() + interval '64 days', now() + interval '64 days 1 hour', pk1, ct1, 'planned')
    returning id into sd_h;
  res := public.settle_attendance(t1, sd_h, 'present', true, '', 'rls@test');
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('미래 회차 확정 차단(L-03)', '아직 시작하지 않은 회차의 출결 확정', 'ok=false',
          coalesce(res ->> 'reason', 'ok=true(위반)'),
          case when (res ->> 'reason') = 'not_started' then 'PASS' else 'FAIL' end);

  -- (v) 연락 시각도 게이트다(적대적 검토 medium③). 수업 전에 세 건을 미리 찍어두면
  --     "10분→20분→30분 연락"이라는 정본의 순서가 뜻을 잃는다.
  insert into public.schedules (tenant_id, student_id, scheduled_at, ends_at,
                                package_id, contract_id, status)
    values (t1, st1, now() - interval '2 hours', now() - interval '1 hour', pk1, ct1, 'planned')
    returning id into sd_i;
  insert into public.attendance_contacts (tenant_id, schedule_id, minute_mark, channel,
                                          result, contacted_at)
    values (t1, sd_i, 10, 'call', 'no_answer', now() - interval '5 hours'),
           (t1, sd_i, 20, 'call', 'no_answer', now() - interval '5 hours'),
           (t1, sd_i, 30, 'call', 'no_answer', now() - interval '5 hours');
  res := public.settle_attendance(t1, sd_i, 'noshow', true, '', 'rls@test');
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('노쇼 연락 시각 게이트(L-04)', '수업 전에 미리 찍은 연락 3건으로 노쇼 확정', 'ok=false',
          coalesce(res ->> 'reason', 'ok=true(위반)'),
          case when (res ->> 'reason') = 'noshow_contacts_incomplete' then 'PASS' else 'FAIL' end);

  -- (w) 종료된 묶음의 회차는 잔액을 움직이지 않는다(적대적 검토 high④ · 검수 45)
  select remaining into rem from public.lesson_package_balances
   where tenant_id = t1 and package_id = pk1;
  update public.lesson_packages set status = 'ended', ended_at = now(), end_reason = '검증'
   where tenant_id = t1 and id = pk1;
  res := public.settle_attendance(t1, sd_i, 'present', true, '', 'rls@test');
  select remaining into n from public.lesson_package_balances
   where tenant_id = t1 and package_id = pk1;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('종료 묶음 차감 차단(검수 45)', '종료된 묶음의 회차를 차감 확정', 'ok=false·잔액 불변',
          format('%s·%s→%s', coalesce(res ->> 'reason', 'ok=true(위반)'), rem, n),
          case when (res ->> 'ok')::boolean is not true and rem = n then 'PASS' else 'FAIL' end);
  update public.lesson_packages set status = 'active', ended_at = null, end_reason = null
   where tenant_id = t1 and id = pk1;

  -- (x) 회차 부여 중복 차단(적대적 검토 medium⑥): 같은 증감·같은 사유의 재전송은 근거 없는 잔액이다.
  insert into public.session_ledger (tenant_id, package_id, kind, delta, reason, actor_email)
    values (t1, pk1, 'grant', 2, '이벤트 서비스 회차', 'rls@test');
  blocked := false;
  begin
    insert into public.session_ledger (tenant_id, package_id, kind, delta, reason, actor_email)
      values (t1, pk1, 'grant', 2, '이벤트 서비스 회차', 'rls@test');
  exception when unique_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('회차 부여 중복 차단', '같은 증감·같은 사유 재전송', '차단(부분 유니크)',
          case when blocked then '차단됨' else '중복 부여(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (y) 묶음의 계약·등록·학생 조합 정합(적대적 검토 medium②): 남의 계약에 묶인 묶음은 만들 수 없다.
  insert into public.students (tenant_id, name, parent_phone)
    values (t1, 'RLS 검증 타학생', '01099990000')
    returning id into st2;
  -- 계약당 살아 있는 묶음 유니크가 먼저 걸리면 조합 FK를 검증하지 못한다 — 새 계약본을 쓴다.
  insert into public.contracts (tenant_id, enrollment_id, terms)
    values (t1, en1, '{"note":"조합 정합 검증용 미동의 계약본"}'::jsonb)
    returning id into ct2;
  blocked := false;
  begin
    insert into public.lesson_packages (tenant_id, enrollment_id, contract_id, student_id,
                                        total_sessions, starts_on)
      values (t1, en1, ct2, st2, 4, current_date);
  exception when foreign_key_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('묶음 조합 정합(L-10)', '다른 학생을 이 등록의 계약에 묶기', '차단(복합 FK)',
          case when blocked then '차단됨' else '허용됨(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);

  -- (r) 테넌트 경계: 복합 FK가 타테넌트 계약에 묶인 묶음을 막는다
  blocked := false;
  begin
    insert into public.lesson_packages (tenant_id, enrollment_id, contract_id, student_id,
                                        total_sessions, starts_on)
      values (t1, en1,
              (select id from public.contracts
                where tenant_id = '00000000-0000-0000-0000-000000000002' limit 1),
              st1, 4, current_date);
  exception when foreign_key_violation then blocked := true;
    when others then blocked := false;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('묶음 테넌트 경계', 'T1 묶음이 T2 계약을 참조', '차단(복합 FK)',
          case when blocked then '차단됨' else '허용됨(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 8x. security definer RPC의 anon·authenticated 실행 차단 (00011 계열 회귀) ─────────
   새 함수의 proacl은 NULL로 남고 NULL은 acldefault로 해석되는데 거기엔 PUBLIC EXECUTE가 있다.
   revoke를 빠뜨리면 apikey(anon)만으로 /rest/v1/rpc/<fn> 을 호출할 수 있고, 이 함수들은 전부
   security definer라 RLS까지 우회한다 — 00011이 정확히 그 사고를 겪고 쓰인 마이그레이션이다.
   새 RPC가 추가될 때마다 여기에 이름을 더한다. */
do $$
declare
  fn text;
  leaked text[] := '{}';
  fns constant text[] := array[
    'admin_replace_operator', 'close_homework_assignment', 'retract_homework_assignment',
    'accept_portal_link', 'activate_enrollment', 'offer_waitlist_seat',
    'activate_lesson_package', 'generate_package_sessions', 'settle_attendance',
    'cancel_schedule', 'create_makeup', 'decide_attendance_correction',
    'resolve_schedule_contract', 'schedule_span',
    'activity_log_append_only', 'append_only_reject',
    'session_ledger_append_only', 'attendance_contacts_append_only'
  ];
begin
  select coalesce(array_agg(distinct p.proname order by p.proname), '{}')
    into leaked
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = any(fns)
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE'));

  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('RPC 실행 권한(00011 계열)', 'anon·authenticated가 실행 가능한 security definer RPC', '0개',
          case when array_length(leaked, 1) is null
               then '0개'
               else array_length(leaked, 1) || '개 (' || array_to_string(leaked, ', ') || ')' end,
          case when array_length(leaked, 1) is null then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 8y. 감사 append-only가 테넌트 CASCADE를 막지 않는다 ─────────
   트리거는 FK 캐스케이드로 내부 발생하는 DELETE에도 붙는다. 탈출구가 없으면 tenants 1행 삭제가
   activity_log·adjustments 캐스케이드에서 예외를 맞고 전체 롤백돼, 테넌트 오프보딩이 조용히
   불가능해진다. 동시에 "부모가 살아 있는 상태의 직접 삭제"는 여전히 막혀야 한다. */
do $$
declare
  t1 constant uuid := '00000000-0000-0000-0000-000000000001';
  t_tmp uuid;
  blocked boolean;
begin
  insert into public.tenants (brand_name, email, subdomain)
    values ('RLS 캐스케이드 검증', 'probe@example.com', 'rls-cascade-probe')
    returning id into t_tmp;
  insert into public.activity_log (tenant_id, actor_email, action, target_type, summary)
    values (t_tmp, 'probe@example.com', 'probe', 'tenant', '캐스케이드 검증');
  insert into public.adjustments (tenant_id, domain, target_type, target_id, after_data, reason)
    values (t_tmp, 'money', 'payment', gen_random_uuid(), '{}'::jsonb, '캐스케이드 검증');

  blocked := false;
  begin
    delete from public.tenants where id = t_tmp;
  exception when others then blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('감사 CASCADE 허용', '감사 이력이 달린 테넌트 삭제', '성공(트리거가 막지 않음)',
          case when blocked then '차단됨(오프보딩 불가)' else '성공' end,
          case when blocked then 'FAIL' else 'PASS' end);

  -- 부모가 살아 있으면 직접 삭제는 여전히 거부돼야 한다(탈출구가 규칙을 통째로 열지 않았는지).
  insert into public.activity_log (tenant_id, actor_email, action, target_type, summary)
    values (t1, 'probe@example.com', 'probe', 'tenant', '직접 삭제 검증');
  blocked := false;
  begin
    delete from public.activity_log
     where tenant_id = t1 and summary = '직접 삭제 검증';
  exception when others then blocked := true;
  end;
  insert into rls_result (scenario, detail, expected, actual, verdict)
  values ('감사 직접 삭제 차단', '부모 테넌트가 살아 있는 상태의 activity_log DELETE', '차단(트리거 예외)',
          case when blocked then '차단됨' else '허용됨(위반)' end,
          case when blocked then 'PASS' else 'FAIL' end);
end $$;

/* ───────── 9. RLS 활성화 누락 테이블 탐지 (전 테이블 강제) ───────── */
insert into rls_result (scenario, detail, expected, actual, verdict)
select 'RLS 전면 적용', 'RLS 미활성 public 테이블', '0',
       count(*)::text || coalesce(' (' || string_agg(c.relname, ', ') || ')', ''),
       case when count(*) = 0 then 'PASS' else 'FAIL' end
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity
  and c.relname <> '_applied_migrations';

/* ───────── 결과 출력 ───────── */
\set QUIET off
\echo ''
\echo '════════════ RLS 교차 접근 검증 결과 ════════════'
select seq as "#", scenario as "시나리오", detail as "항목",
       expected as "기대", actual as "실제", verdict as "판정"
from rls_result order by seq;

\echo ''
\echo '════════════ 요약 ════════════'
select
  count(*) as "총 검사",
  count(*) filter (where verdict = 'PASS') as "PASS",
  count(*) filter (where verdict = 'FAIL') as "FAIL",
  count(*) filter (where verdict = 'INCONCLUSIVE') as "판정불가",
  case
    when count(*) filter (where verdict = 'FAIL') > 0 then '❌ RLS 위반 발견'
    when count(*) filter (where verdict = 'INCONCLUSIVE') > 0
      then '⚠️ 위반 없음. 단 일부 테이블은 타테넌트 데이터 부재로 증명되지 않음'
    else '✅ 교차 접근 0건 — 인수 기준 충족(전 테이블 실데이터로 증명)'
  end as "결론"
from rls_result;
