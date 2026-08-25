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
  -- 00001의 18개 + 테넌트 정책 계열 7개(activity_log(00006)·adjustments·work_items(00013)
  -- ·payssam_events(00014)·homework_assignments·homework_submissions·homework_questions(00015))
  tables constant text[] := array[
    'site_settings','theme_settings','ddays','recruit_status','page_contents',
    'students','reviews','faqs','lessons','ai_reports','schedules','grade_records',
    'lesson_materials','payments','consultations','consents','notifications','backups',
    'activity_log','adjustments','work_items','payssam_events',
    'homework_assignments','homework_submissions','homework_questions'
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
