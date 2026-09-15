// Isolated behavioral tests: real receipt actions/client, fake DB and provider. No network or credentials.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const clone = value => structuredClone(value);
function load(file, dependencies = {}, extra = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (name in dependencies) return dependencies[name];
    throw Error(`Unexpected dependency: ${name}`);
  }, console: { error: () => {} }, Date, ...extra });
  return exports;
}
const helpers = load('../lib/payssam/cash-receipt.ts');
assert.equal(helpers.validateCashReceiptInput('0', '010-1234-5678', 'exempt').ok, true);
for (const args of [['0', '9010101234567', 'exempt'], ['1', '123', 'taxable'], ['0', '01012345678', ''], ['0', 'abc01012345678', 'exempt']]) {
  assert.equal(helpers.validateCashReceiptInput(...args).ok, false);
}
assert.deepEqual(clone(helpers.cashReceiptAmounts(1100, 'taxable')), { supplyPrice: 1000, tax: 100 });
assert.deepEqual(clone(helpers.cashReceiptAmounts(1100, 'exempt')), { supplyPrice: 1100, tax: 0 });
assert.throws(() => helpers.cashReceiptAmounts(1.5, 'exempt'));
assert.equal(helpers.cashReceiptDate('20260230120000'), null);

const fixture = () => ({ id: 'payment-1', tenant_id: 'tenant-1', amount: 1100, method: 'bank', status: 'paid', bill_id: null,
  cash_receipt_bill_id: null, cash_receipt_state: null, cash_receipt_appr_num: null, cash_receipt_trader: null,
  cash_receipt_operation: null, cash_receipt_operation_id: null, cash_receipt_operation_started_at: null });
