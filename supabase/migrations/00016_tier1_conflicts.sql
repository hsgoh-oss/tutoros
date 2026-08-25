-- 00016: 정본 충돌 해소 Tier-1 — 성적 소프트 삭제(A-06) · 보고서 철회·이전본 대체 표시(G-03)
--        · 후기 승인 게시 흐름(S-01·S-03)
--
-- 근거: docs/flow-canon/06_gap_summary.md 충돌 표(A-06·G-03·S-01)
--       · 01_atlas_03_learning.md(A-06 평가 정정·재시험·재사용 · G-03 보고서 정정·철회·공유)
--       · 01_atlas_05_content_ops_privacy.md(S-01 작성 요청·제출 · S-03 검토·게시·철회)
--
-- 설계 원칙:
--  · 승인된 사실은 덮어쓰지 않는다 — 정정·취소·철회는 새 이력(07_rollout_plan M0-③).
--    사유·행위자·전후 값 이력은 00013 ④ adjustments가 담는다(이번 마일스톤에서
--    lib/data/adjustments.ts recordAdjustment가 첫 채택 — 기록 자체는 코드 몫).
--  · 물리 삭제 금지(A-06): 삭제는 deleted_at 스탬프다. 기존 조회가 깨지지 않게 컬럼만
--    추가하고 노출 필터는 앱 레이어가 건다(00015 "노출 판정은 앱 레이어" 원칙과 동일).
--  · 공개 콘텐츠는 승인본만(S-01·S-03): "등록 즉시 공개"를 DB 기본값에서 제거한다 —
--    신규 후기는 draft로 태어나고 운영자 승인을 거쳐야 게시된다.

/* ---------- ① grade_records — 소프트 삭제 (A-06) ----------
   정본: '원 결과 유지 → 새 결과본 → 재승인 → 영향 갱신'. 현행 deleteGrade의 물리 DELETE
   (app/admin/(protected)/grades/actions.ts)가 이와 충돌한다(06_gap A-06 "물리 삭제 금지").
   삭제·정정 시 원 행과 원 점수는 그대로 남기고 deleted_at으로 철회 사실만 표시한다 —
   "결과 철회 후 다시 공개"도 이전 결과를 되돌리지 않고 새 결과본을 쌓는 구조(A-06 예외).
   기존 조회 호환을 위해 컬럼만 추가한다 — 활성 행 필터(deleted_at is null)는 코드 몫이고,
   전후 값·행위자 이력은 adjustments(domain 'grade', target_type 'grade_record')에 쌓는다. */

alter table public.grade_records
  add column deleted_at timestamptz,  -- null = 활성. 스탬프 = 철회된 결과(물리 삭제 금지)
  add column deleted_reason text;     -- 사유 없는 삭제는 없다 — 코드(runCritical grade)가 강제

/* ---------- ② ai_reports — 철회·이전본 대체 표시 (G-03) ----------
   정본: 철회 = "새 열람 차단 → 철회 이력 보존", 정정 = "새 보고서본 → 운영자 재승인 →
   최신본 게시 → 이전본 대체 표시". 발송·게시된 본을 고치는 대신(00013 ⑥ 발송본 수정 금지와
   동일 계열) 상태로 철회를 표시하고 — 포털·발송 경로가 retracted를 걸러 새 열람을 차단한다 —
   superseded_by로 정정된 새 본을 가리켜 이전본에 "대체됨"을 표시한다. 행 자체는 보존:
   철회된 행이 곧 철회 이력이다. */

-- 대체 연결에는 자기참조 복합 FK를 쓴다: 연결이 테넌트 경계를 넘으면 타테넌트 보고서가
-- "우리 최신본"으로 연결되는 오염이므로 DB가 차단해야 한다. 필요한 부모 unique
-- (ai_reports_tenant_id_id_key)는 00015 말미가 이미 추가했다(00001 복합 FK 관례).
alter table public.ai_reports
  add column retracted_at timestamptz,  -- 철회 시각 — status 전환과 함께 코드가 스탬프
  add column retract_reason text,       -- 사유 없는 철회는 없다(G-03 철회 이력 보존)
  add column superseded_by uuid;        -- 이 본을 대체한 새 보고서(최신본). null = 대체 없음

alter table public.ai_reports
  add constraint ai_reports_superseded_by_fkey
    foreign key (tenant_id, superseded_by)
    references public.ai_reports (tenant_id, id)
    on delete set null (superseded_by); -- 새 본 삭제 시 대체 표시만 해제, 이전본은 보존

-- 새 본 삭제(학생 삭제 CASCADE 포함) 시 set null이 참조 행을 찾는 경로
-- (00013 idx_notifications_report 패턴 — 부분 인덱스)
create index idx_ai_reports_superseded
  on public.ai_reports (tenant_id, superseded_by)
  where superseded_by is not null;

-- 철회는 업무 상태다: draft → approved → sent → retracted.
-- 전달 상태(delivery_status)와의 분리는 00013 ⑥ 그대로 — 'failed'를 업무 상태로 되돌리지 않는다.
alter table public.ai_reports drop constraint ai_reports_status_check;
alter table public.ai_reports add constraint ai_reports_status_check
  check (status in ('draft', 'approved', 'sent', 'retracted'));

/* ---------- ③ reviews — 승인 게시 흐름 (S-01·S-03) ----------
   정본: "초대·동의·제출·검토·승인 후 게시" — 등록 즉시 공개·자동 요청·자동 게시 금지(S-01).
   현행은 운영자 대필 등록 즉시 전체 공개(lib/data/content.ts가 상태 구분 없이 전 행 노출)라
   충돌한다. 상태 흐름: draft(등록·제출 직후 — 비공개) → approved(운영자 승인 — 게시 대기)
   → published(공개) / retracted(철회 — 즉시 공개 중단, S-03 "동의 철회·작성자 철회").
   철회 시에도 행은 보존한다(S-03 "철회 증명만 최소 보존") — 사유·행위자 이력은
   adjustments에 쌓는다.

   호환(최소 침습): 기존 행은 운영자가 직접 검토·등록해 이미 공개 중인 본이므로 published로
   백필해 공개 쿼리가 오늘 보여주는 집합을 유지하고, 승인 시각은 등록 시각으로 간주한다
   (대필 구조 = 등록 주체가 곧 검토 주체). 백필 뒤 기본값을 draft로 바꿔 "이후의 모든
   신규 등록은 비공개로 태어난다"를 DB 기본값이 보장한다 — 공개 쿼리의 status='published'
   필터와 승인 전환은 코드 몫. */

-- default 'published'로 추가 → 기존 행 전부가 published로 백필된다(공개 집합 유지)
alter table public.reviews
  add column status text not null default 'published'
    check (status in ('draft', 'approved', 'published', 'retracted')),
  add column approved_at timestamptz; -- 운영자 승인 시각(S-01 "운영자 검토" 통과 증적)

-- 기존 공개본의 승인 시각 백필 — 등록 시점 승인으로 간주(위 호환 원칙)
update public.reviews
   set approved_at = created_at
 where status = 'published';

-- 등록 즉시 공개 금지(S-01): 이제부터의 신규 행은 draft로 태어난다
alter table public.reviews alter column status set default 'draft';

-- 공개 쿼리(published만)·운영 검토 대기 목록(draft·approved) 공용 조회 경로
create index idx_reviews_tenant_status on public.reviews (tenant_id, status);
