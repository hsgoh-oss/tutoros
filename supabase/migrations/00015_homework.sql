-- 00015: 과제 도메인 — 과제(배부)·제출(append-only)·학생 질의응답
--
-- 근거: docs/flow-canon/01_atlas_03_learning.md(H-01 과제 생성·배부 · H-02 제출·재제출
--       · H-03 피드백 순환 · H-04 질의응답 · H-07 종료·대상 취소·보관)
--       · 03_scenarios_133.md(검수 27 재제출은 이전 제출을 덮어쓰지 않는다
--         · 28 미승인 피드백·답변은 알림·포털 비노출 · 29 질문은 원 기록과 연결되고
--           답변 게시 또는 해결 완료로 닫힌다 · 126 미검토 제출이 남아 있으면
--           과제를 전체 종료로 표시하지 않는다)
--
-- 설계 원칙:
--  · 초안(draft) 과제·미승인(feedback_status='draft') 피드백·미승인 답변은 학생·보호자
--    비노출(H-01·검수 28) — 노출 판정은 앱 레이어(포털 조회·알림 발송)가 status로 거른다.
--  · 제출은 append-only(검수 27): 재제출은 attempt_no를 올린 새 행이고, 원문 필드는
--    DB 트리거가 불변으로 강제한다. 검토·피드백·철회 필드만 갱신할 수 있다.
--  · 마감 후 제출은 차단하지 않는다(H-02) — late 플래그로 지연 사실과 실제 시각
--    (submitted_at)을 연결할 뿐이다.
--  · 대상 취소·과제 취소가 제출물·피드백을 자동 삭제하지 않는다(H-07) — 과제 행 삭제
--    자체를 코드에서 막고, 제출 행 직접 DELETE는 트리거가 거부한다(부모 CASCADE 삭제
--    경로 — 학생·테넌트 삭제 — 는 트리거가 부모 부재를 확인하고 통과시킨다).

/* ---------- ① homework_assignments — 과제 (H-01·H-07) ----------
   status: draft(초안 — 학생·보호자 비노출) → assigned(게시·배부) → closed(전체 종료)
           / canceled(취소). 게시 후 내용 변경은 기존 행 수정이 아니라 새 과제본
           생성·재배부로 처리한다(H-01 예외 — 앱 레이어 규칙).
   closed 전환 전 미검토 제출 잔존 검사(검수 126)는 코드(runCritical)가 수행한다. */

create table public.homework_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_id uuid not null,
  lesson_id uuid, -- 원 수업 연결 (H-01 주 전환 · 검수 29 계열 — 질문의 원 기록 대조 근거)
  title text not null,
  description text not null default '',
  due_date date, -- null = 마감 없음. 마감 경과는 제출 차단 사유가 아니다(H-02)
  status text not null default 'draft'
    check (status in ('draft', 'assigned', 'closed', 'canceled')),
  assigned_at timestamptz, -- 게시·배부 시각
  closed_at timestamptz,   -- 종료·취소 시각
  close_note text,         -- 종료·취소 사유 (미검토 제출 잔존 시 별도 검토 경로 기록 등)
  archived_at timestamptz, -- 보관(H-07) — 현재 목록에서 접는다. 파기가 아니며 이력 접근은 유지
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id), -- 자식 복합 FK용 — 부모·자식 테넌트 일치를 DB에서 보장 (00001 패턴)
  foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade,
  foreign key (tenant_id, lesson_id)
    references public.lessons (tenant_id, id) on delete set null (lesson_id)
);

create index idx_homework_assignments_tenant
  on public.homework_assignments (tenant_id, status, created_at desc);
create index idx_homework_assignments_student
  on public.homework_assignments (student_id, created_at desc);

create trigger trg_homework_assignments_updated_at
  before update on public.homework_assignments
  for each row execute function public.set_updated_at();

/* ---------- ② homework_submissions — 제출 (append-only — 검수 27) ----------
   재제출은 이전 제출을 덮어쓰지 않는다: attempt_no를 올린 새 행이 최신 검토 대상이고
   이전 행은 그대로 보존된다. unique(tenant_id, assignment_id, attempt_no)가 동시 제출의
   회차 충돌을 DB에서 차단한다.
   · late: 마감 후 제출 표시 — 차단이 아니라 지연 사실 연결(H-02).
   · withdrawn_at: 검토 전 철회(H-02) — 행 삭제가 아니라 철회 시각 기록(이력 보존).
   · feedback_status: draft(미승인 — 알림·포털 비노출, 검수 28) → approved(게시 가능).
   · review_result: complete(과제 완료) / resubmit(보완 필요 → 재제출 요청 — H-03 분기). */

