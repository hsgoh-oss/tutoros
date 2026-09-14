-- Explicit, resumable erasure. Database changes and the file manifest commit together.
-- Completion requires successful Storage cleanup and an operator's external/backup evidence.
alter table public.students add column service_erased_at timestamptz;
alter table public.retention_records add constraint retention_records_tenant_id_id_key unique(tenant_id,id);
-- Deleted schedules detach historical consumption rows. Only manual grants/adjustments are
-- deduplicated without a schedule; identical attendance reasons on two lessons remain distinct.
drop index public.session_ledger_manual_dedup;
create unique index session_ledger_manual_dedup
  on public.session_ledger(tenant_id,package_id,kind,delta,md5(btrim(reason)))
  where schedule_id is null and kind in ('grant','adjust');
create table public.privacy_erasure_jobs (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  retention_id uuid not null,
  database_deleted_at timestamptz not null default now(),
  files jsonb not null default '[]' check(jsonb_typeof(files)='array'),
  storage_completed_at timestamptz,
  external_file_count int not null default 0,
  completed_at timestamptz,
  actor_email text not null,
  primary key(tenant_id,retention_id),
  foreign key(tenant_id,retention_id) references public.retention_records(tenant_id,id) on delete cascade
);
alter table public.privacy_erasure_jobs enable row level security;
create policy tenant_read on public.privacy_erasure_jobs for select to authenticated using(tenant_id=public.jwt_tenant_id());
revoke all on public.privacy_erasure_jobs from anon,authenticated;
grant select on public.privacy_erasure_jobs to authenticated;
grant all on public.privacy_erasure_jobs,public.privacy_tombstones to service_role;

