// Portal rendering and visibility regression tests. In-memory DB; no network or notifications.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');
const root = fileURLToPath(new URL('../', import.meta.url));
let enabled = true;
let failedTable = null;
let tables = {};
const queried = [];

const db = {
  from(table) {
    queried.push(table);
    const filters = [];
    let ordering;
    let maximum = Infinity;
    const query = {
      select: () => query,
      eq: (key, value) => { filters.push(row => row[key] === value); return query; },
      is: (key, value) => { filters.push(row => row[key] === value); return query; },
      in: (key, values) => { filters.push(row => values.includes(row[key])); return query; },
      gte: (key, value) => { filters.push(row => row[key] >= value); return query; },
      lt: (key, value) => { filters.push(row => row[key] < value); return query; },
      order: (key, options) => { ordering = { key, ...options }; return query; },
      limit: value => { maximum = value; return query; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (failedTable === table) return { data: null, error: { code: 'DB_FAILURE', message: 'private DB detail' } };
          const rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
          if (ordering) rows.sort((a, b) => (a[ordering.key] < b[ordering.key] ? -1 : a[ordering.key] > b[ordering.key] ? 1 : 0) * (ordering.ascending ? 1 : -1));
          return { data: structuredClone(rows.slice(0, maximum)), error: null };
        }).then(resolve, reject);
      },
    };
    return query;
  },
};

const overrides = {
  '@/lib/supabase/server': { createServiceClient: () => enabled ? db : null },
  '@/lib/tenant': {},
  'next/headers': {},
  'next/navigation': { useRouter: () => ({ refresh() {} }) },
  '@/app/p/actions': {}, // Render forms without executing mutations.
};
const modules = new Map();
function load(file) {
  const absolute = path.resolve(root, file);
  const resolved = [absolute, `${absolute}.ts`, `${absolute}.tsx`].find(existsSync);
  assert(resolved, `Missing source ${file}`);
  if (modules.has(resolved)) return modules.get(resolved);
  const exports = {};
  modules.set(resolved, exports);
  const code = ts.transpileModule(readFileSync(resolved, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    exports, Date, process,
    console: { error() {} },
    require(name) {
      if (name in overrides) return overrides[name];
      if (name.startsWith('@/')) return load(name.slice(2));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(resolved), name));
      return require(name);
    },
  }, { filename: resolved });
  return exports;
}

const homework = load('lib/data/homework.ts');
const portal = load('lib/portal/data.ts');
const { StudentView } = load('app/p/student-view.tsx');
const { GuardianView } = load('app/p/guardian-view.tsx');
const session = {
  tenantId: 'tenant-1',
  relations: ['student', 'guardian'].map(role => ({ role, studentId: 'student-1' })),
};
const viewProps = { session, studentId: 'student-1', studentName: '테스트 학생' };
function assignment(id, patch = {}) {
  return { id, tenant_id: 'tenant-1', student_id: 'student-1', title: `과제 ${id}`, description: '문제 풀이',
    status: 'assigned', assigned_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z', archived_at: null,
    due_date: '2026-09-10', ...patch };
}
tables.homework_assignments = [
  assignment('visible'), assignment('closed', { status: 'closed' }),
  assignment('draft', { status: 'draft' }), assignment('canceled', { status: 'canceled' }),
  assignment('archived', { archived_at: '2026-09-11T00:00:00Z' }),
  assignment('other-student', { student_id: 'student-2' }),
  assignment('other-tenant', { tenant_id: 'tenant-2' }),
];
tables.homework_submissions = [{ id: 'submission-1', tenant_id: 'tenant-1', assignment_id: 'visible', attempt_no: 1,
  content: '제출 답안', file_path: null, file_name: null, submitted_at: '2026-09-02T00:00:00Z', withdrawn_at: null,
  review_status: 'reviewed', feedback: '비공개 검토 내용', feedback_status: 'draft', review_result: 'complete' }];
tables.ai_reports = ['student', 'parent'].map(audience => ({ id: audience, tenant_id: 'tenant-1', student_id: 'student-1',
  status: 'approved', audience, type: 'lesson', content: '정상 리포트', created_at: '2026-09-01T00:00:00Z' }));

for (const list of [portal.listStudentHomework, portal.listGuardianHomework]) {
  const result = await list(session, 'student-1');
  assert.deepEqual(Array.from(result, row => row.id), ['visible', 'closed']);
  assert.equal(result[0].latestSubmission.content, '제출 답안');
  assert.equal(result[0].latestSubmission.feedback, null);
  assert.equal(result[0].latestSubmission.reviewResult, null);
  const before = queried.length;
  assert.equal((await list(session, 'student-2')).length, 0);
  assert.equal((await list({ ...session, relations: [{ role: 'payer', studentId: 'student-1' }] }, 'student-1')).length, 0);
  assert.equal(queried.length, before, 'Unauthorized reads must not reach the DB');
}
for (const View of [StudentView, GuardianView]) {
  const html = renderToStaticMarkup(await View(viewProps));
  assert(html.includes('과제 visible'));
  assert(html.includes('과제 closed'));
  for (const hidden of ['과제 draft', '과제 canceled', '과제 archived', '과제 other-student', '과제 other-tenant', '비공개 검토 내용']) assert(!html.includes(hidden));
}
for (const failure of ['homework_assignments', 'homework_submissions']) {
  failedTable = failure;
  await assert.rejects(() => homework.listPortalAssignments('tenant-1', 'student-1'));
  for (const View of [StudentView, GuardianView]) {
    const html = renderToStaticMarkup(await View(viewProps));
    assert(html.includes('과제를 불러오지 못했습니다'));
    assert(html.includes('과제 새로고침'));
    assert(html.includes('정상 리포트'), 'A homework failure must not hide other sections');
    assert(!html.includes('배부된 과제가 없습니다'));
    assert(!html.includes('미제출'));
    assert(!html.includes('private DB detail'));
  }
}
failedTable = null;
enabled = false;
await assert.rejects(() => homework.listPortalAssignments('tenant-1', 'student-1'));
enabled = true;
tables.homework_assignments = [];
for (const View of [StudentView, GuardianView]) {
  const html = renderToStaticMarkup(await View(viewProps));
  assert(html.includes('배부된 과제가 없습니다'));
  assert(html.includes('과제 새로고침'));
  assert(!html.includes('과제를 불러오지 못했습니다'));
}
console.log('PASS: student/guardian rendering, empty and failed queries, retained reports, submission failures, role/student/tenant boundaries, private feedback, and draft/canceled/archived visibility.');
