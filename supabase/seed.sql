-- TUTOR OS 시드 — 1호 테넌트(AXIOM MATH LAB) 실콘텐츠 + 교차 접근 검증용 테스트 테넌트 2개.
-- lib/defaults.ts와 동일 원천 — 수정 시 양쪽 정합 유지.
-- 신규 DB(supabase db reset) 전용: ddays·reviews·faqs·students는 자연키가 없어 재실행 시 중복된다.

/* ---------- 테넌트 ---------- */

insert into public.tenants (id, brand_name, email, plan, plan_status, custom_domain, subdomain)
values
  ('00000000-0000-0000-0000-000000000001', 'AXIOM MATH LAB', 'hsgoh05@gmail.com', 'pro', 'active', 'axiommathlab.kr', 'axiom'),
  ('00000000-0000-0000-0000-000000000002', '테스트 영어과외', 'test-english@example.com', 'starter', 'trial', null, 'test-eng'),
  ('00000000-0000-0000-0000-000000000003', '테스트 국어과외', 'test-korean@example.com', 'standard', 'trial', null, 'test-kor')
on conflict (id) do nothing;

/* ---------- 관리자 계정 (테넌트당 다중 허용 — 00007) ---------- */
-- 이메일은 소문자로 저장(authorizeAdmin이 소문자 정규화 후 대조).
insert into public.admin_accounts (tenant_id, email) values
  ('00000000-0000-0000-0000-000000000001', 'hsgoh05@gmail.com'),
  ('00000000-0000-0000-0000-000000000001', 'seolwon@nqsolution.kr'),
  ('00000000-0000-0000-0000-000000000002', 'test-english@example.com'),
  ('00000000-0000-0000-0000-000000000003', 'test-korean@example.com')
on conflict (tenant_id, email) do nothing;

/* ---------- 1호 테넌트: 사이트 설정 ---------- */

insert into public.site_settings (tenant_id, key, value) values
('00000000-0000-0000-0000-000000000001', 'site_info', '{
  "brandName": "AXIOM MATH LAB",
  "tagline": "증명하는 수학, 액시엄매스랩",
  "bizName": "액시엄매스랩",
  "ceoName": "고현서",
  "bizNo": "489-57-00885",
  "email": "hsgoh05@gmail.com",
  "address": "경기도 수원시 영통구 영통로 460",
  "kakaoUrl": "https://pf.kakao.com/_xdbSxhX/chat",
  "instagramUrl": "https://www.instagram.com/axiom_math_lab",
  "kimProfileUrl": "https://kimstudy.com/tutor/s/e0d107b4-c91a-4aca-9381-717157e99ecb?O3WRXJQK9E=D1072AQ1A",
  "kimReviewUrl": "https://kimstudy.com/tutor/s/e0d107b4-c91a-4aca-9381-717157e99ecb?O3WRXJQK9E=D1072AQ1A",
  "gaId": "G-TEKQVSK73W"
}'::jsonb),
('00000000-0000-0000-0000-000000000001', 'rates',
 '{"inperson": 80000, "video": 60000, "trial": 50000}'::jsonb),
('00000000-0000-0000-0000-000000000001', 'badges',
 '["김과외 전국 상위 0.2% 튜터", "수능 수학 1등급", "한양대 수리논술 최초합격"]'::jsonb),
('00000000-0000-0000-0000-000000000001', 'cases', '[
  {"name": "여OO 학생", "beforeLabel": "고1 2학기 내신", "beforeGrade": "2등급", "afterLabel": "고2 1학기 내신", "afterGrade": "1등급"},
  {"name": "차OO 학생", "beforeLabel": "고2 11월 모의고사", "beforeGrade": "2등급", "afterLabel": "고3 5월 모의고사", "afterGrade": "1등급"},
  {"name": "허O 학생", "beforeLabel": "고3 3월 모의고사", "beforeGrade": "5등급", "afterLabel": "고3 7월 모의고사", "afterGrade": "2등급"},
  {"name": "김OO 학생", "beforeLabel": "고3 6월 모의고사", "beforeGrade": "4등급", "afterLabel": "고3 9월 모의고사", "afterGrade": "3등급"}
]'::jsonb)
on conflict (tenant_id, key) do nothing;

