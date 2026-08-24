-- 교차 접근 검증 픽스처: 계정별 22개 테이블(00001의 18개 + activity_log·adjustments·work_items
-- + payssam_events(00014)) 전부에 타테넌트(T2) 행을 1건씩 심는다.
-- 이게 없으면 "타테넌트 행 0건"이 RLS 덕분인지 데이터가 없어서인지 구별할 수 없다.
-- (seed.sql은 faqs·students·recruit_status에만 T2 행을 넣는다)

do $$
declare
  t2 constant uuid := '00000000-0000-0000-0000-000000000002';
  s2 uuid;
  p2 uuid;
begin
  select id into strict s2 from public.students where tenant_id = t2 limit 1;

  insert into public.site_settings (tenant_id, key, value)
    values (t2, 'site_info', '{"brandName":"테스트 영어과외"}'::jsonb)
    on conflict (tenant_id, key) do nothing;

  insert into public.theme_settings (tenant_id) values (t2)
    on conflict do nothing;

  insert into public.ddays (tenant_id, name, exam_date)
    values (t2, 'T2 전용 시험', '2026-12-01');

  insert into public.page_contents (tenant_id, page, section)
    values (t2, 'home', 'hero')
    on conflict do nothing;

  insert into public.reviews (tenant_id, reviewer_type, content)
    values (t2, 'parent', 'T2 전용 후기 — 교차 노출 시 RLS 위반');

  insert into public.lessons (tenant_id, student_id, lesson_date)
    values (t2, s2, '2026-07-01');

  insert into public.ai_reports (tenant_id, student_id, type)
    values (t2, s2, 'lesson');

  insert into public.schedules (tenant_id, student_id, scheduled_at)
    values (t2, s2, now());

  insert into public.grade_records (tenant_id, student_id, exam_name)
    values (t2, s2, 'T2 전용 모의고사');

  insert into public.lesson_materials (tenant_id, name, file_url)
    values (t2, 'T2 전용 자료.pdf', 'https://example.com/t2.pdf');

  -- 00014 신설 컬럼(청구 발송·승인 스냅샷)까지 채워 스키마와 CHECK를 함께 검증한다.
  insert into public.payments (tenant_id, student_id, period_start, period_end, amount, method,
                               status, bill_id, bill_short_url, bill_sent_at,
                               appr_state, appr_num, appr_dt, appr_price, appr_issuer, last_synced_at)
    values (t2, s2, '2026-07-01', '2026-07-28', 480000, 'payssaem',
            'paid', 'T2BILL0000000000001', 'https://pssam.kr/t2', now(),
            'F', 'T2-APPR-0001', now(), 480000, 'T2카드', now())
    returning id into p2;

  insert into public.consultations (tenant_id, name, phone)
    values (t2, 'T2 전용 상담자', '010-0000-0002');

  insert into public.consents (tenant_id, subject_type, subject_id, item)
    values (t2, 'student', s2, 'privacy');

  insert into public.notifications (tenant_id, student_id, type, phone, message)
    values (t2, s2, 'consult_received', '010-0000-0002', 'T2 전용 알림');

  insert into public.backups (tenant_id, target, snapshot)
    values (t2, 'settings:daily', '{"brandName":"테스트 영어과외"}'::jsonb);

  -- 00013 신설 3종(테넌트 정책 계열) — 교차노출 스캔 대상에 포함되므로 T2 행이 필요하다.
  insert into public.activity_log (tenant_id, actor_email, action, target_type, summary, category, phase)
    values (t2, 'test-english@example.com', 'update', 'faq',
            'T2 전용 감사 로그 — 교차 노출 시 RLS 위반', 'other', 'committed');

  insert into public.adjustments (tenant_id, domain, target_type, target_id, after_data, reason, actor_email)
    values (t2, 'grade', 'grade_record', s2, '{"grade":"1등급"}'::jsonb,
            'T2 전용 조정 이력 — 교차 노출 시 RLS 위반', 'test-english@example.com');

  insert into public.work_items (tenant_id, kind, title, source_type, source_id, next_action)
    values (t2, 'manual', 'T2 전용 업무 — 교차 노출 시 RLS 위반', 'manual', s2::text, 'T2 확인');

  -- payssam_events(00014) — 승인 통보 원장도 테넌트 정책 계열이라 교차노출 스캔 대상.
  insert into public.payssam_events
      (tenant_id, payment_id, bill_id, event_type, appr_state, appr_num, appr_price, payload, outcome, note)
    values (t2, p2, 'T2BILL0000000000001', 'callback', 'F', 'T2-APPR-0001', 480000,
            '{"billId":"T2BILL0000000000001","apprState":"F","apprNum":"T2-APPR-0001","apprPrice":"480000"}'::jsonb,
            'applied', 'T2 전용 승인 통보 — 교차 노출 시 RLS 위반');

  -- admin_otps는 tenant_isolation 정책이 없다(service_role 전용). 행을 심어야
  -- "authenticated가 0건을 본다"가 데이터 부재가 아닌 실제 차단임을 증명할 수 있다.
  insert into public.admin_otps (tenant_id, email, code_hash, expires_at)
    values (t2, 'test-english@example.com', 'dummy-hash', now() + interval '10 minutes')
    on conflict (tenant_id, email) do nothing;

  -- admin_sessions(00013)도 같은 범주 — 정책 없는 RLS(service_role 전용) 검증용 행.
  insert into public.admin_sessions (tenant_id, email, token_hash, expires_at)
    values (t2, 'test-english@example.com', 'dummy-session-hash-t2', now() + interval '12 hours')
    on conflict (token_hash) do nothing;
end $$;
