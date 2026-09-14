-- Calendar registration participates in the same student lock as package generation/makeup.
create or replace function public.calendar_package_candidates(p_tenant uuid, p_student uuid, p_at timestamptz)
returns table(id uuid, title text, contract_id uuid, remaining bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.title, p.contract_id, b.remaining::bigint
    from public.lesson_packages p
    join public.enrollments e on e.tenant_id = p.tenant_id and e.id = p.enrollment_id
    join public.contracts c on c.tenant_id = p.tenant_id and c.id = p.contract_id
    left join public.lesson_package_balances b on b.tenant_id = p.tenant_id and b.package_id = p.id
   where p.tenant_id = p_tenant and p.student_id = p_student and p.status = 'active'
     and e.status = 'active' and c.agreed_at is not null
     and e.activated_at <= p_at and (e.ended_at is null or p_at < e.ended_at)
     and p.starts_on <= (p_at at time zone 'Asia/Seoul')::date;
$$;

create or replace function public.create_calendar_schedule(
  p_tenant uuid, p_student uuid, p_at timestamptz, p_duration int, p_class_type text,
  p_package text default 'auto'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_package uuid; v_contract uuid; v_count int; v_student record;
begin
  if p_at is null or not isfinite(p_at) or p_duration is null or p_duration < 15 or p_duration > 480
     or p_duration % 15 <> 0 or p_class_type is null or p_class_type not in ('inperson','video') then
    return jsonb_build_object('ok',false,'reason','invalid_input');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':' || p_student::text, 0));
  select * into v_student from public.students where tenant_id=p_tenant and id=p_student for update;
  if not found then return jsonb_build_object('ok',false,'reason','student_missing'); end if;
  if to_jsonb(v_student)->>'service_erased_at' is not null then return jsonb_build_object('ok',false,'reason','student_missing'); end if;
  if exists(select 1 from public.booking_restrictions where tenant_id=p_tenant and student_id=p_student and status='active') then
    return jsonb_build_object('ok',false,'reason','restricted');
  end if;
  if p_package is distinct from 'standalone' then
    select count(*), (array_agg(id))[1], (array_agg(contract_id))[1] into v_count,v_package,v_contract
      from public.calendar_package_candidates(p_tenant,p_student,p_at);
    if v_count > 1 then return jsonb_build_object('ok',false,'reason','ambiguous_package'); end if;
    if p_package is distinct from 'auto' and (v_package is null or p_package <> v_package::text) then
      return jsonb_build_object('ok',false,'reason','package_unavailable');
    end if;
    if v_package is not null then
      perform 1 from public.lesson_packages p join public.enrollments e on e.tenant_id=p.tenant_id and e.id=p.enrollment_id join public.contracts c on c.tenant_id=p.tenant_id and c.id=p.contract_id
        where p.tenant_id=p_tenant and p.id=v_package and p.status='active' and e.status='active' and c.agreed_at is not null for update of p,e,c;
      if not found then return jsonb_build_object('ok',false,'reason','package_unavailable'); end if;
    end if;
  end if;
  if exists(select 1 from public.schedules s where s.tenant_id=p_tenant and s.student_id=p_student
    and s.status in ('planned','makeup','done')
    and public.schedule_span(s.scheduled_at,s.ends_at) && public.schedule_span(p_at,p_at + make_interval(mins=>p_duration))) then
    return jsonb_build_object('ok',false,'reason','overlap');
  end if;
  insert into public.schedules(tenant_id,student_id,scheduled_at,ends_at,class_type,status,package_id,contract_id)
    values(p_tenant,p_student,p_at,p_at+make_interval(mins=>p_duration),p_class_type,'planned',v_package,v_contract)
    returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id,'package_id',v_package);
exception when unique_violation then
  return jsonb_build_object('ok',false,'reason','slot_used');
end $$;

revoke all on function public.calendar_package_candidates(uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.create_calendar_schedule(uuid,uuid,timestamptz,int,text,text) from public,anon,authenticated;
grant execute on function public.calendar_package_candidates(uuid,uuid,timestamptz) to service_role;
grant execute on function public.create_calendar_schedule(uuid,uuid,timestamptz,int,text,text) to service_role;