/* ---------- 1호 테넌트: D-day · 모집 현황 ---------- */

insert into public.ddays (tenant_id, name, exam_date, is_visible, sort_order) values
('00000000-0000-0000-0000-000000000001', '2027학년도 9월 모의평가', '2026-09-02', true, 1),
('00000000-0000-0000-0000-000000000001', '2027학년도 대학수학능력시험', '2026-11-19', true, 2);

insert into public.recruit_status (tenant_id, status, message, seat_count, is_banner_visible) values
('00000000-0000-0000-0000-000000000001', 'open', '7월 신규 수강생 2명 모집 중', 2, true),
('00000000-0000-0000-0000-000000000002', 'closed', '', null, false),
('00000000-0000-0000-0000-000000000003', 'closed', '', null, false)
on conflict (tenant_id) do nothing;

/* ---------- 1호 테넌트: 후기 ---------- */

insert into public.reviews (tenant_id, reviewer_type, content, rating, meta, screenshots, is_pinned) values
('00000000-0000-0000-0000-000000000001', 'parent',
 '아이가 많이 따르고 수업도 스타일이 잘 맞다고 합니다~ 무엇보다 수업시간을 정확히 맞춰 주셔서 좋아요. 앞으로도 잘 부탁드립니다^^',
 5, '{"region":"부산","grade":"고3","track":"이과","source":"김과외","reviewed_at":"2025-04-24"}'::jsonb,
 array['/img/reviews/rev-1.jpg'], true),
('00000000-0000-0000-0000-000000000001', 'student',
 '저의 개인 사정으로 짧은 시간 수업을 받았지만, 꼼꼼한 풀이와 기억해야 하는 부분을 친절히 잘 가르쳐주셔서 너무 좋았습니다.',
 5, '{"region":"경북","grade":"고3","track":"이과","source":"김과외","reviewed_at":"2025-07-10"}'::jsonb,
 array['/img/reviews/rev-2.jpg'], false),
('00000000-0000-0000-0000-000000000001', 'student',
 '수1, 수2 개념 수업을 들었는데 개념을 정말 꼼꼼하고 이해하기 쉽게 설명해주셔서 큰 도움이 됐어요. 기초부터 잘 잡고 싶은 분들께 추천합니다.',
 5, '{"region":"세종","grade":"고1","track":"이과","source":"김과외","reviewed_at":"2025-07-30"}'::jsonb,
 array['/img/reviews/rev-5.jpg'], false),
('00000000-0000-0000-0000-000000000001', 'parent',
 '시작한 지는 얼마 안 됐지만 편안한 분위기에서 아이의 눈높이에 맞게 차분하게 설명을 잘 해주시고, 수업 진행 내용·과제 등 아이가 질문도 많은 편인데 실시간으로 소통도 잘 해주셔서 감사합니다~ 아이도 수학에 좀 더 집중해서 공부하려고 노력하는 것 같습니다.',
 5, '{"region":"경기","grade":"고3","track":"이과","source":"김과외","reviewed_at":"2026-05-21"}'::jsonb,
 array['/img/reviews/rev-4.jpg'], true),
('00000000-0000-0000-0000-000000000001', 'student',
 '꼼꼼하게 잘 가르쳐 주시고 쉽게 알려주세요.',
 5, '{"region":"경기","grade":"고2","track":"문과","source":"김과외","reviewed_at":"2026-06-01"}'::jsonb,
 array['/img/reviews/rev-3.jpg'], false);

/* ---------- 1호 테넌트: FAQ 10문항 ---------- */

insert into public.faqs (tenant_id, category, question, answer, sort_order) values
('00000000-0000-0000-0000-000000000001', '상담·시범', '상담은 어떻게 진행되나요?',
 '상담 페이지의 신청 폼을 남겨 주시면 확인 후 연락드립니다. 학생의 현재 상태(학년·최근 성적·목표)를 여쭙고, 수업 방식과 일정·수업료를 안내드립니다. 상담은 무료이며, 상담 후 등록을 강요하지 않습니다.', 1),
('00000000-0000-0000-0000-000000000001', '상담·시범', '시범수업이 있나요?',
 '네. 시범수업은 1시간 5만 원으로 별도 운영됩니다. 정규 등록 시 수업료에서 차감되지 않는 독립 수업이며, 시범수업 후 등록 여부를 자유롭게 결정하시면 됩니다.', 2),
