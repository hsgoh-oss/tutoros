-- 00017: 역할별 포털 — 사람(contact)·관계(relation)·지속 로그인 링크·세션 (P-01 · P-02)
--
-- 근거: docs/flow-canon/01_atlas_02_portal_lessons.md P-01(역할별 초대)·P-02(로그인·세션·복구)
--       · 03_scenarios_133.md 검수 16(모든 역할 조합이 독립 권한)·17(학생은 금전 비노출)
--       · 18(보호자는 연결된 학생만)·19(납부자는 학습 상세 비노출)·20(재발급 시 이전 초대 무효)
--       · 21(관계 종료 시 세션·초대·공유경로 전부 닫힘)·109(관계 종료 후 알림 상세 차단)
--       · 124(기존 대상 재수락 시 중복 생성 금지)·125(반쪽 수락 금지)
--
-- 현행 갭(01_atlas_02 P-01·P-02 "⚠️ 충돌"): 포털 접근이 학생당 자동 발급 토큰 링크 하나뿐이라
-- ① 사람과 역할의 구분이 없고 ② 본인 확인·수락 개념이 없고 ③ 회수 가능한 세션이 없다.
-- 이 마이그레이션은 그 셋을 스키마로 만든다 — 관리자(admin_sessions, 00013 ①) 계열의 이용자판.
--
-- 설계 결정(간편 모델 — 비밀번호·만료 없는 초대 링크만):
--  · 사람(portal_contacts)과 역할 관계(portal_relations)를 분리한다. 한 사람이 학생이자
--    납부자일 수 있고(검수 16), 그때 두 역할의 권한은 서로를 참조하지 않는다 — 역할별 행이
--    독립 단위이므로 한 역할 회수가 다른 역할에 영향을 주지 않는다.
--  · 링크는 만료되지 않는다. 무효화 경로는 재발급(rotated_at)과 회수(revoked_at) 둘 뿐이고,
--    둘 다 revoked_at 스탬프로 수렴한다 — "유효한 링크 = revoked_at is null" 하나만 보면 된다.
--  · 세션은 admin_sessions와 같은 서버측 행(token_hash만 저장·revoked_at 즉시 회수)이다.
--    무상태 서명 쿠키는 관계가 끝나도 살아남아 검수 21을 충족할 수 없다.
--
-- 이행 정책: 기존 students.portal_token(00003)과 /portal/[token]은 그대로 둔다(회귀 금지 —
-- 병행 운영). 자동 은퇴는 하지 않는다 — 전환은 운영자 판단.
--
-- ⚠️ 권한 매트릭스는 스키마가 아니라 코드 경로로 보장한다(검수 17): 학생 역할 뷰에는
-- 청구·수납·환불 쿼리 자체가 존재하지 않아야 한다. RLS·필터로 가리는 방식은 필터 한 줄이
-- 빠지면 그대로 노출이므로 이 파일은 그 보장을 대신하지 않는다.

/* ---------- ① portal_contacts — 사람 (P-01) ----------
   초대 대상이 되는 실제 사람. 학생·보호자·납부자 어느 역할로 연결되든 사람은 한 행이다
   (검수 124: 기존 확인 대상이 새 초대를 수락해도 새 사람을 만들지 않고 역할만 붙인다).
   본인 식별키는 정규화된 휴대전화 — 초대 전달 경로(SMS)와 같은 값이라야 "전달받은 사람이
   곧 그 사람"이 성립한다.

   ⚠️ 삭제하지 않는 설계: contact 행은 지우지 않는다(관계 revoke가 원칙 — P-06 "권한 회수가
   원 데이터 삭제를 뜻하지 않는다"). DELETE 거부 트리거는 두지 않았다 — 감사·제출물처럼
   원본 보존이 법적 요구인 테이블이 아니고, 삭제 경로를 만들지 않는 코드 규율로 충분하다.
   아래 자식 테이블의 on delete cascade는 그 규율이 깨졌을 때 고아 행을 남기지 않기 위한
   안전망이지, 삭제를 권장하는 표시가 아니다. */

