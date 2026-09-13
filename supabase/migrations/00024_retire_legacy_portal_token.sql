-- 00024: 학생당 단일 포털 토큰 은퇴 (P-01·P-02 충돌 해소 · E-04)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 무엇을 없애는가
--
-- 00003이 만든 `students.portal_token`은 학생 하나당 링크 하나였다. 그 링크에는
--   · 만료가 없고            (시간이 지나도 죽지 않는다)
--   · 세션이 없고            (누가 언제 열었는지 남지 않는다)
--   · 회수 수단이 없었다      (토큰을 새로 굴리는 것 말고는 끊을 방법이 없다)
-- 게다가 학생과 보호자가 **같은 링크**를 썼다. 그래서 "이 사람만 접근을 끊는다"가 성립하지
-- 않았고, 제출·질문이 들어와도 행위자가 학생인지 보호자인지 구분되지 않았다.
--
-- 00017이 역할별 초대(portal_contacts·portal_relations·portal_access_links·portal_sessions)를
-- 세웠지만 옛 경로를 **병행 운영**으로 남겨 두어, 두 인증 모델이 함께 살아 있었다.
-- 정본은 이 상태를 충돌로 판정했다(P-01·P-02 미해소). 이 마이그레이션이 그 병행을 끝낸다.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 이 마이그레이션이 하는 일
--
--   ① 모든 portal_token을 null로 만든다 = **기존 링크 전부 즉시 무효**.
--   ② 자동 발급(default)과 not null을 떼어 새 토큰이 더는 생기지 않게 한다.
--
-- 컬럼 자체는 지우지 않는다. 값이 사라진 컬럼은 이미 아무 권한도 주지 않고, 남겨 두면
-- 00003 이후의 스키마 이력이 끊기지 않는다. 다음 정리 회차에서 떼어내면 된다.
--
-- ⚠️ 운영 영향 — 이건 조용한 변경이 아니다
--
-- 지금 그 링크를 쓰고 있는 학부모는 **이 마이그레이션 시점부터 포털에 들어갈 수 없다.**
-- 역할별 초대(P-01)를 받은 적이 없는 학생이 그 대상이다. 자동으로 관계를 만들어 주지 않는다 —
-- 포털 접근은 권한이고, 권한 부여는 늘 명시적이어야 한다(P-06). 대신 아래 뷰가 대상자를
-- 뽑아 주고, 운영자는 학생 상세의 '포털 관계'에서 초대를 보내면 된다.
--
-- 초대를 받은 뒤에는 링크를 잃어도 공개 포털(/p)에서 번호로 다시 받을 수 있다
-- (lib/actions/portal-link.ts) — 옛 경로에는 그런 복구 수단조차 없었다.

/* ---------- ① 기존 링크 전부 무효화 ---------- */

alter table public.students
  alter column portal_token drop default,
  alter column portal_token drop not null;

update public.students set portal_token = null where portal_token is not null;

/* ---------- ② 이행 대상 조회 뷰 ----------
   "옛 링크로 보고 있었을 텐데 역할별 초대는 없는 학생" — 운영자가 초대를 보내야 할 명단이다.
   종료(ended) 학생은 뺀다: 종료는 접근이 닫히는 게 맞는 상태다(E-04).

   security_invoker로 두어 호출자의 RLS를 그대로 물려받는다(00020 뷰 관례) —
   뷰가 테넌트 경계를 우회하는 창구가 되지 않게. */

create or replace view public.portal_migration_pending
with (security_invoker = true) as
select s.tenant_id,
       s.id   as student_id,
       s.name as student_name,
       s.parent_phone,
       s.status
  from public.students s
 where s.status <> 'ended'
   and not exists (
     select 1
       from public.portal_relations r
      where r.tenant_id = s.tenant_id
        and r.student_id = s.id
        and r.status = 'active'
   );

comment on view public.portal_migration_pending is
  '옛 포털 토큰(00003) 은퇴 후 역할별 초대가 아직 없는 재원 학생 — 운영자가 초대를 보내야 할 명단(00024).';
