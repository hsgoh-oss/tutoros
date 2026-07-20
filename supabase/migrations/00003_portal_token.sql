-- 00003: 네이티브 학생/학부모 리포트 포털 토큰 (Notion API 대체 — 기획 7-10)
-- 각 학생마다 추측 불가한 토큰 1개. /portal/{token}에서 승인된 리포트를 읽기 전용 조회한다.
-- (pgcrypto는 00001에서 이미 설치됨 — gen_random_bytes 사용)

alter table public.students
  add column portal_token text unique;

-- 기존 학생 백필
update public.students
  set portal_token = encode(gen_random_bytes(16), 'hex')
  where portal_token is null;

-- 신규 학생 자동 발급(앱이 값을 넣지 않아도 DB가 보장) + NOT NULL 확정.
-- 128비트 랜덤(hex 32자) — URL-safe, 충돌 확률 무시 가능.
alter table public.students
  alter column portal_token set default encode(gen_random_bytes(16), 'hex'),
  alter column portal_token set not null;