create table public.portal_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  -- 숫자만(하이픈·공백·국가번호는 앱이 제거해서 넣는다 — app/admin/.../payments/actions.ts의
  -- replace(/\D/g, "") 규약과 동일). 정규화를 DB가 강제해야 '010-1234-5678'과 '01012345678'이
  -- 서로 다른 사람으로 중복 생성되는 사고를 막을 수 있다.
  phone text not null check (phone ~ '^[0-9]{9,12}$'),
  created_at timestamptz not null default now(),
  -- 같은 테넌트 안에서 한 사람은 한 행(검수 124의 "중복 생성 금지"를 DB가 보장)
  unique (tenant_id, phone),
  unique (tenant_id, id) -- 자식 테이블 복합 FK용 — 부모·자식 테넌트 일치를 DB에서 보장(00001 관례)
);

/* ---------- ② portal_relations — 사람 × 학생 × 역할 (P-01 · 검수 16·18·19) ----------
   권한의 단위. 겸임(학생이자 납부자, 보호자이자 납부자)은 역할별로 행이 하나씩 생기고
   서로 독립이다 — "학습 영역과 금전 영역을 역할별로 분리"(P-05 예외)가 데이터 구조로 성립한다.
   보호자·납부자가 볼 수 있는 학생 집합은 이 표의 active 행이 정의한다(검수 18).

   상태: invited(초대 발급) → active(첫 링크 클릭 = 수락) → revoked(회수).
   revoked에서 다시 초대하면 같은 행이 invited로 돌아가고 invited_at이 새로 찍힌다
   (관계는 하나 — 중복 행을 쌓지 않는다). */

create table public.portal_relations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  contact_id uuid not null,
  student_id uuid not null,
  -- contractor는 자리 표시다 — 계약 엔티티 자체는 M2에서 들어온다.
  role text not null check (role in ('student', 'guardian', 'payer', 'contractor')),
  status text not null default 'invited'
    check (status in ('invited', 'active', 'revoked')),
  invited_at timestamptz not null default now(),  -- 재초대 시 다시 스탬프(현행 초대 발급 시각)
  accepted_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz not null default now(),  -- 관계가 처음 만들어진 시각(재초대에도 불변)
  -- 겸임은 역할별 행 — 같은 사람·같은 학생이라도 역할이 다르면 별개 권한이다(검수 16).
  unique (tenant_id, contact_id, student_id, role),
  unique (tenant_id, id), -- portal_access_links 복합 FK용
  -- 반쪽 수락 금지(검수 125)의 DB측 보강: active인데 수락 시각이 없는 행은 만들 수 없다.
  -- 수락은 accept_portal_link(⑤)가 한 트랜잭션에서 상태와 시각을 함께 찍는다.
  constraint portal_relations_active_needs_accept
    check (status <> 'active' or accepted_at is not null),
  -- 회수도 마찬가지 — 언제 끊겼는지 없는 회수는 없다(P-06 감사 대조).
  constraint portal_relations_revoked_needs_time
    check (status <> 'revoked' or revoked_at is not null),
  foreign key (tenant_id, contact_id)
    references public.portal_contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade
);

-- 학생 상세(관리자)·학생 역할 뷰: 이 학생에 연결된 활성 관계
create index idx_portal_relations_student
  on public.portal_relations (tenant_id, student_id, role)
  where status = 'active';

-- 보호자·납부자 포털: 이 사람이 볼 수 있는 학생 목록(검수 18 — 이 인덱스가 곧 노출 범위)
create index idx_portal_relations_contact
  on public.portal_relations (tenant_id, contact_id)
  where status = 'active';

