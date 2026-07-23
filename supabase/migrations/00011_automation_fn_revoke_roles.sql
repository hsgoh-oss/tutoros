-- 00011: 크론 전용 함수의 anon·authenticated EXECUTE 회수
--
-- 00002:244-248이 `revoke execute ... from public`을 걸었지만, 이는 PUBLIC 의사롤 grant만
-- 회수한다. Supabase는 alter default privileges로 anon·authenticated에 **명시적** EXECUTE를
-- 부여하므로 그 권한은 그대로 남는다. 실제로 클라우드 proacl이
-- `anon=X/postgres | authenticated=X/postgres`로 확인됐다.
--
-- 결과: 누구나 apikey(anon)만으로 /rest/v1/rpc/automation_call_flush 를 호출해 알림 큐
-- 플러시를, automation_call_edge_function(job_name)으로 임의 자동화 잡을 트리거할 수 있었다.
--
-- 로컬 verify:rls가 이를 못 잡은 이유는 tests/rls/90_grants.sql이 테이블·시퀀스에만 grant를
-- 주고 함수엔 주지 않아, 차단이 revoke 덕분인지 grant 부재 탓인지 구별하지 못했기 때문이다
-- (같은 커밋에서 90_grants.sql도 함께 고친다).
revoke execute on function public.automation_call_edge_function(text) from anon, authenticated;
revoke execute on function public.automation_call_flush() from anon, authenticated;
revoke execute on function public.automation_payment_overdue_flag() from anon, authenticated;
revoke execute on function public.automation_content_backup_daily() from anon, authenticated;
revoke execute on function public.automation_schedule_autoclean() from anon, authenticated;

-- 앞으로 추가되는 public 함수도 기본적으로 노출되지 않게 한다.
-- (postgres 롤이 만드는 함수에 대한 기본 EXECUTE 부여를 끊는다)
-- 실행 롤 기준으로 걸어 로컬(superuser)·클라우드(postgres) 양쪽에서 동일하게 동작한다.
alter default privileges in schema public
  revoke execute on functions from anon, authenticated;