('00000000-0000-0000-0000-000000000001', '수업', '수업은 대면과 화상 중 선택할 수 있나요?',
 '네. 대면 수업과 화상 수업 모두 운영합니다. 대면은 경기 수원 인근 지역에서, 화상은 전국 어디서나 가능합니다. 두 방식 모두 동일한 커리큘럼과 리포트 시스템으로 진행됩니다.', 3),
('00000000-0000-0000-0000-000000000001', '수업', '수업 시간과 횟수는 어떻게 정하나요?',
 '정규 수업은 회당 최소 2시간부터 0.5시간 단위로 조정 가능하며(회당 2~6시간), 주 1~7회 중 학생의 일정과 목표에 맞춰 정합니다. 상담 시 권장 구성을 함께 제안드립니다.', 4),
('00000000-0000-0000-0000-000000000001', '수업료', '수업료는 어떻게 계산되나요?',
 '시간당 단가(대면 8만 원·화상 6만 원) × 회당 수업 시간 × 주당 횟수 × 4주 정액으로 계산됩니다. 예: 대면 회당 2.5시간 × 주 2회 = 시간당 8만 원 × 2.5시간 × 주 2회 × 4주 = 160만 원. 수업 안내 페이지의 계산기로 직접 확인하실 수 있습니다.', 5),
('00000000-0000-0000-0000-000000000001', '수업료', '결제는 어떻게 하나요?',
 '4주 단위 선납이며, 결제 링크(카드·간편결제) 또는 계좌이체로 결제하실 수 있습니다. 결제 예정일 3일 전에 안내를 드립니다.', 6),
('00000000-0000-0000-0000-000000000001', '수업', '어떤 학생이 수업 대상인가요?',
 '고1~고3 및 재수생을 대상으로 내신·수능·수리논술(약술형 포함) 수학을 지도합니다. 기초가 부족한 학생부터 최상위권 심화까지, 첫 상담에서 현재 상태를 진단하고 맞춤 커리큘럼을 설계합니다.', 7),
('00000000-0000-0000-0000-000000000001', '운영', '수업 일정 변경이나 보강은 어떻게 하나요?',
 '부득이한 사정으로 수업이 어려운 경우 사전에 연락 주시면 상호 협의하여 보강 일정을 잡습니다. 보강 일정이 확정되면 안내 메시지를 보내드립니다.', 8),
('00000000-0000-0000-0000-000000000001', '운영', '수업 진행 상황은 어떻게 확인하나요?',
 '매 수업 후 수업 내용·과제·집중도를 담은 수업 리포트를 학부모님께 보내드립니다. 주간·월간 리포트와 시험 분석 리포트도 제공되어, 묻지 않아도 아이의 진행 상황을 정확히 아실 수 있습니다.', 9),
('00000000-0000-0000-0000-000000000001', '운영', '환불 규정은 어떻게 되나요?',
 '학원법 교습비 반환 기준을 준용합니다. 수업 시작 전에는 전액 환불되며, 시작 후에는 경과 시간에 따라 산정됩니다. 시범수업비는 진행 후 환불이 불가하고, 24시간 전 취소 시 전액 환불됩니다. 자세한 내용은 환불 규정 페이지를 확인해 주세요.', 10);

/* ---------- 교차 접근 검증용 — 테넌트 2·3 구분 데이터 ---------- */

insert into public.faqs (tenant_id, category, question, answer, sort_order) values
('00000000-0000-0000-0000-000000000002', '일반', '[테넌트2] 영어 수업 질문', '테넌트2 전용 답변 — 교차 노출 시 RLS 위반.', 1),
('00000000-0000-0000-0000-000000000003', '일반', '[테넌트3] 국어 수업 질문', '테넌트3 전용 답변 — 교차 노출 시 RLS 위반.', 1);

insert into public.students (tenant_id, name, parent_phone, grade, class_type) values
('00000000-0000-0000-0000-000000000002', '테넌트2학생', '010-0000-0002', '고1', 'video'),
('00000000-0000-0000-0000-000000000003', '테넌트3학생', '010-0000-0003', '고2', 'inperson');
