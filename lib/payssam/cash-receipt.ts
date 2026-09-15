import type { CashReceiptHistoryItem, PayssamCashTrader } from "./types";

export type CashReceiptTaxType = "exempt" | "taxable";

/** 발급번호는 전송에만 사용하며 DB·감사 로그에 저장하지 않는다. */
export function validateCashReceiptInput(trader: string, number: string, taxType: string) {
  if (trader !== "0" && trader !== "1") {
    return { ok: false as const, error: "발급 구분을 선택해 주세요." };
  }
  if (taxType !== "exempt" && taxType !== "taxable") {
    return { ok: false as const, error: "사업장에 맞는 면세·과세 구분을 선택해 주세요." };
  }
  const normalized = number.replace(/[\s-]/g, "");
  if (trader === "0" ? !/^01\d{8,9}$/.test(normalized) : !/^\d{10}$/.test(normalized)) {
    return {
      ok: false as const,
      error: trader === "0" ? "소득공제용 휴대전화번호 10~11자리를 입력해 주세요." : "사업자등록번호 10자리를 입력해 주세요.",
    };
  }
  return { ok: true as const, trader: trader as PayssamCashTrader, number: normalized, taxType: taxType as CashReceiptTaxType };
}

export function cashReceiptAmounts(amount: number, taxType: CashReceiptTaxType) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("유효하지 않은 현금영수증 금액입니다.");
  const supplyPrice = taxType === "exempt" ? amount : Math.round(amount / 1.1);
  return { supplyPrice, tax: amount - supplyPrice };
}

/** 필수 값이 누락되거나 다른 거래가 섞이면 내부 증빙을 덮어쓰지 않는다. */
export function parseCashReceiptHistory(data: unknown, billId: string, amount: number):
  | { ok: true; latest: CashReceiptHistoryItem | null }
  | { ok: false; error: string } {
  const invalid = { ok: false as const, error: "결제선생 영수증 이력의 거래번호·금액·승인 정보를 확인할 수 없습니다." };
  if (!data || typeof data !== "object") return invalid;
  const result = data as { billId?: unknown; info?: unknown };
  if (result.billId !== billId || !Array.isArray(result.info)) return invalid;
  let latest: CashReceiptHistoryItem | null = null;
  const normalizedHistory: CashReceiptHistoryItem[] = [];
  for (const item of result.info) {
    if (!item || typeof item !== "object") return invalid;
    const row = { ...item } as CashReceiptHistoryItem;
    // 샌드박스 실응답은 항목의 billId를 생략하고 날짜를 YYMMDDhhmmss로 돌려준다.
    // 상위 billId를 필수 대조하고, 항목에 ID가 있으면 함께 대조한다.
    if (typeof row.apprDt === "string" && /^\d{12}$/.test(row.apprDt)) row.apprDt = `20${row.apprDt}`;
    if ((row.billId != null && row.billId !== billId) || typeof row.apprPrice !== "string" || !/^\d+$/.test(row.apprPrice) || Number(row.apprPrice) !== amount
      || (row.apprState !== "F" && row.apprState !== "C") || (row.trader !== "0" && row.trader !== "1")
      || typeof row.apprNum !== "string" || !row.apprNum.trim()
      || typeof row.apprDt !== "string" || !/^\d{14}$/.test(row.apprDt) || !cashReceiptDate(row.apprDt)) return invalid;
    normalizedHistory.push(row);
    if (!latest || row.apprDt > latest.apprDt!) latest = row;
  }
  // 순서가 명시되지 않은 이력에서 같은 초의 승인·취소는 임의로 판정하지 않는다.
  if (latest && normalizedHistory.some((row) => row.apprDt === latest.apprDt && row.apprState !== latest.apprState)) {
    return { ok: false, error: "같은 시각의 발급·취소 이력이 있습니다. 결제선생에서 최종 상태를 확인해 주세요." };
  }
  return { ok: true, latest };
}

export function cashReceiptDate(raw: string): string | null {
  if (!/^\d{14}$/.test(raw)) return null;
  const wall = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}`;
  const date = new Date(`${wall}+09:00`);
  if (Number.isNaN(date.getTime())) return null;
  // Date는 2월 30일 등을 다음 달로 보정하므로 역변환해 실제 달력 날짜인지 확인한다.
  if (new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 19) !== wall) return null;
  return date.toISOString();
}
