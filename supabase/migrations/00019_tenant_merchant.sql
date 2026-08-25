-- 00019: 결제선생 테넌트별 하위사업장(merchant) 매핑 — 파트너 → 사용자(member) → 매장(merchant) 3층
--
-- 배경(결제선생 파트너 API V2의 3층 구조 — docs/payssam-integration.md §1·§2):
--   ① 파트너      : PAYSSAM_API_KEY 하나로 식별. 쌤포인트(발송 재화) 지갑을 파트너가 보유한다.
--   ② 사용자      : 요청 봉투의 member — 파트너 사용자 코드.
--   ③ 하위사업장  : 요청 봉투의 merchant — 실제 청구·정산 주체(학원 한 곳).
-- 봉투는 {apiKey, member, merchant, bill:{...}}이고, 지금 lib/payssam/client.ts는 member·merchant를
-- 환경변수 하나로 고정한다. 이 레포는 멀티테넌트라 두 번째 학원을 붙이는 순간 그 학원의 청구서가
-- 전부 1호 학원 merchant로 나가 수납·정산이 뒤섞인다 — 돈이 잘못된 사업장으로 꽂히는 사고다.
--
-- 이 마이그레이션은 그 매핑을 테넌트 행에 둔다. 두 컬럼 모두 null 허용이며 해석 규칙은 하나다:
--   "테넌트 값이 있으면 그 값, 없으면(null) 기존 환경변수".
-- 즉 단일 테넌트 운영에서는 환경변수만으로 충분하고(두 컬럼은 계속 null), SaaS로 학원이
-- 늘어날 때만 테넌트 값을 채워 그 학원의 청구가 자기 사업장으로 나가게 한다. 기존 호출부는
-- 손대지 않아도 지금과 동일하게 동작한다(lib/payssam/client.ts의 env 폴백이 기본값).
--
-- 비밀값은 여기 두지 않는다: 파트너 인증키(PAYSSAM_API_KEY)와 PAYSSAM_BASE_URL은 환경변수에만
-- 남긴다 — 키를 DB로 옮기면 유출면이 넓어지고, base_url이 DB에 있으면 샌드박스/운영이
-- 행 하나로 뒤바뀐다(00014·client.ts가 기본값을 두지 않는 것과 같은 이유).
-- member·merchant는 인증키가 아니라 계정 식별자지만, 공개 화면에 노출할 이유는 없다.

alter table public.tenants
  add column if not exists payssam_member_id text,
  add column if not exists payssam_merchant_id text;

-- 빈 문자열 금지 — "미설정"의 표기는 null 하나여야 한다.
-- 빈 문자열을 허용하면 봉투에 ""가 실려 나가 API가 거절하거나(발송 실패가 쌓임),
-- 폴백 판정이 코드마다 갈린다(''는 JS에서 falsy, SQL에서는 not null).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tenants_payssam_member_id_not_blank'
  ) then
    alter table public.tenants
      add constraint tenants_payssam_member_id_not_blank
      check (payssam_member_id is null or btrim(payssam_member_id) <> '');
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'tenants_payssam_merchant_id_not_blank'
  ) then
    alter table public.tenants
      add constraint tenants_payssam_merchant_id_not_blank
      check (payssam_merchant_id is null or btrim(payssam_merchant_id) <> '');
  end if;
end $$;

comment on column public.tenants.payssam_member_id is
  '결제선생 파트너 사용자 코드(봉투 member). null이면 PAYSSAM_MEMBER_ID 환경변수로 폴백.';
comment on column public.tenants.payssam_merchant_id is
  '결제선생 하위사업장 코드(봉투 merchant) — 이 테넌트의 청구·정산 주체. null이면 PAYSSAM_MERCHANT_ID 환경변수로 폴백.';
