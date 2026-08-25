-- 교차 접근 검증 픽스처: 계정별 30개 테이블(00001의 18개 + activity_log·adjustments·work_items
-- + payssam_events(00014) + homework_assignments·homework_submissions·homework_questions(00015)
-- + trial_sessions·trial_results·enrollments·contracts·waitlist_offers(00018)
-- + lesson_packages·session_ledger·attendance_contacts·attendance_corrections
--   ·booking_restrictions(00020))
-- 전부에 타테넌트(T2) 행을 1건씩 심는다.
-- 이게 없으면 "타테넌트 행 0건"이 RLS 덕분인지 데이터가 없어서인지 구별할 수 없다.
-- (seed.sql은 faqs·students·recruit_status에만 T2 행을 넣는다)
-- 00016 신설 컬럼(후기 상태·보고서 철회·대체 연결·성적 소프트 삭제)까지 채워
-- 스키마와 CHECK·복합 FK를 함께 검증한다(00014 payments 확장과 동일 취지).
-- 00017 신설 4종(portal_contacts·portal_relations·portal_access_links·portal_sessions)과
-- 00018 intake_forms는 정책 없는 RLS 계열이라 교차노출 스캔이 아닌 8n·8r(전면 차단) 검증의
-- 실데이터로 쓰인다.