/* ---------- ③ portal_access_links — 관계당 지속 로그인 링크 (P-01 · 검수 20) ----------
   비밀번호 없는 간편 모델의 본인 확인 수단. 원문 토큰은 발송된 링크에만 존재하고 DB에는
   HMAC 해시만 둔다(admin_sessions와 같은 규약 — DB가 유출돼도 링크를 역산할 수 없다).

   무효화는 두 경로뿐이고 둘 다 revoked_at으로 수렴한다:
    · 재발급: 이전 링크에 rotated_at + revoked_at을 함께 찍는다(검수 20 "이전 초대는 사용 불가").
    · 회수: 관계 종료·오수신 등 — revoked_at만 찍는다(검수 21).
   만료(expires_at)는 없다. 지속 링크이므로 시간이 아니라 회수가 유일한 종료 조건이다. */

create table public.portal_access_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  relation_id uuid not null,
  token_hash text not null unique,  -- HMAC-SHA256(AUTH_SECRET, 원문 토큰) — 원문은 저장하지 않는다
  created_at timestamptz not null default now(),
  rotated_at timestamptz,           -- 재발급으로 대체된 시각(무효 사유가 재발급임을 표시)
  revoked_at timestamptz,           -- null = 사용 가능. 스탬프 = 무효(재발급·회수 공통)
  revoked_reason text,
  -- 대체된 링크가 살아 있으면 검수 20이 깨진다 — rotated_at은 반드시 무효와 함께.
  constraint portal_access_links_rotated_is_revoked
    check (rotated_at is null or revoked_at is not null),
  foreign key (tenant_id, relation_id)
    references public.portal_relations (tenant_id, id) on delete cascade
);

-- 관계당 살아 있는 링크는 하나. 재발급이 이전 링크를 무효로 만들지 않으면 INSERT 자체가
-- 실패한다 — "새 초대 발급 = 이전 초대 즉시 무효"(P-01 예외)를 코드가 아니라 DB가 강제한다.
create unique index portal_access_links_one_active_per_relation
  on public.portal_access_links (relation_id)
  where revoked_at is null;

/* ---------- ④ portal_sessions — 이용자 세션 (P-02 · 검수 21) ----------
   admin_sessions(00013 ①)와 같은 패턴: 쿠키에는 랜덤 원문, DB에는 해시만. 링크를 누를 때마다
   새 세션이 발급되고(지속 링크 + 만료 있는 세션), 30일 후 만료되거나 revoked_at으로 즉시
   끊긴다. 관계를 회수하면 링크뿐 아니라 그 사람의 세션도 함께 회수해야 "다음 요청부터 접근
   차단"(P-02 예외)과 검수 21이 성립한다.

   세션은 관계가 아니라 사람에 매인다: 한 사람이 여러 역할을 가지면 한 번 로그인해 역할을
   오갈 수 있어야 하기 때문이다. 그래서 회수 시 단위도 사람이다 — 관계 하나를 끊으면 그
   사람의 세션 전부를 끊고, 남은 역할은 살아 있는 링크로 다시 로그인해 재확인한다
   (열려 있던 화면이 회수된 역할을 계속 보여주는 창을 남기지 않는다).

   관계 회수 시 코드가 한 트랜잭션에서 해야 하는 것(runCritical permission):
     ① portal_relations: status='revoked', revoked_at=now(), revoked_reason
     ② portal_access_links: 그 관계의 revoked_at is null 행 회수
     ③ portal_sessions: 그 contact_id의 revoked_at is null · 미만료 행 회수 */

create table public.portal_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  contact_id uuid not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,  -- 앱이 now() + 30일로 계산해 넣는다(TTL 정의는 코드 한 곳)
  revoked_at timestamptz,
  revoked_reason text,
  foreign key (tenant_id, contact_id)
    references public.portal_contacts (tenant_id, id) on delete cascade
);

-- 회수 경로: "이 사람의 살아 있는 세션 전부"(검수 21). 만료·회수 행의 물리 정리는 이후 크론 몫.
create index idx_portal_sessions_contact
  on public.portal_sessions (tenant_id, contact_id);

