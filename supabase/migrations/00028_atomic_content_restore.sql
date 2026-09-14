-- Tombstones outlive deleted records and are applied before any backup can become live.
create table public.privacy_tombstones (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  table_name text not null,
  record_id uuid not null,
  erased_at timestamptz not null default now(),
  primary key(tenant_id,table_name,record_id)
);
alter table public.privacy_tombstones enable row level security;
create policy tenant_read on public.privacy_tombstones for select to authenticated using(tenant_id=public.jwt_tenant_id());
revoke insert,update,delete on public.privacy_tombstones from anon,authenticated;

create or replace function public.restore_content_backup(
  p_tenant uuid, p_backup uuid, p_target text, p_dry_run boolean default false, p_expected_hash text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare b record; v_snapshot jsonb; v_current jsonb; v_hash text; v_table text; v_columns text;
  v_rows jsonb; v_count int; v_filtered int:=0; v_key text; v_result jsonb; v_safety uuid;
begin
  if p_target not in ('faqs','ddays','reviews','recruit_status') and p_target not like 'settings:%' then
    return jsonb_build_object('ok',false,'reason','invalid_target');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('content:'||p_tenant::text||':'||p_target,0));
  lock table public.backups in share row exclusive mode;
  if p_target like 'settings:%' then lock table public.site_settings in share row exclusive mode;
  else execute format('lock table public.%I in share row exclusive mode', p_target); end if;
  select * into b from public.backups where tenant_id=p_tenant and id=p_backup and target=p_target for share;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  v_snapshot:=b.snapshot;
  if p_target like 'settings:%' then
    v_key:=substr(p_target,10);
    if length(v_key)=0 then return jsonb_build_object('ok',false,'reason','invalid_target'); end if;
    select value into v_current from public.site_settings where tenant_id=p_tenant and key=v_key for update;
  elsif p_target='recruit_status' then
    select to_jsonb(r) into v_current from public.recruit_status r where tenant_id=p_tenant for update;
  else
    v_table:=p_target;
    if jsonb_typeof(v_snapshot) is distinct from 'array' then return jsonb_build_object('ok',false,'reason','invalid_snapshot'); end if;
    execute format('select coalesce(jsonb_agg(to_jsonb(r) order by id),''[]''::jsonb) from public.%I r where tenant_id=$1',v_table) into v_current using p_tenant;
  end if;
  v_hash:=md5(coalesce(v_current::text,'null'));
  if not p_dry_run and (p_expected_hash is null or p_expected_hash<>v_hash) then
    return jsonb_build_object('ok',false,'reason','changed');
  end if;
  begin
    -- A savepoint covers snapshot validation, safety backup, replacement and all FK effects.
    insert into public.backups(tenant_id,target,snapshot) values(p_tenant,p_target,coalesce(v_current,'null'::jsonb)) returning id into v_safety;
    if v_table is not null then
      select coalesce(jsonb_agg(r || jsonb_build_object('tenant_id',p_tenant)), '[]'::jsonb) into v_rows
        from jsonb_array_elements(v_snapshot) r
       where not exists(select 1 from public.privacy_tombstones t where t.tenant_id=p_tenant and t.table_name=v_table and t.record_id=(r->>'id')::uuid)
         and not (v_table='reviews' and exists(select 1 from public.retention_records rr where rr.tenant_id=p_tenant and rr.subject_type='review' and rr.subject_id=(r->>'id')::uuid and rr.destroyed_at is not null));
      v_filtered:=jsonb_array_length(v_snapshot)-jsonb_array_length(v_rows);
      if v_table='reviews' then
        -- A restore never republishes consent-sensitive content. Current withdrawals remain intact.
        select coalesce(jsonb_agg(case when live.status='retracted' then to_jsonb(live) else
          '{"rating":5,"ai_tags":[],"screenshots":[],"is_pinned":false,"kind":"review","is_minor":false}'::jsonb || r ||
          jsonb_build_object('status','draft','approved_at',null,'masking_confirmed_at',null,'masking_confirmed_by',null,'published_at',null,'images_public',false)
          end),'[]'::jsonb) into v_rows
          from jsonb_array_elements(v_rows) r left join public.reviews live on live.tenant_id=p_tenant and live.id=(r->>'id')::uuid;
      end if;
      execute format('select count(*) from public.%I where tenant_id<>$1 and id in (select (r->>''id'')::uuid from jsonb_array_elements($2) r)',v_table) into v_count using p_tenant,v_rows;
      if v_count>0 then raise exception 'foreign tenant id'; end if;
      -- Reinsert only absent IDs; matching IDs are updated so their child references survive.
      execute format('delete from public.%I where tenant_id=$1 and id not in (select (r->>''id'')::uuid from jsonb_array_elements($2) r)%s',v_table,
        case when v_table='reviews' then ' and status<>''retracted''' else '' end) using p_tenant,v_rows;
      select string_agg(format('%I=excluded.%I',column_name,column_name),',') into v_columns
        from information_schema.columns where table_schema='public' and table_name=v_table and column_name not in ('id','tenant_id');
      execute format('insert into public.%I select * from jsonb_populate_recordset(null::public.%I,$1) on conflict(id) do update set %s',v_table,v_table,v_columns) using v_rows;
    elsif p_target='recruit_status' then
      if jsonb_typeof(v_snapshot) is distinct from 'object' then raise exception 'invalid snapshot'; end if;
      insert into public.recruit_status(tenant_id,status,message,seat_count,is_banner_visible)
        values(p_tenant,v_snapshot->>'status',v_snapshot->>'message',(v_snapshot->>'seat_count')::int,(v_snapshot->>'is_banner_visible')::boolean)
        on conflict(tenant_id) do update set status=excluded.status,message=excluded.message,seat_count=excluded.seat_count,is_banner_visible=excluded.is_banner_visible;
    else
      insert into public.site_settings(tenant_id,key,value) values(p_tenant,v_key,v_snapshot)
        on conflict(tenant_id,key) do update set value=excluded.value,updated_at=now();
    end if;
    v_result:=jsonb_build_object('ok',true,'current_hash',v_hash,'excluded',v_filtered,'review_drafts',v_table='reviews');
    if p_dry_run then raise exception using errcode='PT001',message='restore rehearsal rollback'; end if;
    delete from public.backups where tenant_id=p_tenant and target=p_target and id in
      (select id from public.backups where tenant_id=p_tenant and target=p_target
       order by (id=v_safety) desc,created_at desc,id desc offset 12);
    return v_result;
  exception when sqlstate 'PT001' then return v_result;
    when others then return jsonb_build_object('ok',false,'reason','invalid_snapshot');
  end;
end $$;
revoke all on function public.restore_content_backup(uuid,uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.restore_content_backup(uuid,uuid,text,boolean,text) to service_role;