do $$
declare
  t2 constant uuid := '00000000-0000-0000-0000-000000000002';
  s2 uuid;
  p2 uuid;
  a2 uuid;
  r2 uuid;
  c2 uuid;
  pr2 uuid;
  cs2 uuid;
  fm2 uuid;
  tn2 uuid;
  en2 uuid;
  ct2 uuid;
  pk2 uuid;
  sd2 uuid;
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

  -- 00016 ③: 승인 게시 흐름 컬럼(status·approved_at)까지 채워 CHECK를 함께 검증한다
  insert into public.reviews (tenant_id, reviewer_type, content, status, approved_at)
    values (t2, 'parent', 'T2 전용 후기 — 교차 노출 시 RLS 위반', 'published', now());

  insert into public.lessons (tenant_id, student_id, lesson_date)
    values (t2, s2, '2026-07-01');

  -- 00016 ②: 철회·이전본 대체 표시 — 새 본(approved)을 먼저 만들고 철회된 원 본이
  -- superseded_by로 가리키게 해 자기참조 복합 FK(테넌트 일치)까지 함께 검증한다
  insert into public.ai_reports (tenant_id, student_id, type, status)
    values (t2, s2, 'lesson', 'approved')
    returning id into r2;

  insert into public.ai_reports (tenant_id, student_id, type, status,
                                 retracted_at, retract_reason, superseded_by)
    values (t2, s2, 'lesson', 'retracted',
            now(), 'T2 전용 철회 보고서 — 교차 노출 시 RLS 위반', r2);

  insert into public.schedules (tenant_id, student_id, scheduled_at)
    values (t2, s2, now());

  insert into public.grade_records (tenant_id, student_id, exam_name)
    values (t2, s2, 'T2 전용 모의고사');

  -- 00016 ①: 소프트 삭제 컬럼(deleted_at·deleted_reason) — 철회된 결과본도 행으로 남는다
  insert into public.grade_records (tenant_id, student_id, exam_name, deleted_at, deleted_reason)
    values (t2, s2, 'T2 전용 철회 모의고사 — 교차 노출 시 RLS 위반',
            now(), '검증용 소프트 삭제(물리 삭제 금지)');

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
    values (t2, 'T2 전용 상담자', '010-0000-0002')
    returning id into cs2;

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

  -- 00015 신설 3종(과제·제출·질문) — 테넌트 정책 계열이라 교차노출 스캔 대상.
  -- 제출·질문까지 심어 복합 FK(tenant_id, assignment_id)와 CHECK도 함께 검증한다.
  insert into public.homework_assignments (tenant_id, student_id, title, description, status, assigned_at)
    values (t2, s2, 'T2 전용 과제 — 교차 노출 시 RLS 위반', 'T2 과제 설명', 'assigned', now())
    returning id into a2;

  insert into public.homework_submissions (tenant_id, assignment_id, attempt_no, content, late)
    values (t2, a2, 1, 'T2 전용 제출물 — 교차 노출 시 RLS 위반', false);

  insert into public.homework_questions (tenant_id, student_id, assignment_id, question)
    values (t2, s2, a2, 'T2 전용 질문 — 교차 노출 시 RLS 위반');

  -- admin_otps는 tenant_isolation 정책이 없다(service_role 전용). 행을 심어야
  -- "authenticated가 0건을 본다"가 데이터 부재가 아닌 실제 차단임을 증명할 수 있다.
  insert into public.admin_otps (tenant_id, email, code_hash, expires_at)
    values (t2, 'test-english@example.com', 'dummy-hash', now() + interval '10 minutes')
    on conflict (tenant_id, email) do nothing;

  -- admin_sessions(00013)도 같은 범주 — 정책 없는 RLS(service_role 전용) 검증용 행.
  insert into public.admin_sessions (tenant_id, email, token_hash, expires_at)
    values (t2, 'test-english@example.com', 'dummy-session-hash-t2', now() + interval '12 hours')
    on conflict (token_hash) do nothing;

  -- 00017 신설 4종(역할별 포털)도 정책 없는 RLS 계열 — 사람·관계·링크·세션을 T2로 한 벌 심는다.
  -- 행이 있어야 "authenticated·anon이 0건"이 데이터 부재가 아닌 실제 차단임을 증명할 수 있고,
  -- 복합 FK(테넌트 일치)와 CHECK(전화 정규화·상태 정합)도 함께 검증된다.
  insert into public.portal_contacts (tenant_id, name, phone)
    values (t2, 'T2 전용 보호자 — 교차 노출 시 RLS 위반', '01000000002')
    returning id into c2;

  -- 수락까지 끝난 활성 관계(status active면 accepted_at 필수 — 반쪽 수락 금지 CHECK 동반 검증)
  insert into public.portal_relations (tenant_id, contact_id, student_id, role, status, accepted_at)
    values (t2, c2, s2, 'guardian', 'active', now())
    returning id into pr2;

  insert into public.portal_access_links (tenant_id, relation_id, token_hash)
    values (t2, pr2, 'dummy-portal-link-hash-t2');

  insert into public.portal_sessions (tenant_id, contact_id, token_hash, expires_at)
    values (t2, c2, 'dummy-portal-session-hash-t2', now() + interval '30 days');

  -- 00018 신설 6종(유입 퍼널) — 상담 하나에서 폼 → 시범 회차 → 결과 → 등록 → 계약 → 자리 제안까지
  -- 한 줄기로 심는다. intake_forms는 정책 없는 RLS(8r 전면 차단 검증용), 나머지 5종은 테넌트
  -- 정책 계열이라 교차노출 스캔 대상이다. 복합 FK(테넌트 일치)·CHECK(확정 게이트·동의 신원)·
  -- 부분 유니크(활성 폼 1개·활성 등록 1건·자리 1인)도 이 삽입으로 함께 검증된다.
  insert into public.intake_forms (tenant_id, consultation_id, kind, token_hash,
                                   status, payload, submitted_at)
    values (t2, cs2, 'regular', 'dummy-intake-form-hash-t2', 'submitted',
            '{"note":"T2 전용 신청폼 제출 — 교차 노출 시 RLS 위반"}'::jsonb, now())
    returning id into fm2;

  -- 유료 시범 확정본: 결제 행(p2)이 결제 확인의 근거다(is_paid·payment_confirmed·payment_id 동반)
  insert into public.trial_sessions (tenant_id, consultation_id, form_id, scheduled_at,
                                     is_paid, payment_id, schedule_confirmed, payment_confirmed,
                                     status, attended_at)
    values (t2, cs2, fm2, now() - interval '7 days', true, p2, true, true, 'done',
            now() - interval '7 days')
    returning id into tn2;

  insert into public.trial_results (tenant_id, trial_session_id, result, note, decided_by)
    values (t2, tn2, 'regular_offer', 'T2 전용 시범 결과 — 교차 노출 시 RLS 위반',
            'test-english@example.com');

  insert into public.enrollments (tenant_id, student_id, consultation_id, form_id, status,
                                  relation_ok, contract_ok, payment_ok, schedule_ok, activated_at)
    values (t2, s2, cs2, fm2, 'active', true, true, true, true, now())
    returning id into en2;

  insert into public.contracts (tenant_id, enrollment_id, terms,
                                agreed_at, agreed_by_name, agreed_by_phone)
    values (t2, en2, '{"fee":480000,"days":["mon","thu"],"note":"T2 전용 계약 — 교차 노출 시 RLS 위반"}'::jsonb,
            now(), 'T2 전용 계약자', '01000000002')
    returning id into ct2;

  insert into public.waitlist_offers (tenant_id, consultation_id, seat_no, expires_at)
    values (t2, cs2, 1, now() + interval '3 days');

  -- 00020 신설 5종(수업 묶음·회차 원장·출결) — 계약 하나에서 묶음 → 회차 → 원장 → 연락 →
  -- 정정 → 예약 제한까지 한 줄기로 심는다. 전부 테넌트 정책 계열이라 교차노출 스캔 대상이다.
  -- 원장·연락 기록은 append-only 트리거가 걸려 있어 이 삽입 자체가 INSERT 경로 검증이다.
  insert into public.lesson_packages (tenant_id, enrollment_id, contract_id, student_id,
                                      title, total_sessions, unit_price, pattern, starts_on,
                                      status, activated_at)
    values (t2, en2, ct2, s2, 'T2 전용 묶음 — 교차 노출 시 RLS 위반', 8, 60000,
            '{"weekdays":[1,4],"time":"18:00","durationMin":60}'::jsonb,
            current_date, 'active', now())
    returning id into pk2;

  insert into public.schedules (tenant_id, student_id, scheduled_at, ends_at,
                                package_id, contract_id, status)
    values (t2, s2, now() - interval '2 hours', now() - interval '1 hour', pk2, ct2, 'planned')
    returning id into sd2;

  insert into public.session_ledger (tenant_id, package_id, schedule_id, kind, delta,
                                     correction_no, reason, actor_email)
    values (t2, pk2, sd2, 'deduct', -1, 0, 'T2 전용 원장 — 교차 노출 시 RLS 위반',
            'test-english@example.com');

  insert into public.attendance_contacts (tenant_id, schedule_id, minute_mark, channel,
                                          result, actor_email)
    values (t2, sd2, 10, 'call', 'no_answer', 'test-english@example.com');

  insert into public.attendance_corrections (tenant_id, schedule_id, requester_role,
                                             requested_by, from_attendance, to_attendance,
                                             to_deduct, reason)
    values (t2, sd2, 'parent', 'T2 전용 요청자', null, 'excused_absence', false,
            'T2 전용 정정 요청 — 교차 노출 시 RLS 위반');

  insert into public.booking_restrictions (tenant_id, student_id, reason, review_on, decided_by)
    values (t2, s2, 'T2 전용 예약 제한 — 교차 노출 시 RLS 위반',
            current_date + 30, 'test-english@example.com');
end $$;
