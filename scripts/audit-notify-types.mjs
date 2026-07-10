#!/usr/bin/env node
/**
 * 알림 타입 정합 감사.
 *
 * notifications.type에는 CHECK 제약이 없고, 세 곳이 이 테이블에 행을 적재한다.
 *   1) 앱 코드      — lib/notify/send.ts (NotifyType으로 컴파일 시 강제)
 *   2) SQL 자동화   — supabase/migrations/*.sql (예: automation_schedule_autoclean)
 *   3) Deno 엣지 함수 — supabase/functions/**  (예: lessonReminder, paymentD3)
 *
 * 2·3은 TypeScript 타입 검사를 받지 않는다. 여기서 적재한 타입이 NotifyType 유니온에 없으면
 * app/api/cron/flush가 알림톡 템플릿을 찾지 못하고, 그 타입은 영영 SMS로만 나간다.
 * (실제로 exam_report·schedule_unresolved가 그렇게 누락돼 있었다.)
 *
 * 실행: node scripts/audit-notify-types.mjs   (불일치 시 종료 코드 1)
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* ── 1. NotifyType 유니온 추출 (단일 진실 원천) ── */
const templatesSrc = readFileSync(`${ROOT}/lib/notify/templates.ts`, "utf8");
const unionMatch = templatesSrc.match(/export type NotifyType =([\s\S]*?);/);
if (!unionMatch) {
  console.error("❌ lib/notify/templates.ts에서 NotifyType 유니온을 찾지 못했습니다.");
  process.exit(1);
}
// 숫자를 포함하는 키(payment_d3)가 있으므로 [a-z0-9_]+ 이어야 한다.
const declared = new Set(
  [...unionMatch[1].matchAll(/"([a-z][a-z0-9_]*)"/g)].map((m) => m[1]),
);

// NOTIFY_TEMPLATES 키도 유니온과 일치해야 isNotifyType(Object.hasOwn 기반)이 참을 반환한다.
const tableMatch = templatesSrc.match(
  /export const NOTIFY_TEMPLATES[\s\S]*?=\s*\{([\s\S]*?)\n\};/,
);
const templateKeys = new Set(
  tableMatch
    ? [...tableMatch[1].matchAll(/^\s{2}([a-z][a-z0-9_]*):/gm)].map((m) => m[1])
    : [],
);

/* ── 2. SQL·엣지 함수가 notifications에 적재하는 type 문자열 수집 ── */
const producers = [];

// 2-a. SQL: insert into ... notifications ... values (..., 'type_key', ...)
const sqlFiles = execSync(`find "${ROOT}/supabase/migrations" -name '*.sql'`, {
  encoding: "utf8",
}).trim().split("\n").filter(Boolean);

for (const file of sqlFiles) {
  const src = readFileSync(file, "utf8");
  const re = /insert\s+into\s+public\.notifications[\s\S]{0,400}?values\s*\(([\s\S]{0,400}?)\)\s*;/gi;
  for (const m of src.matchAll(re)) {
    // values 절의 작은따옴표 리터럴 중 snake_case 식별자를 후보로 본다.
    for (const lit of m[1].matchAll(/'([a-z][a-z_]{3,})'/g)) {
      const v = lit[1];
      if (v === "queued" || v === "sent" || v === "failed") continue; // status
      if (v === "alimtalk" || v === "sms") continue; // channel
      producers.push({ type: v, file: file.replace(ROOT + "/", ""), kind: "SQL" });
    }
  }
}

// 2-b. Deno 엣지 함수: .insert({ ... type: "type_key" ... })
const fnFiles = execSync(`find "${ROOT}/supabase/functions" -name '*.ts'`, {
  encoding: "utf8",
}).trim().split("\n").filter(Boolean);

for (const file of fnFiles) {
  const src = readFileSync(file, "utf8");
  // .from("...") 으로 조각내고, notifications 체인인 조각에서만 type을 추출한다.
  // (ai_reports 등 다른 테이블도 type 컬럼을 가지므로 파일 전체 스캔은 오탐을 낳는다.)
  const chunks = src.split(/\.from\(/);
  for (const chunk of chunks.slice(1)) {
    if (!/^\s*["']notifications["']\s*\)/.test(chunk)) continue;
    const scope = chunk.slice(0, 800);
    for (const m of scope.matchAll(/type:\s*["']([a-z][a-z0-9_]*)["']/g)) {
      producers.push({ type: m[1], file: file.replace(ROOT + "/", ""), kind: "Edge" });
    }
    // 멱등성 검사 .eq("type", "...") 도 같은 타입을 참조한다.
    for (const m of scope.matchAll(/\.eq\(\s*["']type["']\s*,\s*["']([a-z][a-z0-9_]*)["']\s*\)/g)) {
      producers.push({ type: m[1], file: file.replace(ROOT + "/", ""), kind: "Edge" });
    }
  }
}

/* ── 3. 대조 ── */
const problems = [];

for (const p of producers) {
  if (!declared.has(p.type)) {
    problems.push(
      `${p.kind} ${p.file} 이(가) 적재하는 '${p.type}' 이(가) NotifyType 유니온에 없습니다.`,
    );
  }
}
for (const t of declared) {
  if (!templateKeys.has(t)) {
    problems.push(`NotifyType '${t}' 에 대응하는 NOTIFY_TEMPLATES 항목이 없습니다 (isNotifyType이 false 반환).`);
  }
}
for (const k of templateKeys) {
  if (!declared.has(k)) {
    problems.push(`NOTIFY_TEMPLATES '${k}' 이(가) NotifyType 유니온에 없습니다.`);
  }
}

const producedTypes = [...new Set(producers.map((p) => p.type))].sort();

console.log("═══ 알림 타입 정합 감사 ═══");
console.log(`  NotifyType 유니온     : ${declared.size}종`);
console.log(`  NOTIFY_TEMPLATES 키   : ${templateKeys.size}종`);
console.log(`  SQL·엣지 함수가 적재  : ${producedTypes.length}종 (${producedTypes.join(", ")})`);
console.log("");

if (problems.length === 0) {
  console.log("✅ 알림 타입 정합 — 불일치 0건");
  process.exit(0);
}

console.log(`❌ 불일치 ${problems.length}건\n`);
for (const p of problems) console.log(`  · ${p}`);
console.log("\n  → lib/notify/templates.ts의 NotifyType·NOTIFY_TEMPLATES를 동기화하세요.");
process.exit(1);
