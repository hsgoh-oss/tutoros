-- 00009: 후기 게시 동의 기록 대상 확장 (기획 7-17 동의 아키텍처 — "후기 게시 / 게시 동의 / 관리자 화면")
-- 후기는 학생 레코드에 연결되지 않을 수 있어, 동의의 subject를 후기 자체로 두도록 subject_type에 'review'를 추가한다.
-- (subject_id = reviews.id, item = 'review')
alter table public.consents drop constraint consents_subject_type_check;
alter table public.consents add constraint consents_subject_type_check
  check (subject_type in ('consultation', 'student', 'guardian', 'review'));
