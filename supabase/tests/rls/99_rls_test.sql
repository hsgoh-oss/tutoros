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
  tables constant text[] := array[
    'site_settings','theme_settings','ddays','recruit_status','page_contents',
    'students','reviews','faqs','lessons','ai_reports','schedules','grade_records',
    'lesson_materials','payments','consultations','consents','notifications','backups'
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
