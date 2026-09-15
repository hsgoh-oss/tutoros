"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Field, Input, Select } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button";
import { cashReceiptAmounts, validateCashReceiptInput } from "@/lib/payssam/cash-receipt";
import { issueCashReceiptAction } from "./cash-receipt-actions";

export function PayssamCashReceiptForm({ id, amount }: { id: string; amount: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [trader, setTrader] = useState("0");
  const [number, setNumber] = useState("");
  const [taxType, setTaxType] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const titleId = useId();
  const amounts = taxType === "exempt" || taxType === "taxable" ? cashReceiptAmounts(amount, taxType) : null;
  const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;

  async function issue() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await issueCashReceiptAction(id, trader, number, taxType);
      if (result.ok) {
        setNumber("");
        if (result.warning) setError(result.warning);
      } else setError(result.error ?? "발급 결과를 확인해 주세요.");
    } catch {
      setError("요청 결과를 확인하지 못했습니다. 다시 발급하지 말고 ‘결제선생과 대조’로 확인해 주세요.");
    } finally {
      inFlight.current = false;
      setPending(false);
      dialog.current?.close();
      router.refresh();
    }
  }

  return (
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      const input = validateCashReceiptInput(trader, number, taxType);
      if (!input.ok) { setError(input.error); return; }
      setError(null);
      dialog.current?.showModal();
    }}>
      <p className="text-sm text-muted">확인된 입금액 {won(amount)}에 대한 현금영수증을 발급합니다.</p>
      <Field label="발급 구분" required>
        <Select value={trader} onChange={(event) => { setTrader(event.target.value); setNumber(""); }} disabled={pending}>
          <option value="0">개인 소득공제</option>
          <option value="1">사업자 지출증빙</option>
        </Select>
      </Field>
      <Field label={trader === "0" ? "소득공제용 휴대전화번호" : "사업자등록번호"} required>
        <Input value={number} onChange={(event) => setNumber(event.target.value)}
          placeholder={trader === "0" ? "010-1234-5678" : "123-45-67890"}
          inputMode="numeric" autoComplete="off" maxLength={13} required disabled={pending} />
      </Field>
      <Field label="면세·과세 구분" required hint="사업장에 등록된 과세 유형에 맞게 선택해 주세요.">
        <Select value={taxType} onChange={(event) => setTaxType(event.target.value)} required disabled={pending}>
          <option value="" disabled>선택해 주세요</option>
          <option value="exempt">면세</option>
          <option value="taxable">과세 (부가세 10% 포함)</option>
        </Select>
      </Field>
      {amounts && <p className="text-xs text-muted">공급가액 {won(amounts.supplyPrice)} · 세액 {won(amounts.tax)}</p>}
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      <button type="submit" disabled={pending} className={buttonClass("outline", "sm", "w-full")}>
        {pending ? "발급 중..." : "현금영수증 발급"}
      </button>
      <dialog ref={dialog} className="dash-action-dialog" aria-labelledby={titleId}
        onCancel={(event) => { if (pending) event.preventDefault(); }}>
        <div className="dash-action-dialog-body">
          <h2 id={titleId}>현금영수증 발급</h2>
          <p>{trader === "0" ? "개인 소득공제" : "사업자 지출증빙"} · {number}<br />
            {taxType === "exempt" ? "면세" : "과세"} · {won(amount)}<br />이 내용으로 발급하시겠습니까?</p>
        </div>
        <div className="dash-action-dialog-footer">
          <button type="button" autoFocus disabled={pending} className={buttonClass("outline", "sm")} onClick={() => dialog.current?.close()}>취소</button>
          <button type="button" disabled={pending} className={buttonClass("primary", "sm")} onClick={() => void issue()}>{pending ? "발급 중..." : "발급하기"}</button>
        </div>
      </dialog>
    </form>
  );
}
