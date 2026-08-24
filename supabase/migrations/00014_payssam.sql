-- 00014: 결제선생(Payssam) API V2 연동 — 청구 발송·외부 승인 스냅샷·환불·현금영수증 + 이벤트 원장
--
-- 근거: docs/flow-canon/01_atlas_04_money_notify.md(B-02 API 청구·결제 확정 · B-03 수기 청구·결제 확인)
--       · 03_scenarios_133.md(검수 36 중복 통보는 한 결제 · 37 결과 불명은 결제 완료가 아니다
--         · 42 수납된 청구를 단순 파기하지 않는다 · 45 환불 후 청구·증빙이 같은 결과로 수렴)
--       · 07_rollout_plan.md M0 분리 원칙(업무 상태와 외부 스냅샷의 분리)
--
-- 설계 원칙: payments.status(업무 상태: draft→pending→paid/overdue/refunded)는 우리 업무의
-- 사실이고, appr_* 컬럼은 결제선생이 알려준 외부 승인의 "스냅샷"이다. 통보(콜백)는 그대로
-- 믿지 않고 /bill/read 대조 후에만 업무 상태로 승격한다(검수 37) — 두 계열을 한 컬럼에
-- 섞으면 이 대조 자체가 불가능해진다(00013 ⑥ ai_reports status/delivery_status 분리와 동일 취지).

/* ---------- ① payments 확장 — 청구 발송·승인 스냅샷·환불·현금영수증 (B-02·B-03) ---------- */

alter table public.payments
  -- 청구 발송(B-02: POST /bill): bill_id는 파트너(우리)가 생성하는 문자/숫자 최대 20자 키.
  -- null = 아직 API로 발송하지 않은 청구(수기 경로 B-03 — API 재발송 금지, 검수 39).
  add column bill_id text
    check (char_length(bill_id) between 1 and 20),
  add column bill_short_url text,          -- 발송 응답 shortUrl (청구서 단축 URL)
  add column bill_sent_at timestamptz,     -- API 발송 성공 시각

  -- 외부 승인 스냅샷(B-02: /bill/read apprState F승인/W미결제/C취소/D파기) — 업무 상태와 분리.
  -- appr_state가 F여도 status가 paid가 되는 것은 /bill/read 대조를 통과한 뒤다(검수 37).
  add column appr_state text
    check (appr_state in ('F', 'W', 'C', 'D')),
  add column appr_num text,                -- 승인/취소 거래번호 (apprNum)
  add column appr_dt timestamptz,          -- 승인 일시 (apprDt YYYYMMDDhhmmss → 앱 레이어 변환)
  add column appr_price int,               -- 승인 금액 (apprPrice — amount와의 불일치는 대사 대상)
  add column appr_issuer text,             -- 카드명 또는 은행명 (apprIssuer)
  add column last_synced_at timestamptz,   -- 마지막 /bill/read 대조 시각 — 결과 불명 판정 기준

  -- 환불(B-02: POST /bill/cancel 전액취소) — 수납된 청구는 파기하지 않고 취소·환불 먼저(검수 42),
  -- 환불 성공 후 청구·증빙(현금영수증)이 같은 결과로 수렴해야 한다(검수 45).
  add column refund_appr_num text,         -- 취소 승인 거래번호 (cancel 응답 apprNum)
  add column refunded_at timestamptz,
  add column refund_reason text,           -- cancelReason — 사유 없는 환불은 없다

  -- 현금영수증(/cash-receipt/issue·cancel·read) — 증빙 스냅샷(검수 45 수렴 대상)
  add column cash_receipt_state text
    check (cash_receipt_state in ('issued', 'canceled')),
  add column cash_receipt_appr_num text,   -- 현금영수증 승인번호
  add column cash_receipt_trader text,     -- 발급 구분 (0 개인 소득공제 | 1 사업자 지출증빙)
  add column cash_receipt_issued_at timestamptz;

-- bill_id는 결제선생 파트너 계정 전체에서 중복 불가 — 승인 콜백의 최초 조회 유일 키.
-- (콜백에는 tenant 정보가 없어 bill_id 단독 조회가 유일한 진입점 — 전역 유니크가 그 근거)
create unique index payments_bill_id_key
  on public.payments (bill_id)
  where bill_id is not null;

/* ---------- ② payments.status에 refunded 추가 (검수 45) ----------
   환불 완료는 paid의 소멸이 아니라 별도 업무 상태다 — 환불된 청구가 미결제(pending)로
   보이면 재청구·독촉 자동화가 오작동한다. */

alter table public.payments drop constraint payments_status_check;
alter table public.payments add constraint payments_status_check
  check (status in ('draft', 'pending', 'paid', 'overdue', 'refunded'));

/* ---------- ③ payssam_events — 승인 통보·동기화 원장 (검수 36 멱등의 근거) ----------
   콜백(callback)·수동/정기 대사(sync)로 들어온 외부 사건을 원문(payload)과 판정(outcome)째
   행으로 쌓는다. 같은 승인 통보가 두 번 "적용"되지 않게 하는 부분 유니크가 멱등의 DB 근거다:
     applied   — 검증 통과, 수납 반영됨
     duplicate — 이미 적용된 통보의 재수신 (기록만 남기고 무시 — 검수 36)
     mismatch  — 금액·상태가 내부와 불일치 (수납 반영 금지 → work_items로 수렴 — 검수 37)
     unmatched — bill_id에 대응하는 결제 없음 (격리 — 신뢰할 수 없는 통보)
   payment_id는 원본 결제가 삭제돼도 원장은 보존한다(on delete set null — 외부 사건의 증적). */

-- 자식 복합 FK용 — 부모·자식 테넌트 일치를 DB에서 보장 (00001 students unique(tenant_id,id) 패턴)
alter table public.payments add constraint payments_tenant_id_id_key unique (tenant_id, id);

create table public.payssam_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  payment_id uuid,             -- 매칭된 결제 (unmatched면 null)
  bill_id text not null,
  event_type text not null check (event_type in ('callback', 'sync')),
  appr_state text,             -- 수신된 apprState (승인 콜백은 F만 온다)
  appr_num text,
  appr_price int,
  payload jsonb not null,      -- 수신 원문 — 대조·감사의 근거(요약이 아닌 전문)
  outcome text not null check (outcome in ('applied', 'duplicate', 'mismatch', 'unmatched')),
  note text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, payment_id)
    references public.payments (tenant_id, id) on delete set null (payment_id)
);

-- 멱등 dedup: 같은 승인 통보(테넌트·청구·거래번호·경로)는 한 번만 '적용'될 수 있다(검수 36).
-- duplicate·mismatch·unmatched 기록은 횟수 제한 없이 남는다(부분 인덱스 — 원장은 전부 보존).
create unique index payssam_events_applied_dedup
  on public.payssam_events (tenant_id, bill_id, coalesce(appr_num, ''), event_type, outcome)
  where outcome = 'applied';

create index idx_payssam_events_tenant on public.payssam_events (tenant_id, created_at desc);
create index idx_payssam_events_bill on public.payssam_events (tenant_id, bill_id);

-- RLS: activity_log 계열 — 테넌트 격리 정책 (00006 패턴).
-- 콜백 수신은 service_role(RLS 우회) 경로지만, bill_id 최초 조회 1건 외에는
-- 앱 레이어가 행의 tenant_id로 스코프를 강제한다(정본 테넌트 스코프 규칙).
alter table public.payssam_events enable row level security;
create policy tenant_isolation on public.payssam_events
  for all to authenticated
  using (tenant_id = public.jwt_tenant_id())
  with check (tenant_id = public.jwt_tenant_id());