create table public.homework_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  assignment_id uuid not null,
  attempt_no int not null check (attempt_no >= 1),
  content text not null default '',
  file_path text, -- 비공개 homework 버킷 경로 (서명 URL로만 열람 — H-06 계열)
  file_name text,
  submitted_at timestamptz not null default now(), -- 실제 제출 시각 — 지연 판정의 근거(H-02)
  late boolean not null default false,
  withdrawn_at timestamptz, -- 검토 전 철회 시각 (검토 후 정정은 운영자 흐름 — H-02)
  review_status text not null default 'pending'
    check (review_status in ('pending', 'reviewed')),
  feedback text,
  feedback_status text
    check (feedback_status in ('draft', 'approved')), -- null = 피드백 없음
  feedback_approved_at timestamptz,
  review_result text
    check (review_result in ('complete', 'resubmit')), -- null = 판정 전
  created_at timestamptz not null default now(),
  unique (tenant_id, assignment_id, attempt_no), -- 재제출 회차 충돌 차단 (append-only의 유일 키)
  foreign key (tenant_id, assignment_id)
    references public.homework_assignments (tenant_id, id) on delete cascade
);

-- 미검토 제출 조회 경로 — "미검토 제출이 남아 있으면 전체 종료 금지"(검수 126) 판정용
create index idx_homework_submissions_pending
  on public.homework_submissions (tenant_id, assignment_id)
  where review_status = 'pending';

/* 제출 원문 불변 트리거(검수 27 · H-07):
   · UPDATE — 검토·피드백·철회 필드(review_status·feedback·feedback_status·
     feedback_approved_at·review_result·withdrawn_at)만 갱신 허용. 제출 원문
     (content·file_path·file_name·submitted_at·attempt_no)을 포함한 그 외 컬럼 변경은
     전면 거부(00013 activity_log_append_only와 동일 계열 — jsonb 대조).
   · DELETE — 직접 삭제 거부(과제 취소가 제출물을 지우지 않는다 — H-07). 단 부모 과제가
     이미 삭제된 CASCADE 경로(학생·테넌트 삭제)는 부모 부재 확인으로 통과시킨다 —
     과제 행 삭제 자체는 코드에서 막는다.
   트리거는 service_role(BYPASSRLS)에도 적용된다 — RLS가 아닌 무결성 규칙이기 때문. */
create or replace function public.homework_submission_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    -- 부모 과제가 남아 있는데 제출만 지우려는 것 = 직접 삭제 → 거부.
    -- 부모가 안 보이면 CASCADE 삭제 진행 중(학생·테넌트 삭제) → 통과.
    if exists (
      select 1 from public.homework_assignments
       where tenant_id = old.tenant_id and id = old.assignment_id
    ) then
      raise exception '[homework] 제출물은 직접 삭제할 수 없습니다 — 철회는 withdrawn_at, 정정은 새 제출본으로 (검수 27·H-07)';
    end if;
    return old;
  end if;
  if (to_jsonb(old) - 'review_status' - 'feedback' - 'feedback_status'
        - 'feedback_approved_at' - 'review_result' - 'withdrawn_at')
     = (to_jsonb(new) - 'review_status' - 'feedback' - 'feedback_status'
        - 'feedback_approved_at' - 'review_result' - 'withdrawn_at') then
    return new;
  end if;
  raise exception '[homework] 제출 원문은 불변 — 검토·피드백·철회 필드만 갱신할 수 있습니다. 재제출은 새 행(attempt_no+1)으로 (검수 27)';
end $$;

create trigger trg_homework_submissions_immutable
  before update or delete on public.homework_submissions
  for each row execute function public.homework_submission_immutable();

/* ---------- ③ homework_questions — 학생 질의응답 (H-04 · 검수 29) ----------
   질문은 원 기록(수업·과제·리포트) 중 최소 하나와 연결된다 — 연결 보장은 접수 코드가
   수행한다(assignment_id·lesson_id·report_id 중 하나 필수). 답변 게시(answer_status=
   'approved') 또는 해결 완료(status='resolved')로 닫힌다.
   · answer_status: draft(미승인 — 알림·포털 비노출, 검수 28·H-04) → approved(게시).
   · 다른 학생·무관계 보호자에게 질문 존재 자체를 노출하지 않는다(H-04) — 포털 조회
     코드가 student_id 스코프로 거른다(테넌트 격리는 RLS·앱 레이어 이중).
   · 원 기록 삭제 시 질문은 남긴다(set null) — 학습 이력 유지(H-04 해결 완료 예외). */

