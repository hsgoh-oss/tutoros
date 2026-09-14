// Run after a production build. Local Supabase only; a disposable session is cleaned in finally.
// Example: node scripts/verify-production-runtime.mjs /path/to/isolated-build
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
const require=createRequire(import.meta.url);
require(require.resolve('@next/env',{paths:[require.resolve('next/package.json')]})).loadEnvConfig(process.cwd(),true);
const dbUrl=process.env.SUPABASE_URL;
assert(['localhost','127.0.0.1'].includes(new URL(dbUrl).hostname),'Only local Supabase is allowed');
const db=createClient(dbUrl,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const buildDir=resolve(process.argv[2]??process.cwd());
const next=require.resolve('next/dist/bin/next');
const port=3111;
const secret=randomBytes(36).toString('hex');
let app, browser, proxy, sessionId, tenantId;
function start(env) {
  const child=spawn(process.execPath,[next,'start','-p',String(port)],{cwd:buildDir,env:{...process.env,NODE_ENV:'production',AUTH_SECRET:secret,...env},stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
  return {child,output:()=>log};
}
async function stop(child) {if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}}
try {
  const bad=start({AUTH_DEV_MODE:'true'}); app=bad.child;
  const [exit]=await Promise.race([once(app,'exit'),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Invalid production server did not refuse startup')),15000).unref())]);
  assert.notEqual(exit,0);assert.match(bad.output(),/AUTH_DEV_MODE/);
  console.log('PASS: real production server rejects development OTP mode at startup');
  const account=await db.from('admin_accounts').select('tenant_id,email').eq('status','active').limit(1).single();
  assert.equal(account.error,null);tenantId=account.data.tenant_id;
  const token=randomBytes(32).toString('base64url');sessionId=randomUUID();
  const inserted=await db.from('admin_sessions').insert({id:sessionId,tenant_id:tenantId,email:account.data.email,token_hash:createHmac('sha256',secret).update('session:'+token).digest('hex'),expires_at:new Date(Date.now()+600000).toISOString()});
  assert.equal(inserted.error,null);
  let failSchedules=true;
  proxy=createServer(async(req,res)=>{
    if(failSchedules&&req.url.startsWith('/rest/v1/schedules?')){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({code:'08006',message:'Isolated test failure'}));return;}
    try {
      const headers={...req.headers};delete headers.host;delete headers.connection;
      const upstream=await fetch(new URL(req.url,dbUrl),{method:req.method,headers});
      res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'application/json'});res.end(Buffer.from(await upstream.arrayBuffer()));
    }catch{res.writeHead(502);res.end();}
  });
  proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
  const valid=start({AUTH_DEV_MODE:'false',SUPABASE_URL:`http://127.0.0.1:${proxy.address().port}`});app=valid.child;
  for(let i=0;i<150;i++){
    if(app.exitCode!==null)throw new Error('Production server exited unexpectedly');
    try{if((await fetch(`http://localhost:${port}/admin/login`)).ok)break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  browser=await chromium.launch();const context=await browser.newContext();
  await context.addCookies([{name:'tutoros_admin',value:token,url:`http://localhost:${port}`,httpOnly:true}]);
  const page=await context.newPage();
  await page.goto(`http://localhost:${port}/admin/schedules?view=month&month=2020-01`);
  await page.getByRole('heading',{name:'데이터를 불러오지 못했습니다'}).waitFor();
  assert.equal(await page.getByText('등록된 일정이 없습니다',{exact:true}).count(),0);
  await page.screenshot({path:'/private/tmp/tutoros-query-failure.png',fullPage:true});
  failSchedules=false;
  await page.getByRole('button',{name:'다시 불러오기'}).click();
  await page.locator('.calendar-workspace').waitFor({timeout:15000});
  assert.equal(await page.getByRole('heading',{name:'데이터를 불러오지 못했습니다'}).count(),0);
  console.log('PASS: production calendar displays query failure and recovers through retry');
}finally{
  await browser?.close();await stop(app);proxy?.closeAllConnections();if(proxy)await new Promise(resolve=>proxy.close(resolve));
  if(sessionId){const result=await db.from('admin_sessions').delete().eq('tenant_id',tenantId).eq('id',sessionId);assert.equal(result.error,null);}
}
