// Dedicated local verification DB only. Run verify:rls before this script.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
const exec=promisify(execFile);
const database=process.env.VERIFY_DB??'tutoros_commercial_verify';
assert(/^tutoros_[a-z_]+_verify$/.test(database),'Use an isolated tutoros_*_verify database');
const tenant=randomUUID(), student=randomUUID();
const sql=async(text)=>(await exec('psql',['-h','/tmp','-d',database,'-v','ON_ERROR_STOP=1','-Atc',text])).stdout.trim();
try{
 await sql(`insert into tenants(id,brand_name,email) values('${tenant}','Concurrency fixture','fixture@example.invalid'); insert into students(id,tenant_id,name,parent_phone) values('${student}','${tenant}','Fixture','01000000000')`);
 const call=`select public.create_calendar_schedule('${tenant}','${student}','2030-01-01 10:00+09',60,'video','auto')`;
 const results=await Promise.all([sql(call),sql(call)]);
 assert.equal(results.map(JSON.parse).filter(r=>r.ok).length,1);
 assert.equal(await sql(`select count(*) from schedules where tenant_id='${tenant}' and student_id='${student}'`),'1');
 console.log('PASS: simultaneous registration creates exactly one session');
}finally{await sql(`delete from tenants where id='${tenant}'`);}
