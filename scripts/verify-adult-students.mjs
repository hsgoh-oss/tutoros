// Real actions and session authorization with an in-memory DB. No external messages or payments.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
let rows = {}, failedTable = null, admin = { tenantId: 'tenant-1', email: 'test@example.invalid' };
const notices = [], bills = [], audits = [], refreshes = [];
const db = { from(table) {
  const filters = []; let operation = 'select', value, single = false;
  function execute() {
    if (failedTable === table) return { data: null, error: { message: 'Simulated DB failure' } };
    rows[table] ??= [];
    let selected = rows[table].filter(row => filters.every(filter => filter(row)));
    if (operation === 'insert') {
      const item = { id: `${table}-${rows[table].length + 1}`, ...structuredClone(value) };
      rows[table].push(item); selected = [item];
    } else if (operation === 'update') selected.forEach(row => Object.assign(row, structuredClone(value)));
    else if (operation === 'delete') rows[table] = rows[table].filter(row => !selected.includes(row));
    return { data: structuredClone(single ? selected[0] ?? null : selected), error: null };
  }
  const query = {
    select: () => query,
    eq: (key, expected) => { filters.push(row => row[key] === expected); return query; },
    is: (key, expected) => { filters.push(row => row[key] === expected); return query; },
    in: (key, expected) => { filters.push(row => expected.includes(row[key])); return query; },
    gte: (key, expected) => { filters.push(row => row[key] >= expected); return query; },
    lt: (key, expected) => { filters.push(row => row[key] < expected); return query; },
    order: () => query,
    limit: () => query,
    insert: data => { operation = 'insert'; value = data; return query; },
    update: data => { operation = 'update'; value = data; return query; },
    delete: () => { operation = 'delete'; return query; },
    single: () => { single = true; return Promise.resolve(execute()); },
    maybeSingle: () => { single = true; return Promise.resolve(execute()); },
    then: (resolve, reject) => Promise.resolve().then(execute).then(resolve, reject),
  };
  return query;
} };
const deps = {
  crypto: require('node:crypto'),
  react: { cache: fn => fn },
  'next/headers': { cookies: async () => ({ get: () => ({ value: 'fixture-token' }) }) },
  'next/cache': { revalidatePath: path => refreshes.push(path) },
  '@/lib/auth/session': { getAdminSession: async () => admin },
  '@/lib/supabase/server': { createServiceClient: () => db, hasDb: () => true },
  '@/lib/tenant': { resolveTenant: async () => ({ id: 'tenant-1', brandName: 'Fixture' }) },
  '@/lib/data/activity': { runCritical: async (audit, run) => { audits.push(audit); return run(); } },
  '@/lib/data/adjustments': {}, '@/lib/data/work': {},
  '@/lib/notify/send': { sendNotification: async message => { notices.push(message); return { ok: true }; } },
  '@/lib/notify/templates': { renderTemplate: () => '안내' },
  '@/lib/data/crm': { formatWon: String, formatKDate: String },
  '@/lib/data/content': { getSiteContent: async () => ({ settings: {} }) },
  '@/lib/payssam/account': { getPayssamAccount: async () => ({}) },
  '@/lib/payssam/client': { generateBillId: () => 'bill-1', sendBill: async input => { bills.push(input); return { ok: true, data: { shortUrl: 'https://fixture.invalid/bill' } }; } },
};
function load(file) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, Date, FormData, console: { error() {} }, process: { env: { AUTH_SECRET: 'fixture-secret' } },
    require: name => { assert(name in deps, `Unexpected dependency: ${name}`); return deps[name]; } }, { filename: file });
  return exports;
}
deps['@/supabase/functions/_shared/student-contact'] = load('supabase/functions/_shared/student-contact.ts');
deps['@/lib/student-contact'] = load('lib/student-contact.ts');
deps['./self-payer'] = load('lib/portal/self-payer.ts');
const auth = deps['@/lib/portal/auth'] = load('lib/portal/auth.ts');
const students = load('app/admin/(protected)/students/actions.ts');
const payments = load('app/admin/(protected)/payments/actions.ts');
function form(patch = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ name: '본인 수강생', isAdult: 'true', studentPhone: '010-0000-1111', studentPhoneConsent: 'on', status: 'active', ...patch })) data.set(key, value);
  return data;
}
assert.equal((await students.createStudent(form({ parentPhone: '01099998888' }))).ok, true);
let student = rows.students[0];
assert.equal(student.is_adult, true); assert.equal(student.parent_phone, null);
assert.equal(student.student_phone, '010-0000-1111'); assert.equal(rows.consents.length, 1);
for (const patch of [{ studentPhone: '' }, { studentPhone: '123' }, { studentPhoneConsent: '' }, { isAdult: 'false', parentPhone: '' }]) {
  assert.equal((await students.createStudent(form(patch))).ok, false);
}
assert.equal(rows.students.length, 1);
failedTable = 'consents';
assert.equal((await students.createStudent(form())).ok, false);
assert.equal(rows.students.length, 1); failedTable = null;
assert.equal((await students.updateStudent(form({ id: student.id, isAdult: 'false', parentPhone: '010-0000-2222' }))).ok, true);
assert.equal(student.is_adult, false); assert.equal(student.parent_phone, '010-0000-2222');
assert.equal((await students.updateStudent(form({ id: student.id }))).ok, true);
assert.equal(student.is_adult, true); assert.equal(student.parent_phone, null); assert(refreshes.includes('/p'));
assert.equal((await students.updateStudent(form({ id: 'other-student' }))).ok, false);
admin = null; assert.equal((await students.createStudent(form())).ok, false); admin = { tenantId: 'tenant-1', email: 'test@example.invalid' };
assert(!JSON.stringify(audits).includes('010-0000-1111'));

