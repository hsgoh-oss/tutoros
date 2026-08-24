"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, Input, Select } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button";
import { issueCashReceiptAction } from "./actions";

/**
 * 현금영수증 발급 폼 — 발급 구분(개인 소득공제 "0" | 사업자 지출증빙 "1", 스펙 trader)과
 * 발행 요청 번호(휴대폰/주민번호/사업자번호)를 받아 서버 액션으로 발급한다.
 * 실패는 action-button 관례대로 alert, 성공은 refresh로 서버 상태를 다시 그린다.
 */
export function PayssamCashReceiptForm({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [trader, setTrader] = useState("0");
  const [issuanceNumber, setIssuanceNumber] = useState("");

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!issuanceNumber.trim()) {
          window.alert("발행 요청 번호를 입력해 주세요.");
          return;
        }
        if (!window.confirm("현금영수증을 발급하시겠습니까?")) return;
        setPending(true);
        const result = await issueCashReceiptAction(id, trader, issuanceNumber);
        setPending(false);
        if (result.ok) {
          setIssuanceNumber("");
          router.refresh();
        } else {
          window.alert(result.error ?? "현금영수증 발급에 실패했습니다.");
        }
      }}
    >
      <Field label="발급 구분" required>
        <Select
          value={trader}
          onChange={(e) => setTrader(e.target.value)}
          disabled={pending}
        >
          <option value="0">개인(소득공제)</option>
          <option value="1">사업자(지출증빙)</option>
        </Select>
      </Field>
      <Field
        label="발행 요청 번호"
        required
        hint="휴대폰 번호 / 주민등록번호 / 사업자등록번호 (숫자만 사용됩니다)"
      >
        <Input
          value={issuanceNumber}
          onChange={(e) => setIssuanceNumber(e.target.value)}
          placeholder="01012345678"
          inputMode="numeric"
          disabled={pending}
        />
      </Field>
      <button
        type="submit"
        disabled={pending}
        className={buttonClass("outline", "sm", "w-full")}
      >
        {pending ? "발급 중..." : "현금영수증 발급"}
      </button>
    </form>
  );
}
