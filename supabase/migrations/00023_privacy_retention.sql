-- 00023: 개인정보 보존기록 — 기산 사건에서 파기 예정일까지 (D-04) · 보존 잠금 (D-05)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 왜 만드는가
--
-- 공개 처리방침(lib/content/legal.ts PRIVACY_RETENTION_ROWS)은 대상별 보유기간을 이미 선언하고
-- 있다 — "상담 종료일부터 6개월", "서비스 종료일부터 12개월", "법정 5년" 같은 문장들이다.
-- 그런데 그 문장을 실제 데이터에 적용하는 코드는 레포에 한 줄도 없었다(판정 2026-08-25: D-04 ❌).
-- 즉 밖에는 기한을 약속해 두고, 안에서는 그 기한이 언제 도래하는지 아무도 계산하지 않는 상태였다.
--
-- 이 표는 그 계산 결과를 남기는 원장이다. 한 줄이 곧 하나의 약속이다:
--   "이 대상의 이 종류 데이터는 (기산 사건)로부터 (기한)이 지나면 파기 예정이다."
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 이 표가 하지 않는 것 (오해를 남기지 않기 위해 명시한다)
--
--  · **데이터를 지우지 않는다.** 실제 파기(D-06 승인·D-07 주 저장소·외부 처리자·백업)는 이 표
--    바깥의 일이고 아직 구현돼 있지 않다. destroyed_at은 "운영자가 파기를 실행하고 그 사실을
--    기록했다"는 뜻이지, 시스템이 지웠다는 뜻이 아니다 — 화면 문구도 '파기 완료 기록'이다.
--  · **모든 기산 사건을 자동으로 잡지 않는다.** 정본 D-04는 7종의 기산 사건을 든다. 그중
--    타임스탬프가 실제로 존재하는 4종만 자동 기산한다(lib/privacy/retention.ts에 목록과 이유).
--    나머지(상담·시범 미전환 종결 등)는 그 사건 자체가 아직 코드에 없다 — 없는 것을 있는 척
--    채워 넣으면 원장이 거짓이 된다.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 설계 결정
--
--  · **정책 스냅샷을 행에 박는다**(policy_days·policy_label). 방침이 6개월에서 1년으로 바뀌어도
--    이미 기산된 행의 기한이 소급해 흔들리면 안 된다 — 당시 약속이 무엇이었는지가 증적이다.
--  · **대상 요약은 개인정보가 아닌 표현으로**(subject_label). D-06 정본 "개인정보 없는 대상 요약".
--    이름 전체가 아니라 '홍*동' 같은 가림 이름을 넣는다(마스킹은 앱 층 lib/privacy/retention.ts).
--  · **legal hold는 자동 해제가 없다**(D-05 예외 「자동 해제 금지」). 해제는 운영자 행위뿐이라
--    만료 시각 컬럼을 두지 않는다.
--  · **hold 중에는 파기를 완료로 표시할 수 없다**(D-05 예외) — CHECK로 강제한다.

create table public.retention_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,

  -- 대상: (종류, id)로 원 데이터를 가리킨다. FK를 걸지 않는 이유는 이 원장이 원 데이터보다
  -- 오래 살아야 하기 때문이다 — 파기하고 나면 원 행은 사라지지만 파기 증적은 남아야 한다.
  subject_type text not null
    check (subject_type in ('student', 'consultation', 'payment', 'review')),
  subject_id uuid not null,
  subject_label text not null,   -- 개인정보 없는 대상 요약(가림 이름 등)

  category text not null,        -- 데이터 종류(정책 키) — lib/privacy/retention.ts RETENTION_POLICY
  event text not null,           -- 기산 사건 키
  started_at timestamptz not null,  -- 기산일(사건 발생 시각)
  retain_until date not null,       -- 파기 예정일 = 기산일 + 보존기한(KST 달력일)
  policy_days int not null check (policy_days > 0),
  policy_label text not null,       -- 공개 방침에 적힌 문구 그대로(증적)

  -- D-05 보존 잠금. 사유 없는 잠금은 재검토할 수 없다 — 사유를 필수로 묶는다.
  hold_at timestamptz,
  hold_reason text,
  hold_by text,                     -- 승인한 운영자 이메일

  -- 파기 완료 "기록"(실행 자체는 이 표 밖의 일이다 — 위 주석 참조)
  destroyed_at timestamptz,
  destroyed_by text,
  destroyed_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 한 대상의 한 데이터 종류는 한 줄이다. 재등록처럼 목적이 다시 생기면 기산일을 뒤로 미루는
  -- 갱신이지 새 줄이 아니다(D-04 「목적이 다시 생기면 기산점을 다시 계산」).
  unique (tenant_id, subject_type, subject_id, category),

  constraint retention_hold_needs_reason
    check (hold_at is null or hold_reason is not null),
  -- D-05 「hold 중에는 대상 파기를 완료로 표시하지 않는다」
  constraint retention_hold_blocks_destroy
    check (hold_at is null or destroyed_at is null),
  constraint retention_destroyed_needs_actor
    check (destroyed_at is null or destroyed_by is not null)
);

-- 파기 예정 목록의 주 조회 — 아직 파기되지 않은 행을 기한순으로.
create index idx_retention_due
  on public.retention_records (tenant_id, retain_until)
  where destroyed_at is null;

-- 보존 잠금 목록(주기적 재검토 대상).
create index idx_retention_hold
  on public.retention_records (tenant_id, hold_at)
  where hold_at is not null;

/* ---------- RLS ----------
   관리자 화면 전용 자료다(공개·포털 경로가 없다) — 00020과 같은 테넌트 격리 정책. */

alter table public.retention_records enable row level security;

create policy tenant_isolation on public.retention_records
  for all to authenticated
  using (tenant_id = public.jwt_tenant_id())
  with check (tenant_id = public.jwt_tenant_id());
