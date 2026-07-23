-- Supabase 런타임 shim — 로컬 Postgres에서 마이그레이션/RLS를 그대로 검증하기 위한 최소 재현.
-- 프로덕션 마이그레이션은 건드리지 않는다. 정의는 Supabase 실제 구현과 동일하게 맞춘다.

create extension if not exists pgcrypto;

-- Supabase auth.jwt(): PostgREST가 설정한 request.jwt.claims GUC를 jsonb로 반환.
create schema if not exists auth;
create or replace function auth.jwt()
returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

-- Supabase 기본 역할. service_role은 실제로도 BYPASSRLS 속성을 가진다.
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
-- RLS 정책이 auth.jwt()를 호출하므로 두 역할 모두 auth 스키마를 쓸 수 있어야 한다(Supabase 기본값).
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;

-- Supabase는 alter default privileges로 새로 만들어지는 public 함수에 anon·authenticated
-- EXECUTE를 자동 부여한다. 이걸 재현하지 않으면 "크론 함수 실행 차단" 테스트가 revoke 덕분이
-- 아니라 grant 부재 탓에 통과해 버린다(실제로 그래서 00011 결함을 놓쳤다).
-- 마이그레이션보다 먼저 걸어야 이후 create function들이 이 기본 권한을 받는다.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
