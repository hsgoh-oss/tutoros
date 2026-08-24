#!/usr/bin/env node
/**
 * 결제선생(Payssam) 파트너 API V2 샌드박스 스모크 — 검수 5종 BILL-ID 수집용.
 *
 * 연동 검수(제출처: partner_dev@paymint.co.kr)에는 결제승인·승인취소·청구서 파기·청구서 조회·
 * 승인 동기화 5종의 BILL-ID가 필요하다. 이 스크립트로 샌드박스에 실제 청구서를 발송·조회·
 * 파기·취소해 그 BILL-ID를 만든다. 절차 전체는 docs/payssam-integration.md 참고.
 *
 * 실행: node scripts/payssam-smoke.mjs <명령> [옵션]   (또는 pnpm payssam:smoke <명령>)
 *
 *   send    --phone 010xxxxxxxx [--name 이름] [--product 명목] [--price 1000]
 *           테스트 청구서 발송(URL 타입 — 카카오톡 미발송, shortUrl만 수신. 기본 1,000원)
 *   read    <billId>                                        청구서 단건 조회(apprState 확인)
 *   destroy <billId> [--price 1000]                         청구서 파기 — 미결제(W) 건만
 *   cancel  <billId> --reason "사유" [--price 1000]         결제 전액 취소 — 승인(F) 건만
 *   receipt <billId> --trader 0 --number 010xxxxxxxx [--price 1000]
 *                                                           현금영수증 발행(0 개인 소득공제 | 1 사업자 지출증빙)
 *   point                                                   쌤포인트 잔액 조회
 *
 * ⚠ hash·봉투·타임아웃 규칙은 lib/payssam/client.ts와 동일해야 한다.
 *   이 스크립트는 Next 밖에서 단독 실행되므로(ts import 불가) 같은 규칙을 자체 구현했다 —
 *   client.ts의 payssamHash·봉투·응답 판정 규칙을 바꾸면 여기도 반드시 함께 바꿀 것.
 *
 * hash의 phone 변형("{billId},{phone},{price}")은 요청 자체에 phone 필드가 있는 /bill 발송에만
 * 적용된다. 파기·취소·현금영수증 요청에는 phone 필드가 없으므로 "{billId},{price}"로 해시한다 —
 * 샌드박스 실측(2026-08-24): destroy에 발송 때의 phone을 넣은 hash는 VALIDATION_002로 거절되고
 * phone 없는 hash가 0000 성공. --phone은 페이민트가 달리 안내할 때만 쓰는 예외 스위치다.
 */
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT_MS = 15_000; // client.ts와 동일