const tokenHash = createHmac('sha256', 'fixture-secret').update('portal-session:fixture-token').digest('hex');
rows.portal_sessions = [{ tenant_id: 'tenant-1', contact_id: 'contact-1', token_hash: tokenHash, revoked_at: null, expires_at: '2099-01-01T00:00:00Z' }];
rows.portal_contacts = [{ id: 'contact-1', tenant_id: 'tenant-1', name: '본인', phone: '01000001111' }];
const relation = { id: 'relation-1', tenant_id: 'tenant-1', contact_id: 'contact-1', student_id: student.id, role: 'student', status: 'active', accepted_at: '2026-01-01T00:00:00Z' };
rows.portal_relations = [relation];
const roles = async () => Array.from((await auth.getPortalSession())?.relations ?? [], row => row.role);
assert.deepEqual(await roles(), ['student', 'payer']);
assert.equal(auth.hasPortalAccess(await auth.getPortalSession(), 'payer', 'another-student'), false);
student.is_adult = false; assert.deepEqual(await roles(), ['student']); student.is_adult = true;
student.student_phone = '010-0000-3333'; assert.deepEqual(await roles(), ['student']); student.student_phone = '010-0000-1111';
relation.role = 'guardian'; assert.deepEqual(await roles(), ['guardian']); relation.role = 'student';
for (const status of ['invited', 'revoked']) {
  rows.portal_relations.push({ ...relation, id: 'payer-1', role: 'payer', status });
  assert.deepEqual(await roles(), ['student']); rows.portal_relations.pop();
}
rows.portal_relations.push({ ...relation, id: 'payer-1', role: 'payer' });
assert.deepEqual(await roles(), ['student', 'payer']); rows.portal_relations.pop();
relation.status = 'revoked'; assert.equal(await auth.getPortalSession(), null); relation.status = 'active';
student.status = 'ended'; assert.equal(await auth.getPortalSession(), null); student.status = 'active';
rows.portal_contacts[0].tenant_id = 'other-tenant'; assert.equal(await auth.getPortalSession(), null); rows.portal_contacts[0].tenant_id = 'tenant-1';
failedTable = 'portal_relations'; assert.equal(await auth.getPortalSession(), null); failedTable = null;

