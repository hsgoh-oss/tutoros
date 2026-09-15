-- 성인 본인 연락·납부: 보호자 정보를 요구하지 않는다. 기존 학생은 기존 방식 유지.
alter table public.students
  add column is_adult boolean not null default false,
  alter column parent_phone drop not null;

comment on column public.students.is_adult is
  '성인 본인 연락·납부. 본인 학생 포털에 수납 내역 접근을 함께 부여한다.';

alter table public.students add constraint students_contact_required check (
  service_erased_at is not null
  or (is_adult and nullif(btrim(student_phone), '') is not null)
  or (not is_adult and nullif(btrim(parent_phone), '') is not null)
);