/* ── .env.local 직접 파싱 — dotenv 의존성 없이(scripts/audit-*.mjs 스타일). 셸 환경변수 우선 ── */
function loadEnvLocal() {
  let src;
  try {
    src = readFileSync(`${ROOT}/.env.local`, "utf8");
  } catch {
    return; // 파일이 없으면 셸 환경변수만 사용
  }
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

/* ── client.ts 동기화 구간: hash · billId · 콜백 URL · 봉투 ───────────────── */

// 통신 암호 키 — SHA-256 hex. phone 있으면 "{billId},{phone},{price}", 없으면 "{billId},{price}".
// (lib/payssam/client.ts payssamHash와 동일 규칙 — 변경 시 양쪽 동기화)
function payssamHash(billId, phone, price) {
  const parts = phone ? [billId, phone, String(price)] : [billId, String(price)];
  return createHash("sha256").update(parts.join(","), "utf8").digest("hex");
}

// 파트너 생성 청구서 ID — 최대 20자. (client.ts generateBillId와 동일 규칙)
function generateBillId() {
  const ts = Date.now().toString(36);
  const rand = randomBytes(6).readUIntBE(0, 6).toString(36).padStart(10, "0");
  return `t${ts}${rand}`.slice(0, 20);
}

// 승인 콜백 수신 URL — client.ts defaultCallbackUrl과 동일 규칙
function defaultCallbackUrl() {
  if (process.env.PAYSSAM_CALLBACK_URL) return process.env.PAYSSAM_CALLBACK_URL;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://axiommathlab.kr";
  return `${site.replace(/\/+$/, "")}/api/payssam/callback`;
}

function billEnvelope(bill) {
  return {
    apiKey: process.env.PAYSSAM_API_KEY,
    member: process.env.PAYSSAM_MEMBER_ID,
    merchant: process.env.PAYSSAM_MERCHANT_ID,
    bill,
  };
}

function cashReceiptEnvelope(cashReceipt) {
  return {
    apiKey: process.env.PAYSSAM_API_KEY,
    member: process.env.PAYSSAM_MEMBER_ID,
    merchant: process.env.PAYSSAM_MERCHANT_ID,
    cashReceipt,
  };
}

/* ── 공통 POST — 응답 {code, message, data}. code "0000"만 성공 ─────────────── */
async function postPayssam(path, body) {
  const baseUrl = (process.env.PAYSSAM_BASE_URL ?? "").replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed?.code === "string") return { httpStatus: res.status, ...parsed };
    } catch {
      /* 아래 결과 불명 처리로 */
    }
    // code를 읽을 수 없는 응답 — 거절 확정이 아니라 "결과 불명"이다(flow-canon 검수 37·128).
    return {
      httpStatus: res.status,
      code: "NETWORK",
      message: `응답을 해석할 수 없습니다 (HTTP ${res.status}) — 결과 불명. read로 대조하세요.`,
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      code: "NETWORK",
      message: aborted
        ? "응답 시간 초과(15초) — 결과 불명. read로 대조하세요."
        : `호출 실패(${err?.message ?? err}) — 결과 불명. read로 대조하세요.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ── 출력 유틸 ────────────────────────────────────────────────────────────── */
function printResult(title, result) {
  const ok = result.code === "0000";
  console.log(`\n═══ ${title} ═══`);
  console.log(`  ${ok ? "✅ 성공" : "❌ 실패"}  code=${result.code}  message=${result.message ?? "-"}`);
  const data = result.data;
  if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data)) {
      if (v === null || v === undefined || v === "") continue;
      console.log(`  · ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
    }
  }
  return ok;
}

function printInspectionGuide(billId) {
  console.log(`
┌─ 검수 5종 BILL-ID 수집 안내 (제출처: partner_dev@paymint.co.kr) ─────────────
│ 이번 BILL-ID: ${billId}
│
│ · 청구서 조회 : node scripts/payssam-smoke.mjs read ${billId}
│ · 결제승인    : 위 shortUrl을 브라우저에서 열어 테스트 결제 → read로 apprState=F 확인
│ · 승인 동기화 : 결제승인 건의 콜백을 서버가 {"code":"0000"}으로 응답하면 페이민트 측에서
│                 확인·검수 완료 (공개 URL 필요 — docs/payssam-integration.md §4)
│ · 승인취소    : 결제승인(F) 건 → cancel ${billId} --reason "연동 테스트"
│ · 청구서 파기 : 미결제(W) 건  → destroy ${billId}
│
│ 항목별로 해당 거래의 BILL-ID를 위 메일로 회신하면 페이민트가 로그를 대조해 검수한다.
│ (승인취소·파기는 서로 다른 청구서가 필요하다 — send를 여러 번 실행해 각각 만들 것)
└──────────────────────────────────────────────────────────────────────────────`);
}

function usage() {
  console.log(`사용법: node scripts/payssam-smoke.mjs <명령> [옵션]

  send    --phone 010xxxxxxxx [--name 이름] [--product 명목] [--price 1000]
  read    <billId>
  destroy <billId> [--price 1000]
  cancel  <billId> --reason "사유" [--price 1000]
  receipt <billId> --trader 0 --number 010xxxxxxxx [--price 1000]
  point

destroy/cancel/receipt의 hash는 "{billId},{price}"다(요청에 phone 필드가 없음 — 샌드박스 실측).
자세한 절차: docs/payssam-integration.md`);
}

