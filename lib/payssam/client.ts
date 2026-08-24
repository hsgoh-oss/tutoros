// 결제선생(Payssam) 파트너 API V2 클라이언트 — 카카오톡 청구서 발송·조회·파기·취소·현금영수증·쌤포인트.
// lib/notify/solapi.ts와 같은 계약(설정 게이트→fetch→오류 정규화). DB를 만지지 않는 순수 전송 계층이며
// 수납 반영·상태 전이·감사는 호출부 책임이다(flow-canon M0 분리 — 여기서는 외부 승인 스냅샷만 오간다).
//
// 결과 3분류 — 호출부가 "결과 불명"을 구분할 수 있어야 한다(검수 37·128):
//   {ok:true, data}                  : code "0000" 성공.
//   {ok:false, code:"NETWORK"}       : 결과 불명 — 타임아웃·연결 실패·응답 해석 불가. 요청이 서버에 도달해
//                                      처리됐을 수 있으므로 실패로 확정하지 말고 readBill()로 대조할 것.
//   {ok:false, code:"NOT_CONFIGURED"}: 환경변수 미설정 — 호출 자체를 하지 않음.
//   {ok:false, code:그 외}           : API 명시 거절(코드·메시지 수신) — 요청이 접수되지 않은 것.

import { createHash, randomBytes } from "crypto";
import type {
  BillCancelData,
  BillDestroyData,
  BillReadData,
  BillResendData,
  BillSendData,
  CashReceiptCancelData,
  CashReceiptIssueData,
  CashReceiptReadData,
  PayssamCashTrader,
  PayssamResult,
  RemainPointData,
} from "./types";

const TIMEOUT_MS = 15_000;

// 4개 전부 있어야 "설정됨" — BASE_URL까지 요구해 기본값이 샌드박스/운영을 뒤바꾸는 사고를 막는다.
// (solapi.ts와 같은 이유: 일부만 채워 게이트가 열리면 발송 시도가 전부 실패로 쌓여 켜기 전보다 나빠진다.)
export function isPayssamConfigured(): boolean {
  return Boolean(
    process.env.PAYSSAM_API_KEY &&
      process.env.PAYSSAM_MEMBER_ID &&
      process.env.PAYSSAM_MERCHANT_ID &&
      process.env.PAYSSAM_BASE_URL,
  );
}

/**
 * 통신 암호 키 — SHA-256 hex.
 * 규칙(2026-08-24 샌드박스 실측): hash의 phone 포함 여부는 "요청 본문에 phone 필드가 있는가"를 따른다.
 * /bill 발송(요청에 phone 있음)만 3필드 "{billId},{phone},{price}", 파기·취소·현금영수증 계열
 * (요청에 phone 없음)은 2필드 "{billId},{price}" — phone을 넣으면 VALIDATION_002로 거절된다.
 * price는 스펙상 문자열이므로 숫자가 와도 String()으로 정규화해 요청 필드와 같은 표기를 해시한다.
 */
export function payssamHash(
  billId: string,
  phone: string | null | undefined,
  price: string | number,
): string {
  const parts = phone
    ? [billId, phone, String(price)]
    : [billId, String(price)];
  return createHash("sha256").update(parts.join(","), "utf8").digest("hex");
}

/**
 * 파트너 생성 청구서 ID — 최대 20자(스펙 maxLength=20).
 * 't' + base36 밀리초 시각(8자) + 48bit 난수 base36(10자) = 19자. 같은 밀리초 안에서만 난수 충돌이
 * 문제인데 2^48이라 무시 가능. slice는 시각 자릿수가 늘어나는 2059년 이후 대비 방어선.
 */
export function generateBillId(): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(6).readUIntBE(0, 6).toString(36).padStart(10, "0");
  return `t${ts}${rand}`.slice(0, 20);
}

/** 승인 콜백 수신 URL — 미지정 시 사이트 기본 도메인의 /api/payssam/callback */
function defaultCallbackUrl(): string {
  if (process.env.PAYSSAM_CALLBACK_URL) return process.env.PAYSSAM_CALLBACK_URL;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://axiommathlab.kr";
  return `${site.replace(/\/+$/, "")}/api/payssam/callback`;
}

/** {apiKey, member, merchant} 공통 봉투 — bill 계열 */
function billEnvelope(bill: Record<string, unknown>): Record<string, unknown> {
  return {
    apiKey: process.env.PAYSSAM_API_KEY,
    member: process.env.PAYSSAM_MEMBER_ID,
    merchant: process.env.PAYSSAM_MERCHANT_ID,
    bill,
  };
}

