// 결제선생(Payssam) 파트너 API V2 응답 타입 — 스펙(parsed_endpoints.txt) 필드명과 1:1.
// 외부 응답은 보증이 없으므로 전 필드 optional — 호출부가 필요한 값의 존재를 직접 확인한다.

/**
 * 클라이언트 공통 결과 — 호출부가 "결과 불명"을 구분할 수 있게 3분류한다(flow-canon 검수 37·128).
 * - ok:true                 → code "0000" 성공.
 * - ok:false, code:"NETWORK" → 결과 불명(타임아웃·연결 실패·응답 해석 불가). 서버가 처리했을 수 있으므로
 *                              실패로 확정하지 말고 /bill/read로 대조할 것.
 * - ok:false, 그 외 code     → API 명시 거절(요청 미접수) 또는 "NOT_CONFIGURED"(호출 자체를 안 함).
 */
export type PayssamResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; error: string };

/** 승인 상태 — F:승인, W:미결제(대기), C:취소, D:파기. 현금영수증 이력은 F/C만 온다. */
export type PayssamApprState = "F" | "W" | "C" | "D";

/** 현금영수증 발급 구분 — 개인(소득공제):"0", 사업자(지출증빙):"1" */
export type PayssamCashTrader = "0" | "1";

/** POST /bill 응답 data — BillResponse */
export interface BillSendData {
  apiKey?: string;
  member?: string;
  merchant?: string;
  billId?: string;
  hash?: string;
  /** 생성된 청구서 단축 URL */
  shortUrl?: string;
}

/** POST /bill/resend 응답 data — BillResendResponse */
export interface BillResendData {
  apiKey?: string;
  billId?: string;
}

/** POST /bill/read 응답 data — BillReadPortResponse (v1 SyncVO.Approval과 동일 구성) */
export interface BillReadData {
  apiKey?: string;
  billId?: string;
  /** 결제수단 코드 (간편결제 0 등) */
  apprPayType?: string;
  /** 카드 종류 (신용/체크/정보없음 등) */
  apprCardType?: string;
  /** 승인 일시 (YYYYMMDDhhmmss) */
  apprDt?: string;
  /** 원거래 승인 일시 */
  apprOriginDt?: string;
  /** 승인 금액 */
  apprPrice?: string;
  /** 카드명 또는 은행명 */
  apprIssuer?: string;
  /** 발행사 코드 또는 은행 코드 */
  apprIssuerCd?: string;
  /** 카드번호 또는 계좌번호 */
  apprIssuerNum?: string;
  /** 매입사 코드 */
  apprAcquirerCd?: string;
  /** 매입사명 */
  apprAcquirerNm?: string;
  /** 승인/취소 거래번호 */
  apprNum?: string;
  /** 원거래 승인번호 */
  apprOriginNum?: string;
  /** VAN 응답 코드 */
  apprResCd?: string;
  /** 할부 개월수 (0: 일시불) */
  apprMonthly?: string;
  /** 승인 상태 — PayssamApprState(F/W/C/D). 외부값이라 string으로 받는다. */
  apprState?: string;
  /** 현금영수증 승인번호 */
  apprCashNum?: string;
  /** 현금영수증 발급 구분 */
  apprCashTrader?: string;
  /** 현금영수증 발급 요청 번호 */
  apprCashIssuanceNumber?: string;
  /** 신용카드 가맹점 정보 (헬스케어 스펙) */
  apprCardMerchantNum?: string;
  /** 단말기 번호 (헬스케어 스펙) */
  catId?: string;
  /** 거래 고유번호 (헬스케어 스펙) */
  dscTxNum?: string;
  /** 페이민트 공통 카드 타입 (영남대/KOCES 전용) */
  cardType?: string;
  /** 전자서명 데이터 (헬스케어 스펙, Base64) */
  apprSign?: string;
  udItem?: unknown;
}

/** POST /bill/destroy 응답 data — BillDestroyResponse */
export interface BillDestroyData {
  apiKey?: string;
  /** 파기된 청구서 ID */
  billId?: string;
}

/** POST /bill/cancel 응답 data — BillCancelPortResponse */
export interface BillCancelData {
  apiKey?: string;
  member?: string;
  merchant?: string;
  billId?: string;
  hash?: string;
  /** 취소 승인 거래번호 */
  apprNum?: string;
  /** 원거래 승인번호 */
  apprOriginNum?: string;
  /** 취소 일시 (YYYYMMDDhhmmss) */
  apprCancelDt?: string;
}

/** POST /cash-receipt/issue 응답 data — CashReceiptIssueResponse */
export interface CashReceiptIssueData {
  apiKey?: string;
  member?: string;
  merchant?: string;
  billId?: string;
  hash?: string;
  /** 발급 구분 (소득공제/지출증빙) */
  trader?: string;
  /** 현금영수증 승인번호 */
  apprCashNum?: string;
  /** 발급 요청 번호 (휴대폰/주민번호/사업자번호) */
  issuanceNumber?: string;
}

/** POST /cash-receipt/cancel 응답 data — CashReceiptCancelResponse */
export interface CashReceiptCancelData {
  apiKey?: string;
  member?: string;
  merchant?: string;
  billId?: string;
  hash?: string;
  /** 현금영수증 취소 승인번호 */
  apprCashNum?: string;
}

/** POST /cash-receipt/read 응답 data.info[] — 현금영수증 단건 이력 */
export interface CashReceiptHistoryItem {
  billId?: string;
  apprPrice?: string;
  apprSupplyPrice?: string;
  apprTax?: string;
  /** 발급 구분 (소득공제/지출증빙) */
  trader?: string;
  /** 승인번호 */
  apprNum?: string;
  /** 승인 상태 (F:승인, C:취소) */
  apprState?: string;
  /** 승인 일시 (YYYYMMDDhhmmss) */
  apprDt?: string;
  /** 발급 요청 번호 */
  issuanceNumber?: string;
}

/** POST /cash-receipt/read 응답 data — CashReceiptReadResponse */
export interface CashReceiptReadData {
  apiKey?: string;
  member?: string;
  merchant?: string;
  billId?: string;
  /** 현금영수증 이력 목록 (발행/취소 포함) */
  info?: CashReceiptHistoryItem[];
}

/** POST /read/remain_count 응답 data — RemainCountResponse (쌤포인트 잔액) */
export interface RemainPointData {
  /** 잔여 포인트 */
  balance?: number;
  /** 충전 URL */
  chargeUrl?: string;
}