let payment, session, requests, events, work, audits, remote, failSave, failAudit, refreshes;
function reset(patch = {}) {
  payment = { ...fixture(), ...patch };
  session = { tenantId: 'tenant-1', email: 'fixture@example.invalid' };
  requests = []; events = []; work = []; audits = []; refreshes = [];
  remote = {}; failSave = false; failAudit = false;
}
function builder(table) {
  const filters = []; let method = 'select', patch;
  const query = {
    select: () => query,
    eq: (key, value) => { filters.push(row => row[key] === value); return query; },
    is: (key, value) => { filters.push(row => row[key] === value); return query; },
    update: data => { method = 'update'; patch = data; return query; },
    insert: data => { method = 'insert'; patch = data; return query; },
    maybeSingle: () => Promise.resolve(execute()),
    then: (resolve, reject) => Promise.resolve().then(execute).then(resolve, reject),
  };
  function execute() {
    if (table === 'payments') {
      if (!filters.every(filter => filter(payment))) return { data: null, error: null };
      if (method === 'update') {
        if (failSave && patch.cash_receipt_state) return { data: null, error: { code: 'DB_FAILURE' } };
        Object.assign(payment, clone(patch));
      }
      return { data: clone(payment), error: null };
    }
    if (table === 'payssam_events' && method === 'insert') { events.push(clone(patch)); return { data: null, error: null }; }
    throw Error(`Unexpected table/method: ${table}/${method}`);
  }
  return query;
}
const db = { from: builder };
const kstNow = () => new Date(Date.now() + 9 * 3600000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
function history(state = 'F', overrides = {}) {
  return { billId: payment.cash_receipt_bill_id, info: [{ billId: payment.cash_receipt_bill_id, apprPrice: String(payment.amount),
    apprState: state, apprNum: state === 'F' ? 'issue-approval' : 'cancel-approval', trader: '0', apprDt: kstNow(), issuanceNumber: '01012345678', ...overrides }] };
}
const client = load('../lib/payssam/client.ts', { crypto }, {
  process: { env: { PAYSSAM_API_KEY: 'fixture-key', PAYSSAM_MEMBER_ID: 'wrong-member', PAYSSAM_MERCHANT_ID: 'wrong-merchant', PAYSSAM_BASE_URL: 'https://fixture.invalid' } },
  setTimeout, clearTimeout, AbortController,
  fetch: async (url, options) => {
    const body = JSON.parse(options.body), path = new URL(url).pathname;
    requests.push({ path, body });
    assert.equal(body.member, 'tenant-member'); assert.equal(body.merchant, 'tenant-merchant');
    const input = body.cashReceipt;
    assert.equal(input.hash, crypto.createHash('sha256').update(`${input.billId},${input.price}`).digest('hex'));
    if (remote.throw === path) throw Error('Simulated connection loss');
    if (remote.pause) await remote.pause;
    let data = path.endsWith('/read') ? remote.read ?? history() : { billId: input.billId, apprCashNum: 'issue-approval', trader: input.trader };
    if (remote.badApproval) data = {};
    return { status: 200, text: async () => JSON.stringify({ code: remote.reject ?? '0000', message: 'fixture response', data }) };
  },
});
const account = { payssamMemberId: 'tenant-member', payssamMerchantId: 'tenant-merchant' };
const actions = load('../app/admin/(protected)/payments/cash-receipt-actions.ts', {
  crypto, 'next/cache': { revalidatePath: path => refreshes.push(path) },
  '@/lib/auth/session': { getAdminSession: async () => session },
  '@/lib/supabase/server': { createServiceClient: () => db },
  '@/lib/payssam/account': { getPayssamAccount: async () => account },
  '@/lib/payssam/client': client, '@/lib/payssam/cash-receipt': helpers,
  '@/lib/data/activity': { runCritical: async (audit, run) => { audits.push(clone(audit)); return failAudit ? { ok: false, error: 'audit unavailable' } : run(); } },
  '@/lib/data/work': { createWorkItem: async (_, item) => work.push(clone(item)) },
});
const issue = () => actions.issueCashReceiptAction('payment-1', '0', '010-1234-5678', 'taxable');
const expire = () => { payment.cash_receipt_operation_started_at = new Date(Date.now() - 120000).toISOString(); };
reset();
assert.equal((await issue()).ok, true);
assert.equal(payment.bill_id, null); assert(payment.cash_receipt_bill_id);
assert.equal(payment.cash_receipt_state, 'issued'); assert.equal(payment.cash_receipt_operation, null);
assert.equal(requests[0].body.cashReceipt.supplyPrice, '1000'); assert.equal(requests[0].body.cashReceipt.tax, '100');
assert.equal((await issue()).ok, false); assert.equal(requests.length, 1);
assert(!JSON.stringify(audits).includes('01012345678'));
assert(refreshes.includes('/p'));

reset();
const simultaneous = await Promise.all([issue(), issue()]);
assert.equal(simultaneous.filter(result => result.ok).length, 1);
assert.equal(requests.length, 1);

for (const patch of [{ status: 'pending' }, { status: 'refunded' }, { method: 'payssaem' }, { tenant_id: 'other-tenant' }]) {
  reset(patch); assert.equal((await issue()).ok, false); assert.equal(requests.length, 0);
}
reset(); session = null; assert.equal((await issue()).ok, false); assert.equal(requests.length, 0);
reset(); failAudit = true; assert.equal((await issue()).ok, false); assert.equal(requests.length, 0); assert.equal(payment.cash_receipt_bill_id, null);
reset(); remote.reject = 'VALIDATION_002'; assert.equal((await issue()).ok, false); assert.equal(payment.cash_receipt_operation, null); assert.equal(payment.cash_receipt_bill_id, null);
remote.reject = undefined; assert.equal((await issue()).ok, true);

reset(); remote.throw = '/cash-receipt/issue';
assert.equal((await issue()).ok, false); assert.equal(payment.cash_receipt_state, null); assert.equal(payment.cash_receipt_operation, 'issue'); assert.equal(work.length, 1);
const stableId = payment.cash_receipt_bill_id;
assert.equal((await issue()).ok, false); assert.equal(requests.length, 1);
assert.equal((await actions.syncCashReceiptAction('payment-1')).ok, false); assert.equal(requests.length, 1);
expire(); remote.throw = undefined; remote.read = { billId: stableId, info: [] };
assert.equal((await actions.syncCashReceiptAction('payment-1')).ok, false); assert.equal(payment.cash_receipt_operation, 'issue');
remote.read = history();
assert.equal((await actions.syncCashReceiptAction('payment-1')).ok, true); assert.equal(payment.cash_receipt_state, 'issued'); assert.equal(payment.cash_receipt_bill_id, stableId);
assert(!JSON.stringify(events).includes('01012345678')); assert(!JSON.stringify(events).includes('fixture-key'));

reset(); remote.badApproval = true;
assert.equal((await issue()).ok, false); assert.equal(payment.cash_receipt_state, null); assert.equal(payment.cash_receipt_operation, 'issue');
reset(); failSave = true;
assert.equal((await issue()).ok, false); assert.equal(payment.cash_receipt_state, null); assert.equal(payment.cash_receipt_operation, 'issue'); assert.equal(work.length, 1);

reset({ cash_receipt_state: 'issued', cash_receipt_bill_id: 'receipt-existing', cash_receipt_appr_num: 'old-approval', cash_receipt_trader: '0' });
remote.read = history('F', { apprNum: 'new-approval' });
assert.equal((await actions.syncCashReceiptAction('payment-1')).ok, true);
assert.equal(payment.cash_receipt_appr_num, 'new-approval'); // Refresh details even when the state did not change.
remote.read = history('F', { billId: undefined, apprDt: kstNow().slice(2) });
assert.equal((await actions.syncCashReceiptAction('payment-1')).ok, true); // Actual V2 sandbox response shape.
for (const read of [{ billId: 'receipt-existing' }, { billId: 'wrong', info: [] }, history('F', { apprPrice: '1' }), history('X'), { billId: 'receipt-existing', info: [] }]) {
  remote.read = read; assert.equal((await actions.syncCashReceiptAction('payment-1')).ok, false); assert.equal(payment.cash_receipt_state, 'issued');
}
const tied = history(); tied.info.push({ ...tied.info[0], apprState: 'C' });
assert.equal(helpers.parseCashReceiptHistory(tied, 'receipt-existing', 1100).ok, false);

reset({ status: 'refunded', cash_receipt_state: 'issued', cash_receipt_bill_id: 'receipt-existing', cash_receipt_appr_num: 'original-approval', cash_receipt_trader: '0' });
assert.equal((await actions.cancelCashReceiptAction('payment-1')).ok, true);
assert.equal(payment.status, 'refunded'); assert.equal(payment.cash_receipt_state, 'canceled'); assert.equal(payment.cash_receipt_appr_num, 'original-approval');
assert.equal((await actions.cancelCashReceiptAction('payment-1')).ok, false);

reset({ cash_receipt_state: 'issued', cash_receipt_bill_id: 'receipt-existing', cash_receipt_trader: '0' });
remote.throw = '/cash-receipt/cancel'; assert.equal((await actions.cancelCashReceiptAction('payment-1')).ok, false);
assert.equal(payment.cash_receipt_state, 'issued'); assert.equal(payment.cash_receipt_operation, 'cancel');
expire(); remote.throw = undefined; remote.read = history('C');
assert.equal((await actions.syncCashReceiptAction('payment-1')).ok, true); assert.equal(payment.cash_receipt_state, 'canceled');

reset({ cash_receipt_state: 'canceled', cash_receipt_bill_id: 'previous-receipt', cash_receipt_appr_num: 'old-approval', cash_receipt_trader: '0' });
remote.read = history('C');
assert.equal((await issue()).ok, true);
assert.notEqual(payment.cash_receipt_bill_id, 'previous-receipt');
assert.equal(requests[0].body.cashReceipt.billId, 'previous-receipt');
assert.equal(requests[1].body.cashReceipt.billId, payment.cash_receipt_bill_id);
assert.equal(audits[0].before.cash_receipt_bill_id, 'previous-receipt');

console.log('PASS: receipt payload/tax/hash, standalone IDs, tenant/auth guards, concurrent issue, audit/save failures, unknown-result recovery, history validation, metadata refresh, refund cancellation, and private-data redaction.');