/* ---------- RLS: 4종 모두 정책 없는 RLS = service_role 전용 (00010 패턴) ----------
   근거: 이 4종은 전부 "인증 전 단계" 또는 "인증 그 자체"의 테이블이다. 포털 이용자는 Supabase
   authenticated 주체가 아니라 우리 세션 쿠키를 든 방문자이므로 jwt_tenant_id() 기반 정책이
   평가될 컨텍스트 자체가 없다(admin_otps·admin_sessions와 동일한 사정).
   관리자 화면의 조회·발급·회수도 전부 service client 경유이므로 테넌트 정책을 달아도
   평가되지 않는 장식이 된다 — 그래서 정책을 만들지 않는다. 정책 없는 RLS는 anon·authenticated를
   전면 거부하고 service_role(BYPASSRLS)만 통과시킨다. 테넌트 스코프는 앱 레이어가 강제한다.

   ⚠️ 이 선택은 "테넌트 격리를 안 한다"가 아니라 "격리 지점을 앱으로 옮긴다"는 뜻이다.
   anon 키가 유출돼도 이 4종은 한 행도 읽히지 않는다(99_rls_test 8n이 실측). */

alter table public.portal_contacts enable row level security;
alter table public.portal_relations enable row level security;
alter table public.portal_access_links enable row level security;
alter table public.portal_sessions enable row level security;

/* ---------- ⑤ accept_portal_link — 원자적 수락 (검수 125 · 124) ----------
   정본 P-01 예외: "초대 수락 중 계정·역할·학생관계 일부 연결 실패 → 수락 전체를 완료로 표시하지
   않음". 링크 검증과 관계 활성화가 따로 놀면 '링크는 썼는데 관계는 invited'인 반쪽 상태가 남는다.
   한 트랜잭션 + 행 잠금으로 그 창을 없앤다 — 어느 단계가 실패해도 예외로 전체 롤백된다.

   멱등(검수 124): 이미 active인 관계는 다시 스탬프하지 않고(no-op) 기존 결과로 수렴한다.
   같은 링크를 두 번 눌러도 새 관계·중복 수락 시각은 생기지 않는다.

   존재 비노출(P-02 예외 "계정 존재를 노출하지 않는 확인"): 없는 토큰·회수된 링크·끊긴 관계는
   전부 "0행"으로 같게 응답한다. 이유를 구분해 알리면 유효한 링크를 탐지하는 신호가 된다.

   세션 발급은 이 함수 밖(앱)이다: 수락이 끝난 뒤 세션 insert가 실패해도 관계는 이미 확정된
   사실이고, 이용자는 같은 링크를 다시 눌러 no-op 수락 + 새 세션을 받으면 복구된다. 반대로
   세션까지 이 함수에 넣으면 토큰 해시 계산(AUTH_SECRET)을 DB가 알아야 해 비밀이 번진다.

   ⚠️ 호출자는 반환된 tenant_id가 현재 호스트의 테넌트와 일치하는지 확인해야 한다 —
   이 함수는 service_role로 실행되어 테넌트 경계를 스스로 판정하지 않는다.
   security definer: search_path 고정 + 본문 전부 스키마 한정 + 아래에서 EXECUTE 회수(00013 ⑧ 수칙). */

