import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(file) {
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, process: { env: {} }, URL });
  return exports;
}
const auth = load('../lib/auth/environment.ts');
const strong = 'fixture-only-strong-secret-32-characters';
assert.equal(auth.devOtpEnabled({NODE_ENV:'development',AUTH_DEV_MODE:'true'}),true);
for (const runtime of [{NODE_ENV:'production'},{NODE_ENV:'development',VERCEL_ENV:'production'}]) {
  assert.equal(auth.devOtpEnabled({...runtime,AUTH_DEV_MODE:'true'}),false);
  assert.throws(()=>auth.assertProductionAuth({...runtime,AUTH_DEV_MODE:'true',AUTH_SECRET:strong}));
  for(const secret of [undefined,'','short','dev-only-secret-change-me']) assert.throws(()=>auth.assertProductionAuth({...runtime,AUTH_SECRET:secret}));
  assert.doesNotThrow(()=>auth.assertProductionAuth({...runtime,AUTH_SECRET:strong,AUTH_DEV_MODE:'false'}));
}
assert.equal(auth.devOtpEnabled({NODE_ENV:'development'}),false);
const { erasureObject } = load('../lib/privacy/erasure-storage.ts');
const tenant='00000000-0000-0000-0000-000000000001', origin='http://127.0.0.1:54321';
assert.equal(erasureObject('materials',tenant+'/file.pdf',tenant,origin).kind,'object');
assert.equal(erasureObject('materials','other-tenant/file.pdf',tenant,origin).kind,'invalid');
assert.equal(erasureObject('materials',tenant+'/../file.pdf',tenant,origin).kind,'invalid');
assert.equal(erasureObject('materials',tenant+'//file.pdf',tenant,origin).kind,'invalid');
assert.equal(erasureObject('unknown',tenant+'/file.pdf',tenant,origin).kind,'invalid');
assert.equal(erasureObject('materials',origin+'/storage/v1/object/public/materials/'+tenant+'/file.pdf',tenant,origin).kind,'object');
assert.equal(erasureObject('materials',origin+'/storage/v1/object/public/reviews/'+tenant+'/file.pdf',tenant,origin).kind,'invalid');
assert.equal(erasureObject('reviews','https://external.invalid/storage/v1/object/public/reviews/'+tenant+'/file.jpg',tenant,origin).kind,'external');
assert.equal(erasureObject('review-evidence',origin+'/storage/v1/object/public/reviews/'+tenant+'/file.jpg',tenant,origin).bucket,'review-evidence');
assert.equal(erasureObject('reviews','/img/reviews/legacy.jpg',tenant,origin).kind,'external');
console.log('PASS: production OTP/secret guards and tenant-scoped storage paths');
// Exercise the real read helper with a failed server query, then a legitimate empty result.
const query = load('../lib/data/query-error.ts');
let dbResult = { data: null, error: { code: '08006' } };
let builder;
builder = new Proxy({}, { get: (_, key) => key === 'then' ? ((resolve) => resolve(dbResult)) : () => builder });
const crmExports = {};
const crmCode = ts.transpileModule(readFileSync(new URL('../lib/data/crm.ts', import.meta.url),'utf8'), {compilerOptions:{ module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022 }}).outputText;
vm.runInNewContext(crmCode, { exports: crmExports, require: (id) => id.includes('supabase/server') ? { createServiceClient:()=>({from:()=>builder}),hasDb:()=>true } : id.includes('query-error') ? query : {}, console: { error:()=>{} } });
await assert.rejects(()=>crmExports.listSchedules('test-tenant', { from: '2020-01-01', to: '2020-02-01' }));
dbResult = {data:[],error:null};
assert.equal((await crmExports.listSchedules('test-tenant', { from: '2020-01-01', to: '2020-02-01' })).length,0);
console.log('PASS: failed schedule query throws; successful empty query remains empty');
