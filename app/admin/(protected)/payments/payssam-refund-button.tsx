"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { refundPayssamBillAction } from "./actions";

/**
 * 결제선생 전액 환불 버튼 — action-button 관례(확인→실행→실패 alert)에 사유 입력(window.prompt)을 더한 변형.
 * 현금영수증이 발급된 건이면 환불 전 발급 취소 선행을 경고한다(강제 차단은 하지 않음 — 검수 45
 * 수렴은 동기화·업무 큐 사후 대조로 보강).
 */
export function PayssamRefundButton({
  id,
  cashReceiptIssued,
}: {
  id: string;
  cashReceiptIssued: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        if (cashReceiptIssued) {
          const proceed = window.confirm(
            "이 결제에는 발급된 현금영수증이 있습니다.\n환불 전 현금영수증 발급 취소를 먼저 진행하는 것을 권장합니다.\n그래도 환불을 진행하시겠습니까?",
          );
          if (!proceed) return;
        }
        const reason = window.prompt("환불 사유를 입력해 주세요 (필수)");
        if (reason === null) return; // 입력 취소 — 실행하지 않음
        if (!reason.trim()) {
          window.alert("환불 사유를 입력해야 환불할 수 있습니다.");
          return;
        }
        if (!window.confirm("전액 환불(승인 취소)을 진행하시겠습니까? 되돌릴 수 없습니다.")) return;
        setPending(true);
        const result = await refundPayssamBillAction(id, reason);
        setPending(false);
        if (result.ok) {
          router.refresh();
        } else {
          window.alert(result.error ?? "환불 처리에 실패했습니다.");
        }
      }}
      className="text-xs font-bold text-rose-600 hover:underline disabled:opacity-50"
    >
      {pending ? "환불 처리 중..." : "전액 환불"}
    </button>
  );
}