create table public.homework_questions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  student_id uuid not null,
  assignment_id uuid, -- 원 과제 연결
  lesson_id uuid,     -- 원 수업 연결
  report_id uuid, -- 원 리포트 연결 — 복합 FK는 테이블 말미(ai_reports unique 선행 필요)
  question text not null,
  asked_at timestamptz not null default now(),
  answer text,
  answer_status text
    check (answer_status in ('draft', 'approved')), -- null = 답변 없음
  answered_at timestamptz,
  status text not null default 'open'
    check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade,
  foreign key (tenant_id, assignment_id)
    references public.homework_assignments (tenant_id, id) on delete set null (assignment_id),
  foreign key (tenant_id, lesson_id)
    references public.lessons (tenant_id, id) on delete set null (lesson_id)
);

-- 열린 질문 조회 경로 — 열린 상태는 오늘 업무(work_items)로 수렴한다(정본 공통 규칙)
create index idx_homework_questions_tenant
  on public.homework_questions (tenant_id, status, created_at desc);
create index idx_homework_questions_student
  on public.homework_questions (student_id, created_at desc);

/* ---------- ④ RLS — 테넌트 격리 (00001 activity_log/lessons 계열과 동일 패턴) ---------- */

do $$
declare t text;
begin
  foreach t in array array[
    'homework_assignments', 'homework_submissions', 'homework_questions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy tenant_isolation on public.%I
         for all to authenticated
         using (tenant_id = public.jwt_tenant_id())
         with check (tenant_id = public.jwt_tenant_id())', t);
  end loop;
end $$;

/* ---------- EXECUTE 회수 (00012 §4·00013 수칙) ----------
   트리거 함수는 직접 호출이 불가능하지만(returns trigger) 같은 수칙으로 회수해 둔다. */
revoke execute on function public.homework_submission_immutable() from public, anon, authenticated;


/* ---------- 원 기록 교차 테넌트 차단 — 질문 report_id 복합 FK ----------
   단일 컬럼 FK는 타 테넌트 리포트 UUID 연결을 막지 못한다(검수 29 존재 비노출의 DB 방어선).
   00001 복합 FK 관례(부모 unique(tenant_id,id))를 ai_reports에도 적용한다. */
alter table public.ai_reports
  add constraint ai_reports_tenant_id_id_key unique (tenant_id, id);
alter table public.homework_questions
  add constraint homework_questions_tenant_report_fkey
  foreign key (tenant_id, report_id)
  references public.ai_reports (tenant_id, id) on delete set null (report_id);

/* ---------- 원자적 상태 전환 RPC (검수 126 · H-01 철회) ----------
   계수→갱신 두 문장 사이에 학생 제출이 끼어드는 TOCTOU를 없앤다 — 조건을 UPDATE의
   WHERE로 옮겨 단일 문장으로 판정·전환한다. 00011 정책대로 anon·authenticated EXECUTE 회수. */

-- 전체 종료: 미검토(pending·비철회) 제출이 없을 때만 assigned→closed (검수 126).
create or replace function public.close_homework_assignment(p_tenant_id uuid, p_id uuid)
returns boolean
language plpgsql
as $$
declare v_count int;
begin
  update public.homework_assignments a
     set status = 'closed', closed_at = now(), updated_at = now()
   where a.tenant_id = p_tenant_id and a.id = p_id and a.status = 'assigned'
     and not exists (
       select 1 from public.homework_submissions s
        where s.tenant_id = p_tenant_id and s.assignment_id = p_id
          and s.review_status = 'pending' and s.withdrawn_at is null);
  get diagnostics v_count = row_count;
  return v_count > 0;
end $$;
-- `public`을 빼면 회수가 무효다: 기본 ACL은 anon·authenticated에 직접 주는 게 아니라
-- PUBLIC에 EXECUTE를 주고 둘은 그 일원으로 상속받는다(00011이 겪은 사고와 같은 함정).
revoke execute on function public.close_homework_assignment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.close_homework_assignment(uuid, uuid) to service_role;

-- 배부 철회: 제출 이력이 전무할 때만 assigned→draft (제출물 딸린 과제를 초안으로 감추지 않는다 — H-07).
create or replace function public.retract_homework_assignment(p_tenant_id uuid, p_id uuid)
returns boolean
language plpgsql
as $$
declare v_count int;
begin
  update public.homework_assignments a
     set status = 'draft', assigned_at = null, updated_at = now()
   where a.tenant_id = p_tenant_id and a.id = p_id and a.status = 'assigned'
     and not exists (
       select 1 from public.homework_submissions s
        where s.tenant_id = p_tenant_id and s.assignment_id = p_id);
  get diagnostics v_count = row_count;
  return v_count > 0;
end $$;
-- `public`을 빼면 회수가 무효다: 기본 ACL은 anon·authenticated에 직접 주는 게 아니라
-- PUBLIC에 EXECUTE를 주고 둘은 그 일원으로 상속받는다(00011이 겪은 사고와 같은 함정).
revoke execute on function public.retract_homework_assignment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.retract_homework_assignment(uuid, uuid) to service_role;
