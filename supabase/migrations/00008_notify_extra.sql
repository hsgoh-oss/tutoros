-- 알림 발송 이력 보강 (기획서 7-14 "전 발송 이력 로그 — 채널·상태·실패 사유·재시도").
-- 기존 notifications는 채널·상태·retry_count까지만 남겼다. 실패 사유(error)를 추가해
-- 알림톡/SMS 실패 원인을 이력에 보존한다. RLS는 00001의 tenant_isolation이 그대로 적용된다.

alter table public.notifications
  add column if not exists error text;