student.parent_phone = '010-9999-8888'; // Old guardian number must never receive an adult bill.
rows.payments = [{ id: 'payment-1', tenant_id: 'tenant-1', student_id: student.id, students: student, amount: 1000,
  status: 'pending', method: 'payssaem', period_start: '2026-09-01', period_end: '2026-09-30', paid_at: null, bill_id: null }];
assert.equal((await payments.sendPaymentRequestNotice('payment-1')).ok, true);
assert.equal(notices.at(-1).phone, '010-0000-1111');
assert.equal((await payments.sendPayssamBillAction('payment-1')).ok, true);
assert.equal(bills.at(-1).phone, '01000001111');
student.is_adult = false; rows.payments[0].bill_id = null;
assert.equal((await payments.sendPaymentRequestNotice('payment-1')).ok, true);
assert.equal(notices.at(-1).phone, '010-9999-8888');
assert.equal((await payments.sendPayssamBillAction('payment-1')).ok, true);
assert.equal(bills.at(-1).phone, '01099998888');
student.is_adult = true; student.student_phone = null; rows.payments[0].bill_id = null;
const count = notices.length + bills.length;
assert.equal((await payments.sendPaymentRequestNotice('payment-1')).ok, false);
assert.equal((await payments.sendPayssamBillAction('payment-1')).ok, false);
assert.equal(notices.length + bills.length, count);
// Execute the actual scheduled jobs against fixtures, never the live notification queue.
deps['../../_shared/student-contact.ts'] = deps['@/supabase/functions/_shared/student-contact'];
deps['../../_shared/channel.ts'] = { defaultChannel: () => 'sms' };
deps['../../_shared/kst.ts'] = {
  kstDateString: () => '2026-09-18',
  kstDayRangeUtc: () => ({ start: new Date('2026-09-15T00:00:00Z'), end: new Date('2026-09-17T00:00:00Z') }),
  formatKstDateTime: String,
};
deps['../../_shared/templates.ts'] = { lessonReminderMessage: () => '수업', paymentD3Message: () => '납부 예정', paymentOverdueMessage: () => '미납' };
const targets = [
  { id: 'adult', tenant_id: 'tenant-1', name: '성인', status: 'active', is_adult: true, student_phone: '01000001111', parent_phone: '01099998888' },
  { id: 'minor', tenant_id: 'tenant-1', name: '학생', status: 'active', is_adult: false, student_phone: '01000001111', parent_phone: '01099998888' },
  { id: 'missing', tenant_id: 'tenant-1', name: '연락처 없음', status: 'active', is_adult: true, student_phone: null, parent_phone: '01099998888' },
];
for (const [file, fn, table, status] of [
  ['lessonReminder', 'runLessonReminder', 'schedules', 'planned'],
  ['paymentD3', 'runPaymentD3', 'payments', 'pending'],
  ['paymentOverdueNotice', 'runPaymentOverdueNotice', 'payments', 'overdue'],
]) {
  rows[table] = targets.map(target => ({ id: target.id, tenant_id: target.tenant_id, student_id: target.id,
    students: target, status, reminder_sent: false, scheduled_at: '2026-09-16T03:00:00Z', due_date: '2026-09-18', amount: 1000 }));
  rows.notifications = [];
  const result = await load(`supabase/functions/automation/jobs/${file}.ts`)[fn](db);
  assert.equal(result.queued, 2); assert.equal(result.skipped, 1);
  assert.deepEqual(rows.notifications.map(row => row.phone), ['01000001111', '01099998888']);
}
rows.students = targets; rows.notifications = []; rows.work_items = [];
rows.lessons = targets.map(target => ({ tenant_id: target.tenant_id, student_id: target.id, lesson_date: '2020-01-01' }));
assert.equal((await load('supabase/functions/automation/jobs/reviewRequest.ts').runReviewRequest(db)).created, 2);
assert(rows.work_items[0].detail.includes('본인 01000001111'));
assert(rows.work_items[1].detail.includes('보호자 01099998888'));
console.log('PASS: adult/minor registration, consent rollback, edits, direct and scheduled notification recipients, review candidates, adult portal roles, phone matching, revocation, ended students, tenant boundaries, and query failures.');
