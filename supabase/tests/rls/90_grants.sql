-- 마이그레이션 적용 후 테이블 권한 부여 (Supabase가 기본 제공하는 것과 동일).
-- 이걸 줘야 RLS "정책"이 실제로 평가된다. 권한 자체가 없으면 RLS 이전에 permission denied로 막혀
-- "차단됨"이 RLS 덕분인지 grant 부재 탓인지 구별할 수 없다 — 테스트를 무의미하게 만드는 함정.
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