/* ── 명령 파싱 ────────────────────────────────────────────────────────────── */
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      flags[a.slice(2)] = argv[i + 1];
      i++;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function requireFlag(flags, name, hint) {
  const v = flags[name];
  if (!v) {
    console.error(`❌ --${name} 이(가) 필요합니다. ${hint ?? ""}`);
    process.exit(1);
  }
  return v;
}

// 파기·취소·현금영수증의 hash 재료 — 기본은 phone 없음("{billId},{price}", 샌드박스 실측으로 확정).
// --phone은 페이민트가 달리 안내할 때만 쓰는 예외 스위치다.
function phoneForHash(flags) {
  if (!flags.phone) return null;
  console.log(
    `⚠ --phone 지정 — hash에 phone(${flags.phone})을 포함합니다. 실측 기준 이 계열의 정답은 phone 없는 hash라 VALIDATION_002가 나면 --phone 없이 재시도하세요.`,
  );
  return flags.phone;
}

/* ── 메인 ────────────────────────────────────────────────────────────────── */
async function main() {
  loadEnvLocal();

  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  if (!command) {
    usage();
    process.exit(1);
  }

  // client.ts isPayssamConfigured와 같은 4종 게이트 — 일부만 채워진 채 호출하지 않는다.
  const missing = [
    "PAYSSAM_API_KEY",
    "PAYSSAM_MEMBER_ID",
    "PAYSSAM_MERCHANT_ID",
    "PAYSSAM_BASE_URL",
  ].filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`❌ 환경변수 미설정: ${missing.join(", ")} — .env.local을 확인하세요 (scripts/env.template 참조).`);
    process.exit(1);
  }
  console.log(`대상: ${process.env.PAYSSAM_BASE_URL}`);

  let ok = false;

  switch (command) {
    case "send": {
      const phone = requireFlag(flags, "phone", "예: --phone 01012345678");
      const price = flags.price ?? "1000";
      const billId = generateBillId();
      const callbackUrl = defaultCallbackUrl();
      console.log(`발송 준비: billId=${billId} price=${price} callbackUrl=${callbackUrl}`);
      const result = await postPayssam(
        "/bill",
        billEnvelope({
          billId,
          sendType: "URL", // 스모크는 URL 타입 — 카카오톡을 실제 발송하지 않고 shortUrl만 받는다
          productName: flags.product ?? "연동 테스트 청구",
          price,
          memberName: flags.name ?? "연동테스트",
          phone,
          hash: payssamHash(billId, phone, price),
          callbackUrl,
        }),
      );
      ok = printResult("청구서 발송 (/bill)", result);
      if (ok) {
        console.log(`\n  BILL-ID : ${result.data?.billId ?? billId}`);
        console.log(`  shortUrl: ${result.data?.shortUrl ?? "(응답에 없음)"}`);
        printInspectionGuide(result.data?.billId ?? billId);
      }
      break;
    }

    case "read": {
      const billId = positional[1];
      if (!billId) {
        console.error("❌ billId가 필요합니다. 예: read t123abc...");
        process.exit(1);
      }
      const result = await postPayssam("/bill/read", billEnvelope({ billId }));
      ok = printResult(`청구서 조회 (/bill/read) — ${billId}`, result);
      if (ok) {
        const state = result.data?.apprState;
        const label =
          { F: "승인(결제완료)", W: "미결제(대기)", C: "취소", D: "파기" }[state] ?? "알 수 없음";
        console.log(`\n  apprState=${state ?? "-"} → ${label}`);
        console.log(`  이 BILL-ID(${billId})는 검수 항목 "청구서 조회"에 제출할 수 있다.`);
      }
      break;
    }

    case "destroy": {
      const billId = positional[1];
      if (!billId) {
        console.error("❌ billId가 필요합니다. 예: destroy t123abc... --phone 01012345678");
        process.exit(1);
      }
      const price = flags.price ?? "1000";
      const phone = phoneForHash(flags);
      const result = await postPayssam(
        "/bill/destroy",
        billEnvelope({ billId, price, hash: payssamHash(billId, phone, price) }),
      );
      ok = printResult(`청구서 파기 (/bill/destroy) — ${billId}`, result);
      if (ok) {
        console.log(`\n  이 BILL-ID(${billId})는 검수 항목 "청구서 파기"에 제출할 수 있다.`);
        console.log("  (파기는 승인 전(W) 건만 가능 — 수납된 청구는 취소·환불 먼저, flow-canon 검수 42)");
      }
      break;
    }

    case "cancel": {
      const billId = positional[1];
      if (!billId) {
        console.error('❌ billId가 필요합니다. 예: cancel t123abc... --reason "연동 테스트" --phone 01012345678');
        process.exit(1);
      }
      const cancelReason = requireFlag(flags, "reason", '예: --reason "연동 테스트"');
      const price = flags.price ?? "1000";
      const phone = phoneForHash(flags);
      const result = await postPayssam(
        "/bill/cancel",
        billEnvelope({ billId, price, cancelReason, hash: payssamHash(billId, phone, price) }),
      );
      ok = printResult(`결제 취소 (/bill/cancel) — ${billId}`, result);
      if (ok) {
        console.log(`\n  이 BILL-ID(${billId})는 검수 항목 "승인취소"에 제출할 수 있다.`);
        console.log("  (취소는 승인(F) 건만 가능 — shortUrl에서 테스트 결제를 먼저 완료할 것)");
      }
      break;
    }

    case "receipt": {
      const billId = positional[1];
      if (!billId) {
        console.error("❌ billId가 필요합니다. 예: receipt t123abc... --trader 0 --number 01012345678");
        process.exit(1);
      }
      const trader = flags.trader ?? "0";
      if (trader !== "0" && trader !== "1") {
        console.error("❌ --trader 는 0(개인 소득공제) 또는 1(사업자 지출증빙)이어야 합니다.");
        process.exit(1);
      }
      const issuanceNumber = requireFlag(
        flags,
        "number",
        "발행 요청 번호(휴대폰/주민번호/사업자번호). 예: --number 01012345678",
      );
      const price = flags.price ?? "1000";
      const phone = phoneForHash(flags);
      // supplyPrice/tax는 생략 — 스펙상 미전송 시 사업장의 면·과세 정책을 따른다(client.ts와 동일)
      const result = await postPayssam(
        "/cash-receipt/issue",
        cashReceiptEnvelope({
          billId,
          hash: payssamHash(billId, phone, price),
          price,
          issuanceNumber,
          trader,
        }),
      );
      ok = printResult(`현금영수증 발행 (/cash-receipt/issue) — ${billId}`, result);
      if (ok) {
        console.log(`\n  apprCashNum(승인번호): ${result.data?.apprCashNum ?? "-"}`);
      }
      break;
    }

    case "point": {
      // 포인트 조회는 봉투가 아니라 {apiKey}만 보낸다(스펙 PartnerReadRequest)
      const result = await postPayssam("/read/remain_count", {
        apiKey: process.env.PAYSSAM_API_KEY,
      });
      ok = printResult("쌤포인트 잔액 (/read/remain_count)", result);
      if (ok) {
        console.log(`\n  잔액: ${result.data?.balance ?? "-"}P (발송 1건당 55P — 100건 미만인 5,500P 이하면 충전 권장)`);
        if (result.data?.chargeUrl) console.log(`  충전 URL: ${result.data.chargeUrl}`);
      }
      break;
    }

    default:
      console.error(`❌ 알 수 없는 명령: ${command}\n`);
      usage();
      process.exit(1);
  }

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("❌ 예기치 못한 오류:", err);
  process.exit(1);
});
