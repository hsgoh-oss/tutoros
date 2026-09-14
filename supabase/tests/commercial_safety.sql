\set ON_ERROR_STOP on
begin;
create function pg_temp.check_ok(value boolean, label text) returns void language plpgsql as $$ begin
  if value is distinct from true then raise exception 'FAIL: %',label; end if;
  raise notice 'PASS: %',label;
end $$;
do $$
declare t uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); s uuid:=gen_random_uuid();
 e uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); x uuid; b uuid; bad_backup uuid; r uuid;
 result jsonb; rehearsal jsonb; before_rows jsonb; n int; rv uuid:=gen_random_uuid(); consult uuid:=gen_random_uuid(); payment uuid:=gen_random_uuid(); form_id uuid:=gen_random_uuid(); form_consult uuid:=gen_random_uuid();
begin
 insert into public.tenants(id,brand_name,email) values(t,'Safety fixture','safety@example.invalid'),(other,'Other fixture','other@example.invalid');
 insert into public.students(id,tenant_id,name,parent_phone) values(s,t,'Fixture','01000000000');
 insert into public.enrollments(id,tenant_id,student_id,status,relation_ok,contract_ok,payment_ok,schedule_ok,activated_at)
 values(e,t,s,'active',true,true,true,true,'2018-01-01');
 insert into public.contracts(id,tenant_id,enrollment_id,terms,agreed_at,agreed_by_name,agreed_by_phone)
 values(c,t,e,'{}','2018-01-01','Fixture','01000000000');
 insert into public.lesson_packages(id,tenant_id,enrollment_id,contract_id,student_id,title,total_sessions,starts_on,status,activated_at)
 values(p,t,e,c,s,'Fixture package',8,'2018-01-01','active','2018-01-01');
 result:=public.create_calendar_schedule(t,s,'2020-01-01 10:00+09',60,'video','auto');
 perform pg_temp.check_ok((result->>'ok')::boolean and result->>'package_id'=p::text,'calendar links the active package');
 x:=(result->>'id')::uuid;
 perform pg_temp.check_ok((select contract_id=c from public.schedules where id=x),'calendar links agreed contract');
 result:=public.settle_attendance(t,x,'present',true,'Fixture','test');
 perform pg_temp.check_ok((result->>'ok')::boolean,'new calendar session deducts');
 result:=public.settle_attendance(t,x,'present',true,'Retry','test');
 perform pg_temp.check_ok(not (result->>'ok')::boolean and (select remaining=7 from public.lesson_package_balances where package_id=p),'repeat attendance never double deducts');
 result:=public.create_calendar_schedule(t,s,'2020-01-01 10:30+09',60,'video','auto');
 perform pg_temp.check_ok(result->>'reason'='overlap','manual registration rejects overlap with done session');
 result:=public.create_calendar_schedule(other,s,'2020-01-02',60,'video','auto');
 perform pg_temp.check_ok(result->>'reason'='student_missing','calendar rejects another tenant student');
 result:=public.create_calendar_schedule(t,s,'2020-01-02',60,'video','standalone');
 perform pg_temp.check_ok((result->>'ok')::boolean and result->>'package_id' is null,'explicit standalone remains uncharged');
 result:=public.create_calendar_schedule(t,s,'2020-01-04',60,'video','auto');
 result:=public.settle_attendance(t,(result->>'id')::uuid,'present',true,'Fixture','test');
 perform pg_temp.check_ok((result->>'ok')::boolean,'second lesson keeps a distinct ledger entry with the same reason');
 result:=public.create_calendar_schedule(t,s,'2020-01-03',60,'video',gen_random_uuid()::text);
 perform pg_temp.check_ok(result->>'reason'='package_unavailable','stale package selection rejected');

 -- Failed restoration must undo deletion, replacements and its safety backup.
 insert into public.faqs(tenant_id,question,answer) values(t,'Original','Keep me');
 select jsonb_agg(to_jsonb(f)) into before_rows from public.faqs f where tenant_id=t;
 insert into public.backups(tenant_id,target,snapshot) values(t,'faqs',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'question','Broken'))) returning id into b;
 bad_backup:=b;
 result:=public.restore_content_backup(t,b,'faqs',true);
 perform pg_temp.check_ok(not (result->>'ok')::boolean and (select jsonb_agg(to_jsonb(f))=before_rows from public.faqs f where tenant_id=t),'invalid restore leaves current rows intact');
 insert into public.backups(tenant_id,target,snapshot) values(t,'faqs',jsonb_set(before_rows,'{0,answer}','"Restored"')) returning id into b;
 rehearsal:=public.restore_content_backup(t,b,'faqs',true);
 perform pg_temp.check_ok((rehearsal->>'ok')::boolean and (select answer='Keep me' from public.faqs where tenant_id=t),'dry run does not modify live content');
 result:=public.restore_content_backup(t,bad_backup,'faqs',false,rehearsal->>'current_hash');
 perform pg_temp.check_ok(not (result->>'ok')::boolean and (select answer='Keep me' from public.faqs where tenant_id=t),'failed real restore rolls back deletion');
 result:=public.restore_content_backup(t,b,'faqs',false,rehearsal->>'current_hash');
 perform pg_temp.check_ok((result->>'ok')::boolean and (select answer='Restored' from public.faqs where tenant_id=t),'valid restore commits atomically');
 result:=public.restore_content_backup(t,b,'faqs',false,rehearsal->>'current_hash');
 perform pg_temp.check_ok(result->>'reason'='changed','stale restoration rejected');
 result:=public.restore_content_backup(other,b,'faqs',true);
 perform pg_temp.check_ok(result->>'reason'='not_found','restore tenant boundary');
 insert into public.backups(tenant_id,target,snapshot) values(t,'ddays','[]') returning id into b;
 rehearsal:=public.restore_content_backup(t,b,'ddays',true);
 perform pg_temp.check_ok((rehearsal->>'ok')::boolean,'empty valid backup can be rehearsed');
 insert into public.backups(tenant_id,target,snapshot) values(t,'recruit_status','{"status":"closed","message":"Fixture","is_banner_visible":false}') returning id into b;
 rehearsal:=public.restore_content_backup(t,b,'recruit_status',true);
 result:=public.restore_content_backup(t,b,'recruit_status',false,rehearsal->>'current_hash');
 perform pg_temp.check_ok((result->>'ok')::boolean and (select status='closed' from public.recruit_status where tenant_id=t),'recruit restore');
 insert into public.backups(tenant_id,target,snapshot) values(t,'settings:site_info','{"brandName":"Fixture"}') returning id into b;
 rehearsal:=public.restore_content_backup(t,b,'settings:site_info',true);
 result:=public.restore_content_backup(t,b,'settings:site_info',false,rehearsal->>'current_hash');
 perform pg_temp.check_ok((result->>'ok')::boolean,'settings restore');

 insert into public.reviews(id,tenant_id,reviewer_type,content,status,approved_at,masking_confirmed_at,published_at) values(rv,t,'parent','Fixture review','published',now(),now(),now());
 insert into public.backups(tenant_id,target,snapshot) select t,'reviews',jsonb_agg(to_jsonb(v)) from public.reviews v where id=rv returning id into b;
 rehearsal:=public.restore_content_backup(t,b,'reviews',true);
 result:=public.restore_content_backup(t,b,'reviews',false,rehearsal->>'current_hash');
 perform pg_temp.check_ok((result->>'ok')::boolean and (select status='draft' and not images_public from public.reviews where id=rv),'restored reviews never republish');
 update public.reviews set status='retracted',retracted_at='2020-01-01' where id=rv;
 rehearsal:=public.restore_content_backup(t,b,'reviews',true);
 result:=public.restore_content_backup(t,b,'reviews',false,rehearsal->>'current_hash');
 perform pg_temp.check_ok((select status='retracted' from public.reviews where id=rv),'current withdrawal survives an old published backup');
 insert into public.retention_records(tenant_id,subject_type,subject_id,subject_label,category,event,started_at,retain_until,policy_days,policy_label)
 values(t,'review',rv,'Fixture','review_consent','review_retracted','2020-01-01','2023-01-01',1095,'Fixture') returning id into r;
 result:=public.finish_retention_erasure(t,r,'test','External evidence fixture');
 perform pg_temp.check_ok(result->>'reason'='incomplete','cannot mark destruction complete before deleting');
 update public.retention_records set retain_until=current_date+10 where id=r;
 result:=public.begin_retention_erasure(t,r,'test');
 perform pg_temp.check_ok(result->>'reason'='not_due' and exists(select 1 from public.reviews where id=rv),'unexpired retention blocks deletion');
 update public.retention_records set retain_until='2023-01-01' where id=r;
 begin
   update public.retention_records set destroyed_at=now(),destroyed_by='test',destroyed_note='Legacy bypass attempt' where id=r;
   raise exception 'FAIL: direct completion was allowed';
 exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
 update public.retention_records set hold_at=now(),hold_by='test',hold_reason='Fixture hold' where id=r;
 result:=public.begin_retention_erasure(t,r,'test');
 perform pg_temp.check_ok(result->>'reason'='held' and exists(select 1 from public.reviews where id=rv),'hold blocks actual deletion');
 update public.retention_records set hold_at=null where id=r;
 result:=public.begin_retention_erasure(other,r,'test');
 perform pg_temp.check_ok(result->>'reason'='not_found','erasure tenant boundary');
 result:=public.begin_retention_erasure(t,r,'test');
 perform pg_temp.check_ok((result->>'ok')::boolean and not exists(select 1 from public.reviews where id=rv),'review erasure removes source');
 perform pg_temp.check_ok((select jsonb_array_length(snapshot)=0 from public.backups where id=b),'erasure scrubs stored review backup');
 result:=public.begin_retention_erasure(t,r,'test');
 perform pg_temp.check_ok((result->>'ok')::boolean,'erasure retry is idempotent');
 result:=public.finish_retention_erasure(t,r,'test','External evidence fixture');
 perform pg_temp.check_ok(result->>'reason'='incomplete','file work must be completed first');
 update public.privacy_erasure_jobs set storage_completed_at=now() where tenant_id=t and retention_id=r;
 result:=public.finish_retention_erasure(t,r,'test','External evidence fixture');
 perform pg_temp.check_ok((result->>'ok')::boolean and (select destroyed_at is not null from public.retention_records where id=r),'completion follows database, file and external evidence');
 -- Even a newly imported old backup cannot revive an erased ID.
 update public.backups set snapshot=jsonb_build_array(jsonb_build_object('id',rv,'reviewer_type','parent','content','Old deleted content')) where id=b;
 perform pg_temp.check_ok((select jsonb_array_length(snapshot)=0 from public.backups where id=b),'late backup cannot retain erased review content');
 rehearsal:=public.restore_content_backup(t,b,'reviews',true);
 result:=public.restore_content_backup(t,b,'reviews',false,rehearsal->>'current_hash');
 perform pg_temp.check_ok((result->>'ok')::boolean and not exists(select 1 from public.reviews where id=rv),'tombstone blocks revival from imported backup');

 insert into public.retention_records(tenant_id,subject_type,subject_id,subject_label,category,event,started_at,retain_until,policy_days,policy_label)
 values(t,'student',s,'Fixture','student_service','enrollment_ended','2020-01-01','2021-01-01',365,'Fixture') returning id into r;
 result:=public.begin_retention_erasure(t,r,'test');
 perform pg_temp.check_ok(result->>'reason'='active','active student cannot be erased');
 update public.students set status='ended' where id=s;
 update public.enrollments set status='ended',ended_at='2020-01-01' where id=e;
 update public.lesson_packages set status='ended',ended_at='2020-01-01' where id=p;
 update public.schedules set status='canceled' where tenant_id=t and student_id=s and status='planned';
 insert into public.attendance_corrections(tenant_id,schedule_id,requester_role,requested_by,to_attendance,reason) values(t,x,'operator','test','absent','Fixture pending correction');
 result:=public.begin_retention_erasure(t,r,'test');
 perform pg_temp.check_ok(result->>'reason'='active','pending attendance correction blocks erasure');
 update public.attendance_corrections set status='rejected',decided_by='test',decided_at=now(),decision_reason='Fixture resolved' where tenant_id=t and schedule_id=x;
 insert into public.consultations(id,tenant_id,name,phone,status,student_id) values(form_consult,t,'Form fixture','01000000000','registered',s);
 insert into public.intake_forms(id,tenant_id,consultation_id,kind,token_hash,status,payload,submitted_at) values(form_id,t,form_consult,'regular',form_id::text,'submitted','{}','2019-01-01');
 update public.enrollments set form_id=(select f.id from public.intake_forms f where f.consultation_id=form_consult) where id=e;
 insert into public.lesson_materials(tenant_id,student_id,name,file_url) values(t,s,'Fixture file',t::text||'/fixture.pdf');
 result:=public.begin_retention_erasure(t,r,'test');
 perform pg_temp.check_ok((result->>'ok')::boolean and (select service_erased_at is not null and parent_phone='' from public.students where id=s),'student service anonymizes profile');
 perform pg_temp.check_ok(not exists(select 1 from public.schedules where tenant_id=t and student_id=s) and exists(select 1 from public.contracts where id=c),'service deletion removes schedules but keeps contract proof');
 perform pg_temp.check_ok((select count(*)=2 from public.session_ledger where tenant_id=t and package_id=p and kind='deduct' and schedule_id is null),'service erasure retains separate financial consumption evidence');
 perform pg_temp.check_ok((select jsonb_array_length(files)=1 and storage_completed_at is null from public.privacy_erasure_jobs where retention_id=r),'file manifest survives source deletion');
 insert into public.consents(tenant_id,subject_type,subject_id,item,consented_at) values(t,'student',s,'privacy','2019-01-01');
 insert into public.retention_records(tenant_id,subject_type,subject_id,subject_label,category,event,started_at,retain_until,policy_days,policy_label)
 values(t,'student',s,'Fixture','consent_proof','enrollment_ended','2020-01-01','2023-01-01',1095,'Fixture') returning id into r;
 result:=public.begin_retention_erasure(t,r,'test');
 perform pg_temp.check_ok((result->>'ok')::boolean and not exists(select 1 from public.intake_forms f where f.consultation_id=form_consult) and not exists(select 1 from public.consents where tenant_id=t and subject_id=s),'student application and consent proof erase after their separate term');
 result:=public.create_calendar_schedule(t,s,'2030-01-01',60,'video');
 perform pg_temp.check_ok(not (result->>'ok')::boolean,'erased student cannot receive new sessions');
 begin
  update public.students set name='Revived' where id=s;
  raise exception 'FAIL: erased profile update was allowed';
 exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;

 insert into public.consultations(id,tenant_id,name,phone,status) values(consult,t,'Fixture','01000000000','hold');
 insert into public.waitlist_offers(tenant_id,consultation_id,offered_at,expires_at,status) values(t,consult,'2019-01-01','2020-01-01','expired');
 insert into public.retention_records(tenant_id,subject_type,subject_id,subject_label,category,event,started_at,retain_until,policy_days,policy_label)
 values(t,'consultation',consult,'Fixture','consultation_intake','waitlist_closed','2020-01-01','2020-07-01',180,'Fixture') returning id into r;
 result:=public.begin_retention_erasure(t,r,'test');
 perform pg_temp.check_ok((result->>'ok')::boolean and not exists(select 1 from public.consultations where id=consult),'consultation deletion');
 select id into r from public.retention_records where tenant_id=t and subject_id=consult and category='consent_proof';
 result:=public.begin_retention_erasure(t,r,'test');
 perform pg_temp.check_ok((result->>'ok')::boolean,'separate consultation consent proof deletion');
 insert into public.payments(id,tenant_id,student_id,period_start,period_end,amount,method,status,paid_at)
 values(payment,t,s,'2019-01-01','2019-01-31',100,'bank','paid','2019-01-01');
 insert into public.retention_records(tenant_id,subject_type,subject_id,subject_label,category,event,started_at,retain_until,policy_days,policy_label)
 values(t,'payment',payment,'Fixture','payment_legal','payment_settled','2019-01-01','2024-01-01',1825,'Fixture') returning id into r;
 result:=public.begin_retention_erasure(t,r,'test');
 perform pg_temp.check_ok((result->>'ok')::boolean and not exists(select 1 from public.payments where id=payment) and not exists(select 1 from public.contracts where id=c),'expired payment and contract proof deletion');

 perform pg_temp.check_ok(not has_function_privilege('anon','public.begin_retention_erasure(uuid,uuid,text)','EXECUTE') and not has_function_privilege('authenticated','public.restore_content_backup(uuid,uuid,text,boolean,text)','EXECUTE'),'privileged functions reject browser roles');
end $$;
rollback;
