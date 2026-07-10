#!/usr/bin/env node
/**
 * 앱 레이어 테넌트 스코프 감사.
 *
 * 앱 서버는 service_role 키로 Supabase에 접속하고, 이 역할은 BYPASSRLS다.
 * 따라서 RLS 정책은 앱 경로를 지켜주지 않으며, 모든 쿼리가 스스로 tenant_id를 걸어야 한다.
 * 이 스크립트는 .from("table") 체인을 전수 검사해 스코프 누락을 찾는다.
 *
 * 실행: node scripts/audit-tenant-scope.mjs   (누락 발견 시 종료 코드 1)
 * 배경: docs/rls-policy.md §2, §5
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** tenant_id 컬럼이 없는 플랫폼 공통 테이블 — id로 테넌트를 식별한다. */
const EXEMPT_TABLES = new Set(["tenants"]);

const CHAIN_MAX_LINES = 25;

/**
 * tenant_id를 "필터"로 쓴 경우만 스코프로 인정한다.
 * `.select("id, tenant_id, ...")`처럼 컬럼 목록에 등장하는 것은 스코프가 아니다 —
 * 예전 규칙(`/tenant_id/.test(chain)`)은 이걸 통과시켜서 필터 없는 전 테넌트 조회를 안전으로 오판했다.
 */
const TENANT_FILTER = /\.(?:eq|match|filter|in|or|contains)\([^)]*tenant_id/;

/** insert/upsert는 필터가 아니라 payload에 tenant_id를 넣어 스코프를 정한다. */
const IS_WRITE_NEW_ROW = /\.(?:insert|upsert)\(/;
/** 객체 리터럴의 키로 등장(`tenant_id:`) — select 컬럼 목록("id, tenant_id")과 구별된다. */
const TENANT_PAYLOAD_KEY = /tenant_id\s*:/;

/** 플랫폼 경로(크론·웹훅)는 의도적으로 전 테넌트를 훑는다. .from() 위 5줄 안에 이 주석을 달아 허용한다. */
const ALLOW_COMMENT = /tenant-scope-ok:/;

const files = execSync(
  `find "${ROOT}/lib" "${ROOT}/app" -type f \\( -name '*.ts' -o -name '*.tsx' \\)`,
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean);

/** .insert(varName) 형태일 때, 그 변수 정의에 tenant_id가 들어가는지 확인한다. */
function insertPayloadIsScoped(src, chain) {
  const m = chain.match(/\.insert\(\s*([A-Za-z_$][\w$]*)\s*\)/);
  if (!m) return false;
  const varName = m[1];
  const declIdx = src.search(new RegExp(`(const|let|var)\\s+${varName}\\s*=`));
  if (declIdx === -1) return false;
  // 선언 지점부터 40줄까지를 payload 구성 블록으로 본다.
  const decl = src.slice(declIdx).split("\n").slice(0, 40).join("\n");
  return /tenant_id/.test(decl);
}

const violations = [];
const reviews = [];
let total = 0;
let scopedFilter = 0;
let scopedByPayload = 0;
let allowed = 0;

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/);
    if (!m) continue;
    const table = m[1];
    if (EXEMPT_TABLES.has(table)) continue;
    total++;

    let chain = "";
    for (let j = i; j < Math.min(i + CHAIN_MAX_LINES, lines.length); j++) {
      chain += lines[j] + "\n";
      if (/;\s*$/.test(lines[j].trim())) break;
    }

    const preceding = lines.slice(Math.max(0, i - 5), i + 1).join("\n");
    const entry = {
      file: file.replace(ROOT + "/", ""),
      line: i + 1,
      table,
      snippet: chain.trim().split("\n").slice(0, 5).join("\n      "),
    };

    if (ALLOW_COMMENT.test(preceding)) {
      allowed++;
      continue;
    }
    // 새 행을 만드는 쓰기(insert/upsert)는 payload의 tenant_id가 곧 스코프다.
    // 반면 select/update/delete는 반드시 필터가 있어야 한다 — payload에 tenant_id가 있어도
    // 필터가 없으면 전 테넌트 행에 작용한다.
    if (IS_WRITE_NEW_ROW.test(chain)) {
      if (TENANT_PAYLOAD_KEY.test(chain) || insertPayloadIsScoped(src, chain)) {
        scopedByPayload++;
        continue;
      }
    } else if (TENANT_FILTER.test(chain)) {
      scopedFilter++;
      continue;
    }
    // id(전역 UUID PK)만으로 단일 행을 지목 — 다른 행을 실수로 건드리지는 않지만,
    // id가 사용자 입력에서 왔다면 UUID만 알면 타테넌트 행에 접근하는 IDOR이 된다.
    // 자동 통과시키지 않고 사람이 검토하도록 남긴다.
    if (/\.eq\(\s*["'`]id["'`]/.test(chain)) {
      reviews.push(entry);
      continue;
    }

    violations.push(entry);
  }
}

console.log("═══ 앱 레이어 테넌트 스코프 감사 ═══");
console.log(`  검사한 .from() 호출        : ${total}건 (tenants 제외)`);
console.log(`  ├ tenant_id 필터 사용      : ${scopedFilter}건`);
console.log(`  ├ insert payload에 포함     : ${scopedByPayload}건`);
console.log(`  ├ tenant-scope-ok 주석 허용 : ${allowed}건`);
console.log(`  └ id 단독 지목(수동 검토)   : ${reviews.length}건`);
console.log("");

if (reviews.length > 0) {
  console.log("⚠️  id 단독 지목 — id가 사용자 입력이면 IDOR 위험. 각 건이 안전한지 확인할 것:");
  for (const r of reviews) console.log(`   · ${r.file}:${r.line}  [${r.table}]`);
  console.log("");
}

if (violations.length === 0) {
  console.log("✅ 테넌트 스코프 누락 0건");
  process.exit(0);
}

console.log(`❌ 스코프 누락 ${violations.length}건 — service_role은 RLS를 우회하므로 실제 유출 위험\n`);
for (const v of violations) {
  console.log(`── ${v.file}:${v.line}  [${v.table}]`);
  console.log(`      ${v.snippet}\n`);
}
process.exit(1);