create or replace function public.accept_portal_link(p_token_hash text, p_tenant_id uuid)
returns table (
  relation_id uuid,
  tenant_id uuid,
  contact_id uuid,
  student_id uuid,
  role text,
  status text,
  accepted_at timestamptz,
  first_accept boolean,     -- true면 이번 클릭이 최초 수락(안내·감사 기록 분기용)
  contact_name text,
  contact_phone text,
  student_name text,
  student_status text       -- 종료된 학생의 관계로 들어오는 경로를 앱이 판정할 수 있게 함께 반환
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_relation_id uuid;
  v_rel public.portal_relations%rowtype;
  v_first boolean := false;
begin
  if coalesce(trim(p_token_hash), '') = '' then
    return; -- 빈 토큰은 조회조차 하지 않는다
  end if;

  -- 링크 잠금: 같은 링크를 동시에 두 번 눌러도 수락 평가는 직렬화된다.
  select l.relation_id
    into v_relation_id
    from public.portal_access_links l
   where l.token_hash = p_token_hash
     and l.revoked_at is null
   for update;

  if not found then
    return; -- 없음 · 회수됨 · 재발급으로 대체됨 — 구분하지 않는다
  end if;

  -- 관계 잠금: invited→active 전환이 한 번만 일어나게 한다(중복 accepted_at 스탬프 금지).
  select r.*
    into v_rel
    from public.portal_relations r
   where r.id = v_relation_id
   for update;

  if not found or v_rel.status = 'revoked' then
    return; -- 관계가 끝났으면 링크가 살아 있어도 접근은 없다(검수 21·109)
  end if;

  -- 거절 게이트는 반드시 스탬프보다 먼저다(검수 125 반쪽 수락 금지).
  -- 앱이 나중에 거절하면 접근은 막히지만 관계는 '수락 완료'로 변조된 채 남는다 —
  -- 링크 프리뷰·URL 스캐너가 GET 한 번 긁는 것만으로 사람이 누르지 않은 초대가 수락된다.
  -- ① 테넌트 경계: 다른 테넌트 호스트에서 재생된 링크는 여기서 끊는다.
  if v_rel.tenant_id is distinct from p_tenant_id then
    return;
  end if;
  -- ② 종료 학생의 관계는 링크가 살아 있어도 열지 않는다(E-04 접근 회수와 같은 판단).
  if exists (
    select 1 from public.students s
     where s.tenant_id = v_rel.tenant_id
       and s.id = v_rel.student_id
       and s.status = 'ended'
  ) then
    return;
  end if;

  if v_rel.status = 'invited' then
    update public.portal_relations r
       set status = 'active',
           accepted_at = now()
     where r.id = v_rel.id
    returning r.* into v_rel;
    v_first := true;
  end if;

  -- 관계·사람·학생을 한 번에 돌려준다. 이 조회가 비면(사람·학생 행 부재) 아무것도 반환하지
  -- 않는다 — 복합 FK가 있어 정상 상태에서는 발생하지 않는다.
  return query
  select v_rel.id, v_rel.tenant_id, v_rel.contact_id, v_rel.student_id,
         v_rel.role, v_rel.status, v_rel.accepted_at, v_first,
         c.name, c.phone, s.name, s.status
    from public.portal_contacts c
    join public.students s
      on s.tenant_id = v_rel.tenant_id
     and s.id = v_rel.student_id
   where c.tenant_id = v_rel.tenant_id
     and c.id = v_rel.contact_id;
end $$;

/* ---------- EXECUTE 권한: anon·authenticated 회수 + service_role 명시 부여 ----------
   PostgREST는 public 스키마 함수를 RPC로 노출하고, create 시 PUBLIC 의사롤 EXECUTE가 붙는다.
   accept_portal_link는 security definer라 노출되면 토큰 해시만 알아내면(또는 무차별 대입으로)
   관계를 활성화할 수 있는 경로가 된다 — anon·authenticated에서 반드시 회수한다.

   ⚠️ PUBLIC 회수는 service_role의 EXECUTE까지 함께 없앤다(PUBLIC을 통해서만 받고 있었다면).
   앱은 SUPABASE_SERVICE_ROLE_KEY로 PostgREST에 붙어 service_role 역할로 이 함수를 호출하므로
   (lib/supabase/server.ts createServiceClient), 회수 뒤 명시 부여를 하지 않으면 수락 경로 전체가
   42501로 죽는다. 회수와 부여를 한 쌍으로 둔다 — 어느 환경의 기본 권한에도 의존하지 않는다. */
revoke execute on function public.accept_portal_link(text, uuid) from public, anon, authenticated;
grant execute on function public.accept_portal_link(text, uuid) to service_role;
