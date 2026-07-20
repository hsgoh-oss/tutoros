-- 00005: 자동화 4종 추가 스케줄 (기획 7-9 ④후기요청·⑥월간리포트·⑦D-day재계산·⑧발송실패재시도)
-- 모두 automation 엣지 함수의 job — 00002의 automation_call_edge_function 헬퍼로 스케줄한다.
-- 시각은 KST 기준(괄호 UTC). pg_cron 미설치 시 전체 스킵(00002와 동일 방어).

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '[automation] pg_cron 미설치 — 추가 크론 4종 등록 생략. pg_cron 활성화 후 재적용하세요.';
    return;
  end if;

  -- ④ review_request — 매일 11:00 KST (02:00 UTC): 첫 수업 4주 경과 학생 후기 요청
  perform cron.schedule('review_request', '0 2 * * *',
    $c$select public.automation_call_edge_function('review_request');$c$);

  -- ⑥ monthly_report_draft — 매월 1일 09:00 KST (1일 00:00 UTC): 월간 리포트 초안 트리거
  perform cron.schedule('monthly_report_draft', '0 0 1 * *',
    $c$select public.automation_call_edge_function('monthly_report_draft');$c$);

  -- ⑦ dday_recalc — 매일 00:20 KST (전일 15:20 UTC): 경과 시험 자동 숨김
  perform cron.schedule('dday_recalc', '20 15 * * *',
    $c$select public.automation_call_edge_function('dday_recalc');$c$);

  -- ⑧ notify_retry — 매시 40분(flush(:10)와 엇갈리게): 발송 실패 재큐잉
  perform cron.schedule('notify_retry', '40 * * * *',
    $c$select public.automation_call_edge_function('notify_retry');$c$);
end
$$;
