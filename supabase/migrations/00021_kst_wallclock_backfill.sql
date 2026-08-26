-- 00021: 운영자 입력 시각의 KST 보정 (표시·저장 양쪽 시각 버그의 데이터 잔재 정리)
--
-- 배경: 서버(Vercel)는 UTC로 돈다. 그런데
--   · 저장: `new Date("2026-07-20T19:01")`이 **서버 로컬(=UTC)**로 해석돼 19:01Z로 들어갔다.
--           운영자가 뜻한 값은 KST 19:01 = 10:01Z다 → 9시간 늦게 저장됨.
--   · 표시: `Date#getHours()`가 UTC를 돌려줘 19:01Z를 "19:01"로 그렸다 → 9시간 빠르게 표시됨.
-- 두 오류가 관리자 화면 안에서만 서로 상쇄돼 정상처럼 보였고, KST를 제대로 계산하는 쪽
-- (ICS/CSV 내보내기·SQL 일자 경계·학부모 캘린더)과 어긋났다. 같은 회차가 화면에서는 19:01,
-- 내보낸 캘린더에서는 04:01로 갈렸다.
--
-- 코드는 lib/kst.ts로 양쪽을 함께 고쳤다(저장은 KST 벽시계 → UTC, 표시는 UTC → KST).
-- 그러면 **이 마이그레이션 이전에 저장된 행만** 9시간 늦은 값으로 남는다. 여기서 그걸 되돌린다.
-- 보정 후 운영자가 보는 시각은 바뀌지 않는다(19:01 → 19:01) — 저장된 절대 시각만 옳아진다.
--
-- 왜 id로 특정하는가: 코드 배포와 이 마이그레이션 사이에 새 회차가 생기면 그건 이미 올바르게
-- 저장된 값이라 보정 대상이 아니다. "전부 -9시간" 같은 조건은 그 창에서 생긴 행을 망가뜨린다.
-- 대상은 판정 시점(2026-08-26)의 운영 DB 전수이며 2건뿐이라 열거가 가장 안전하다.
--
-- 참고: 운영자 입력 시각을 담는 다른 컬럼(schedules.ends_at·actual_started_at·actual_ended_at,
-- trial_sessions.scheduled_at·attended_at)은 판정 시점 전부 비어 있어 보정 대상이 없다.
-- DB가 채우는 시각(created_at·sent_at·consented_at 등)은 처음부터 올바른 UTC라 건드리지 않는다.

do $$
declare
  v_ids uuid[] := array[
    '5e8c83e0-ea73-40c3-bd5c-417db1537a86',  -- 김설원 2026-07-20 19:01 KST (저장 19:01Z → 10:01Z)
    '6aca6c26-e616-4ac9-9cd8-f433457eabc8'   -- E2E학생fcbbb34-6 2026-07-30 09:00 KST
  ]::uuid[];
  v_moved int;
begin
  -- 재실행 안전: 이미 보정된 행을 두 번 당기지 않도록, 아직 안 옮긴 행만 고른다.
  -- 판정 시점의 원본 값과 정확히 일치할 때만 옮긴다.
  update public.schedules s
     set scheduled_at = s.scheduled_at - interval '9 hours'
   where s.id = any(v_ids)
     and (
       (s.id = '5e8c83e0-ea73-40c3-bd5c-417db1537a86' and s.scheduled_at = timestamptz '2026-07-20 19:01:00+00')
       or
       (s.id = '6aca6c26-e616-4ac9-9cd8-f433457eabc8' and s.scheduled_at = timestamptz '2026-07-30 09:00:00+00')
     );
  get diagnostics v_moved = row_count;

  raise notice '[00021] scheduled_at KST 보정: % 건 이동(대상 %)', v_moved, array_length(v_ids, 1);

  -- 남아 있으면 안 되는 값이 있는지 확인 — 있으면 사람이 봐야 한다.
  if exists (
    select 1 from public.schedules
     where scheduled_at in (timestamptz '2026-07-20 19:01:00+00', timestamptz '2026-07-30 09:00:00+00')
       and id = any(v_ids)
  ) then
    raise exception '[00021] 보정되지 않은 회차가 남았습니다 — 수동 확인 필요';
  end if;
end $$;