create or replace function public.begin_retention_erasure(p_tenant uuid,p_id uuid,p_actor text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.retention_records; v_files jsonb:='[]'; v_student uuid; v_contacts uuid[]; v_forms uuid[]; v_latest timestamptz;
begin
  -- Rare operator operation: serialize against CRUD, restored snapshots and simultaneous holds.
  -- A conflict aborts the whole transaction; no source row is removed without its durable manifest.
  lock table public.backups, public.retention_records, public.privacy_erasure_jobs,
    public.students, public.consultations, public.enrollments, public.contracts, public.lesson_packages,
    public.schedules, public.attendance_corrections, public.booking_restrictions,
    public.payments, public.payssam_events, public.consents, public.reviews,
    public.review_invitations, public.intake_forms, public.trial_sessions, public.waitlist_offers,
    public.lessons, public.ai_reports, public.grade_records, public.lesson_materials,
    public.homework_assignments, public.homework_questions, public.homework_submissions,
    public.notifications, public.portal_contacts, public.portal_relations, public.portal_sessions,
    public.work_items in share row exclusive mode;
  select * into r from public.retention_records where tenant_id=p_tenant and id=p_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  if r.hold_at is not null then return jsonb_build_object('ok',false,'reason','held'); end if;
  if r.destroyed_at is not null then return jsonb_build_object('ok',false,'reason','completed'); end if;
  if exists(select 1 from public.privacy_erasure_jobs where tenant_id=p_tenant and retention_id=p_id) then
    return jsonb_build_object('ok',true); -- Retry only the remaining storage work.
  end if;
  if r.retain_until > (now() at time zone 'Asia/Seoul')::date then return jsonb_build_object('ok',false,'reason','not_due'); end if;
  if exists(select 1 from public.retention_records where tenant_id=p_tenant and subject_type=r.subject_type and subject_id=r.subject_id and hold_at is not null) then
    return jsonb_build_object('ok',false,'reason','held');
  end if;
  if exists(select 1 from public.work_items where tenant_id=p_tenant and source_id=r.subject_id::text and status in ('open','in_progress')) then
    return jsonb_build_object('ok',false,'reason','active');
  end if;

  if r.category in ('student_service','consent_proof') and r.subject_type='student' then
    v_student:=r.subject_id;
    if exists(select 1 from public.students where tenant_id=p_tenant and id=v_student and status<>'ended')
       or exists(select 1 from public.enrollments where tenant_id=p_tenant and student_id=v_student and (status in ('active','pending') or ended_at>r.started_at))
       or exists(select 1 from public.schedules where tenant_id=p_tenant and student_id=v_student and status in ('planned','makeup'))
       or exists(select 1 from public.attendance_corrections ac join public.schedules sc on sc.tenant_id=ac.tenant_id and sc.id=ac.schedule_id
         where ac.tenant_id=p_tenant and sc.student_id=v_student and ac.status='pending')
       or exists(select 1 from public.lesson_packages where tenant_id=p_tenant and student_id=v_student and status='active')
       or exists(select 1 from public.payments where tenant_id=p_tenant and student_id=v_student and status in ('draft','pending','overdue')) then
      return jsonb_build_object('ok',false,'reason','active');
    end if;
  end if;

  if r.category='student_service' and r.subject_type='student' then
    if not exists(select 1 from public.students where tenant_id=p_tenant and id=v_student) then
      return jsonb_build_object('ok',false,'reason','source_missing');
    end if;
    if exists(select 1 from public.retention_records rr join public.payments p on p.tenant_id=rr.tenant_id and p.id=rr.subject_id
       where rr.tenant_id=p_tenant and rr.subject_type='payment' and rr.hold_at is not null and p.student_id=v_student) then
      return jsonb_build_object('ok',false,'reason','held');
    end if;
    select coalesce(jsonb_agg(f),'[]') into v_files from (
      select jsonb_build_object('bucket','homework','location',s.file_path) f from public.homework_submissions s
        join public.homework_assignments a on a.tenant_id=s.tenant_id and a.id=s.assignment_id
        where a.tenant_id=p_tenant and a.student_id=v_student and s.file_path is not null
      union all
      select jsonb_build_object('bucket','materials','location',m.file_url) from public.lesson_materials m
        where m.tenant_id=p_tenant and (m.student_id=v_student or m.lesson_id in (select id from public.lessons where tenant_id=p_tenant and student_id=v_student))
    ) files;
    if exists(select 1 from public.lesson_materials m where m.tenant_id=p_tenant
      and m.student_id is distinct from v_student and (m.lesson_id is null or m.lesson_id not in (select id from public.lessons where tenant_id=p_tenant and student_id=v_student))
      and m.file_url in (select f->>'location' from jsonb_array_elements(v_files) f where f->>'bucket'='materials')) then
      return jsonb_build_object('ok',false,'reason','shared_file');
    end if;
    select array_agg(contact_id) into v_contacts from public.portal_relations where tenant_id=p_tenant and student_id=v_student;
    delete from public.portal_relations where tenant_id=p_tenant and student_id=v_student;
    delete from public.portal_contacts c where c.tenant_id=p_tenant and c.id=any(v_contacts)
      and not exists(select 1 from public.portal_relations rel where rel.tenant_id=p_tenant and rel.contact_id=c.id);
    delete from public.homework_questions where tenant_id=p_tenant and student_id=v_student;
    delete from public.homework_assignments where tenant_id=p_tenant and student_id=v_student;
    delete from public.notifications where tenant_id=p_tenant and (student_id=v_student or report_id in
      (select id from public.ai_reports where tenant_id=p_tenant and student_id=v_student));
    delete from public.ai_reports where tenant_id=p_tenant and student_id=v_student;
    delete from public.lesson_materials where tenant_id=p_tenant and (student_id=v_student or lesson_id in (select id from public.lessons where tenant_id=p_tenant and student_id=v_student));
    delete from public.schedules where tenant_id=p_tenant and student_id=v_student;
    delete from public.lessons where tenant_id=p_tenant and student_id=v_student;
    delete from public.grade_records where tenant_id=p_tenant and student_id=v_student;
    delete from public.booking_restrictions where tenant_id=p_tenant and student_id=v_student;
    update public.students set name='파기된 학생',parent_phone='',student_phone=null,school=null,grade=null,
      subject_type=null,notion_page_id=null,service_erased_at=now() where tenant_id=p_tenant and id=v_student;
    insert into public.privacy_tombstones(tenant_id,table_name,record_id) values(p_tenant,'students',v_student) on conflict do nothing;

  elsif r.category='consultation_intake' and r.subject_type='consultation' then
    if not exists(select 1 from public.consultations where tenant_id=p_tenant and id=r.subject_id) then
      return jsonb_build_object('ok',false,'reason','source_missing');
    end if;
    select max(coalesce(responded_at,expires_at)) into v_latest from public.waitlist_offers where tenant_id=p_tenant and consultation_id=r.subject_id;
    if v_latest is null or v_latest>r.started_at
       or exists(select 1 from public.consultations where tenant_id=p_tenant and id=r.subject_id and (student_id is not null or status='registered'))
       or exists(select 1 from public.enrollments where tenant_id=p_tenant and consultation_id=r.subject_id)
       or exists(select 1 from public.waitlist_offers where tenant_id=p_tenant and consultation_id=r.subject_id and status in ('offered','accepted'))
       or exists(select 1 from public.trial_sessions where tenant_id=p_tenant and consultation_id=r.subject_id and (status in ('proposed','scheduled') or payment_id is not null)) then
      return jsonb_build_object('ok',false,'reason','active');
    end if;
    -- Preserve consent proof under its own policy after the consultation source is removed.
    insert into public.retention_records(tenant_id,subject_type,subject_id,subject_label,category,event,started_at,retain_until,policy_days,policy_label)
      values(p_tenant,'consultation',r.subject_id,r.subject_label,'consent_proof',r.event,r.started_at,
        (r.started_at at time zone 'Asia/Seoul')::date+365,365,'내부 운영 기준: 상담 종료 후 1년') on conflict do nothing;
    delete from public.consultations where tenant_id=p_tenant and id=r.subject_id;
    insert into public.privacy_tombstones(tenant_id,table_name,record_id) values(p_tenant,'consultations',r.subject_id) on conflict do nothing;

  elsif r.category='consent_proof' and r.subject_type in ('student','consultation') then
    if exists(select 1 from public.consents where tenant_id=p_tenant and subject_type=r.subject_type and subject_id=r.subject_id and consented_at>r.started_at) then
      return jsonb_build_object('ok',false,'reason','active');
    end if;
    if r.subject_type='consultation' and exists(select 1 from public.consultations where tenant_id=p_tenant and id=r.subject_id) then
      return jsonb_build_object('ok',false,'reason','active');
    end if;
    if r.subject_type='student' then
      select array_agg(form_id) into v_forms from public.enrollments where tenant_id=p_tenant and student_id=r.subject_id and form_id is not null;
      if exists(select 1 from public.enrollments where tenant_id=p_tenant and form_id=any(v_forms) and student_id<>r.subject_id) then
        return jsonb_build_object('ok',false,'reason','related_retention');
      end if;
      delete from public.intake_forms where tenant_id=p_tenant and id=any(v_forms);
    end if;
    delete from public.consents where tenant_id=p_tenant and subject_type=r.subject_type and subject_id=r.subject_id;

  elsif r.category='review_consent' and r.subject_type='review' then
    if not exists(select 1 from public.reviews where tenant_id=p_tenant and id=r.subject_id and status='retracted' and retracted_at<=r.started_at) then
      return jsonb_build_object('ok',false,'reason','active');
    end if;
    if exists(select 1 from public.reviews x join public.reviews y on y.tenant_id=x.tenant_id and y.id<>x.id and y.screenshots && x.screenshots
      where x.tenant_id=p_tenant and x.id=r.subject_id) then return jsonb_build_object('ok',false,'reason','shared_file'); end if;
    select coalesce(jsonb_agg(jsonb_build_object('bucket',b,'location',path)),'[]') into v_files
      from public.reviews rv cross join lateral unnest(rv.screenshots) path cross join unnest(array['reviews','review-evidence']) b
      where rv.tenant_id=p_tenant and rv.id=r.subject_id;
    delete from public.review_invitations where tenant_id=p_tenant and (review_id=r.subject_id or id in (select invitation_id from public.reviews where tenant_id=p_tenant and id=r.subject_id));
    delete from public.reviews where tenant_id=p_tenant and id=r.subject_id;
    insert into public.privacy_tombstones(tenant_id,table_name,record_id) values(p_tenant,'reviews',r.subject_id) on conflict do nothing;
    update public.backups b set snapshot=coalesce((select jsonb_agg(item) from jsonb_array_elements(b.snapshot) item where item->>'id'<>r.subject_id::text),'[]'::jsonb)
      where b.tenant_id=p_tenant and b.target='reviews' and jsonb_typeof(b.snapshot)='array';

  elsif r.category='payment_legal' and r.subject_type='payment' then
    select student_id into v_student from public.payments where tenant_id=p_tenant and id=r.subject_id and status in ('paid','refunded');
    if v_student is null then return jsonb_build_object('ok',false,'reason','source_missing'); end if;
    -- Payments have no enrollment FK. Remove contract evidence only when every related term and
    -- transaction has expired; never guess which recent contract an old receipt belongs to.
    if exists(select 1 from public.enrollments where tenant_id=p_tenant and student_id=v_student and (status<>'ended' or (ended_at at time zone 'Asia/Seoul')::date+1825>(now() at time zone 'Asia/Seoul')::date))
      or exists(select 1 from public.lesson_packages where tenant_id=p_tenant and student_id=v_student and status='active')
      or exists(select 1 from public.payments where tenant_id=p_tenant and student_id=v_student and (status not in ('paid','refunded') or paid_at is null or (greatest(paid_at,refunded_at) at time zone 'Asia/Seoul')::date+1825>(now() at time zone 'Asia/Seoul')::date))
      or exists(select 1 from public.retention_records rr where rr.tenant_id=p_tenant and rr.hold_at is not null and
        ((rr.subject_type='student' and rr.subject_id=v_student) or (rr.subject_type='payment' and rr.subject_id in(select id from public.payments where tenant_id=p_tenant and student_id=v_student)))) then
      return jsonb_build_object('ok',false,'reason','related_retention');
    end if;
    delete from public.payssam_events where tenant_id=p_tenant and (payment_id=r.subject_id or bill_id in(select bill_id from public.payments where tenant_id=p_tenant and id=r.subject_id));
    delete from public.payments where tenant_id=p_tenant and id=r.subject_id;
    delete from public.contracts where tenant_id=p_tenant and enrollment_id in(select id from public.enrollments where tenant_id=p_tenant and student_id=v_student);
    insert into public.privacy_tombstones(tenant_id,table_name,record_id) values(p_tenant,'payments',r.subject_id) on conflict do nothing;
  else return jsonb_build_object('ok',false,'reason','unsupported');
  end if;
  insert into public.privacy_erasure_jobs(tenant_id,retention_id,files,actor_email) values(p_tenant,p_id,v_files,p_actor);
  return jsonb_build_object('ok',true);
exception when others then
  -- All deletes above roll back on any constraint, concurrency or storage-manifest error.
  return jsonb_build_object('ok',false,'reason','database_failed');
end $$;

create or replace function public.finish_retention_erasure(p_tenant uuid,p_id uuid,p_actor text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.retention_records;
begin
  select * into r from public.retention_records where tenant_id=p_tenant and id=p_id for update;
  if not found or r.hold_at is not null or r.destroyed_at is not null then return jsonb_build_object('ok',false,'reason','unavailable'); end if;
  if length(btrim(coalesce(p_note,'')))<10 then return jsonb_build_object('ok',false,'reason','evidence_required'); end if;
  if not exists(select 1 from public.privacy_erasure_jobs where tenant_id=p_tenant and retention_id=p_id and storage_completed_at is not null) then
    return jsonb_build_object('ok',false,'reason','incomplete');
  end if;
  update public.privacy_erasure_jobs set completed_at=now(),files='[]'::jsonb where tenant_id=p_tenant and retention_id=p_id;
  update public.retention_records set destroyed_at=now(),destroyed_by=p_actor,destroyed_note=p_note,subject_label='파기된 대상',updated_at=now() where tenant_id=p_tenant and id=p_id;
  return jsonb_build_object('ok',true);
end $$;

-- Old clients cannot mark a record complete without an erasure job.
create or replace function public.require_erasure_completion() returns trigger language plpgsql set search_path=public as $$
begin
  if old.destroyed_at is null and new.destroyed_at is not null and not exists(
    select 1 from public.privacy_erasure_jobs where tenant_id=new.tenant_id and retention_id=new.id and completed_at is not null and storage_completed_at is not null) then
    raise exception 'Complete database, storage and external verification first';
  end if;
  return new;
end $$;
create trigger retention_requires_erasure before update on public.retention_records for each row execute function public.require_erasure_completion();

-- Retained identity keys must never become active student profiles again.
create or replace function public.prevent_erased_student_write() returns trigger language plpgsql set search_path=public as $$
declare v_id uuid;
begin
  if tg_table_name='students' then
    v_id:=new.id;
  else v_id:=new.student_id;
  end if;
  if exists(select 1 from public.privacy_tombstones where tenant_id=new.tenant_id and table_name='students' and record_id=v_id) then
    -- An expired application form detaches from retained enrollment proof through its FK.
    if tg_table_name='enrollments' and tg_op='UPDATE' then
      if old.form_id is not null and new.form_id is null and (to_jsonb(old)-'form_id')=(to_jsonb(new)-'form_id')
        and not exists(select 1 from public.intake_forms where tenant_id=old.tenant_id and id=old.form_id) then return new; end if;
    end if;
    raise exception 'Student service data has been erased';
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['students','schedules','lessons','ai_reports','grade_records','lesson_materials','homework_assignments','homework_questions','enrollments','portal_relations','notifications'] loop
    execute format('create trigger prevent_erased_student before insert or update on public.%I for each row execute function public.prevent_erased_student_write()',t);
  end loop;
end $$;
revoke all on function public.begin_retention_erasure(uuid,uuid,text),public.finish_retention_erasure(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.begin_retention_erasure(uuid,uuid,text),public.finish_retention_erasure(uuid,uuid,text,text) to service_role;

-- A backup fetched before erasure can arrive afterwards. Strip erased reviews on every write.
create or replace function public.filter_erased_review_backup() returns trigger language plpgsql set search_path=public as $$
begin
  if new.target='reviews' and jsonb_typeof(new.snapshot)='array' then
    select coalesce(jsonb_agg(item),'[]'::jsonb) into new.snapshot from jsonb_array_elements(new.snapshot) item
    where not exists(select 1 from public.privacy_tombstones t where t.tenant_id=new.tenant_id and t.table_name='reviews' and t.record_id::text=item->>'id')
      and not exists(select 1 from public.retention_records r where r.tenant_id=new.tenant_id and r.subject_type='review' and r.subject_id::text=item->>'id' and r.destroyed_at is not null);
  end if;
  return new;
end $$;
create trigger filter_erased_reviews before insert or update on public.backups for each row execute function public.filter_erased_review_backup();