/** {apiKey, member, merchant} 공통 봉투 — cash-receipt 계열(키 이름이 bill이 아니라 cashReceipt) */
function cashReceiptEnvelope(
  cashReceipt: Record<string, unknown>,
): Record<string, unknown> {
  return {
    apiKey: process.env.PAYSSAM_API_KEY,
    member: process.env.PAYSSAM_MEMBER_ID,
    merchant: process.env.PAYSSAM_MERCHANT_ID,
    cashReceipt,
  };
}

/**
 * 공통 POST — 15초 타임아웃(AbortController), 응답 {code, message, data} 정규화.
 * HTTP 상태와 무관하게 몸체의 code가 판정 기준이다(스펙: 200 + code). code를 읽을 수 없는 응답
 * (HTML 에러 페이지·5xx 빈 몸체 등)은 서버가 처리했는지 알 수 없으므로 NETWORK(결과 불명)로 묶는다.
 */
async function postPayssam<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<PayssamResult<T>> {
  if (!isPayssamConfigured()) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      error: "결제선생 연동이 설정되지 않았습니다.",
    };
  }
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
    let parsed: { code?: unknown; message?: unknown; data?: unknown } | null =
      null;
    try {
      parsed = JSON.parse(text) as {
        code?: unknown;
        message?: unknown;
        data?: unknown;
      };
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed.code !== "string") {
      // 코드 없는 응답은 거절 확정이 아니라 결과 불명 — 호출부가 readBill로 대조하게 NETWORK로 분류.
      console.error("[payssam] 응답 해석 불가", path, res.status);
      return {
        ok: false,
        code: "NETWORK",
        error: `결제선생 응답을 해석할 수 없습니다 (HTTP ${res.status})`,
      };
    }
    if (parsed.code !== "0000") {
      return {
        ok: false,
        code: parsed.code,
        error:
          typeof parsed.message === "string" && parsed.message
            ? parsed.message
            : "결제선생 API가 요청을 거절했습니다.",
      };
    }
    return { ok: true, data: (parsed.data ?? {}) as T };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    console.error("[payssam] 호출 오류", path, err);
    return {
      ok: false,
      code: "NETWORK",
      error: aborted
        ? "결제선생 API 응답 시간 초과(15초)"
        : "결제선생 API 호출에 실패했습니다.",
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface SendBillParams {
  /** 파트너 생성 청구서 ID(최대 20자) — generateBillId() 사용 */
  billId: string;
  /** 청구 사유 */
  productName: string;
  /** 결제 금액(원) */
  price: string | number;
  /** 고객명 */
  memberName: string;
  /** 고객 전화번호 */
  phone: string;
  /** 안내메세지 */
  message?: string;
  /** 유효기간 YYYY-MM-DD */
  expireDt?: string;
  /** 청구서 발급처명 */
  billIssuer?: string;
  /** 결제 완료 콜백 URL — 미지정 시 PAYSSAM_CALLBACK_URL → SITE_URL+/api/payssam/callback */
  callbackUrl?: string;
  /** 발송 방식 — 기본 TALK(카카오톡 발송). URL이면 shortUrl만 응답받는다. */
  sendType?: "TALK" | "URL";
}

/** POST /bill — 청구서 생성·발송. 성공 data.shortUrl이 청구서 단축 URL. */
export function sendBill(
  params: SendBillParams,
): Promise<PayssamResult<BillSendData>> {
  const price = String(params.price);
  // undefined 값은 JSON.stringify가 생략하므로 옵션 필드는 그대로 넘긴다.
  return postPayssam<BillSendData>(
    "/bill",
    billEnvelope({
      billId: params.billId,
      sendType: params.sendType ?? "TALK",
      billIssuer: params.billIssuer,
      productName: params.productName,
      price,
      memberName: params.memberName,
      phone: params.phone,
      message: params.message,
      expireDt: params.expireDt,
      hash: payssamHash(params.billId, params.phone, price),
      callbackUrl: params.callbackUrl ?? defaultCallbackUrl(),
    }),
  );
}

/** POST /bill/resend — 카카오톡 재발송 */
export function resendBill(
  billId: string,
): Promise<PayssamResult<BillResendData>> {
  return postPayssam<BillResendData>("/bill/resend", billEnvelope({ billId }));
}

/** POST /bill/read — 청구서 단건 조회. data.apprState: F승인/W미결제/C취소/D파기. */
export function readBill(billId: string): Promise<PayssamResult<BillReadData>> {
  return postPayssam<BillReadData>("/bill/read", billEnvelope({ billId }));
}

/**
 * POST /bill/destroy — 청구서 파기(승인 전만 가능).
 * 수납된 청구는 파기 불가·금지(flow-canon 검수 42) — 취소는 cancelBill로.
 * phone은 hash 재료로만 쓰인다(발송 당시 phone을 넣었으면 같은 값 필수).
 */
export function destroyBill(
  billId: string,
  price: string | number,
): Promise<PayssamResult<BillDestroyData>> {
  const priceStr = String(price);
  return postPayssam<BillDestroyData>(
    "/bill/destroy",
    billEnvelope({
      billId,
      price: priceStr,
      // 요청에 phone 필드가 없는 계열은 2필드 hash(실측 — payssamHash 주석 참조).
      hash: payssamHash(billId, null, priceStr),
    }),
  );
}

/** POST /bill/cancel — 결제 완료 건 전액 취소(승인→승인취소). 2필드 hash(요청에 phone 없음 — 실측). */
export function cancelBill(
  billId: string,
  price: string | number,
  cancelReason: string,
): Promise<PayssamResult<BillCancelData>> {
  const priceStr = String(price);
  return postPayssam<BillCancelData>(
    "/bill/cancel",
    billEnvelope({
      billId,
      price: priceStr,
      cancelReason,
      hash: payssamHash(billId, null, priceStr),
    }),
  );
}

export interface IssueCashReceiptParams {
  /** 청구서 ID(20자 이내, 중복 불가) */
  billId: string;
  /** 결제 금액 */
  price: string | number;
  /** 공급가액 — 생략 시 사업장의 면·과세 정책을 따른다 */
  supplyPrice?: string | number;
  /** 세액 — 생략 시 사업장의 면·과세 정책을 따른다 */
  tax?: string | number;
  /** 현금영수증 발행 요청 번호(휴대폰/주민번호/사업자번호) */
  issuanceNumber: string;
  /** 개인(소득공제):"0" | 사업자(지출증빙):"1" */
  trader: PayssamCashTrader;
}

/** POST /cash-receipt/issue — 현금영수증 발행 */
export function issueCashReceipt(
  params: IssueCashReceiptParams,
): Promise<PayssamResult<CashReceiptIssueData>> {
  const price = String(params.price);
  return postPayssam<CashReceiptIssueData>(
    "/cash-receipt/issue",
    cashReceiptEnvelope({
      billId: params.billId,
      hash: payssamHash(params.billId, null, price), // 2필드 hash(실측)
      price,
      supplyPrice:
        params.supplyPrice === undefined
          ? undefined
          : String(params.supplyPrice),
      tax: params.tax === undefined ? undefined : String(params.tax),
      issuanceNumber: params.issuanceNumber,
      trader: params.trader,
    }),
  );
}

export interface CancelCashReceiptParams {
  billId: string;
  price: string | number;
  /** 개인(소득공제):"0" | 사업자(지출증빙):"1" */
  trader: PayssamCashTrader;
}

/** POST /cash-receipt/cancel — 현금영수증 취소(환불 수렴 경로 — flow-canon 검수 45) */
export function cancelCashReceipt(
  params: CancelCashReceiptParams,
): Promise<PayssamResult<CashReceiptCancelData>> {
  const price = String(params.price);
  return postPayssam<CashReceiptCancelData>(
    "/cash-receipt/cancel",
    cashReceiptEnvelope({
      billId: params.billId,
      hash: payssamHash(params.billId, null, price), // 2필드 hash(실측)
      price,
      trader: params.trader,
    }),
  );
}

/** POST /cash-receipt/read — 현금영수증 이력 조회(발행/취소 포함, data.info[]) */
export function readCashReceipt(
  billId: string,
  price: string | number,
): Promise<PayssamResult<CashReceiptReadData>> {
  const priceStr = String(price);
  return postPayssam<CashReceiptReadData>(
    "/cash-receipt/read",
    cashReceiptEnvelope({
      billId,
      hash: payssamHash(billId, null, priceStr), // 2필드 hash(실측)
      price: priceStr,
    }),
  );
}

/** POST /read/remain_count — 쌤포인트(발송 재화) 잔액 조회. 봉투가 아니라 {apiKey}만 보낸다. */
export function readRemainPoint(): Promise<PayssamResult<RemainPointData>> {
  return postPayssam<RemainPointData>("/read/remain_count", {
    apiKey: process.env.PAYSSAM_API_KEY,
  });
}
