import {
  paymentMethodLabel,
  paymentStatusLabel,
  paymentStatusTone,
} from "@/app/admin/(protected)/payments/constants";
import { formatDate } from "@/components/portal/format";
import { formatWon } from "@/lib/data/crm";
import type { PortalSession } from "@/lib/portal/auth";
import { listPayerPayments, type PortalPayment } from "@/lib/portal/payments";

// 납부자 역할 뷰 (P-05 납부자 포털 순환) — 읽기 전용.
//
// ⚠️ 이 파일은 이 저장소에서 포털 쪽 금전 데이터를 그리는 유일한 화면이다(검수 17의 반대편).
// 학생 뷰·보호자 뷰는 이 모듈을 import하지 않고, app/p/page.tsx의 역할 분기는 view === "payer"
// 일 때만 이 컴포넌트를 실행한다 — 다른 역할에서는 이 코드가 아예 돌지 않는다.
//
// ⚠️ 학습 상세 비노출(검수 19 · P-05 "학습 공유권한 없음"): 이 모듈에는 리포트·과제·수업기록·
// 성적으로 이어지는 import가 없다. 납부자에게는 학생 이름과 금전 상태만 보인다.
// (학습공유 플래그로 일부를 열어 주는 기능은 후속 과제다 — 지금은 열 수 있는 경로 자체가 없다.)
//
// 읽기 전용의 경계: 결제·환불 "요청"은 이 화면이 처리하지 않는다. 미납분은 이미 발행된
// 결제선생 청구서 링크로 이동할 뿐이고(외부 결제창), 환불 요청은 운영자 흐름(F-01)이다.

const TONE_CLASS: Record<string, string> = {
  brand: "bg-brand-50 text-brand-700",
  soft: "bg-soft text-muted",
  success: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-700",
  danger: "bg-rose-100 text-rose-700",
};

/** 납부·기한 셀 — 완납이면 납부일, 아니면 기한. */
function dueCell(payment: PortalPayment): string {
  if (payment.paidAt) return `납부 ${formatDate(payment.paidAt)}`;
  if (payment.dueDate) return `기한 ${formatDate(payment.dueDate)}`;
  return "-";
}

/** 증빙 셀 — 수납 승인·현금영수증·환불 승인. 없으면 "-". */
function proofLines(payment: PortalPayment): string[] {
  const lines: string[] = [];
  if (payment.apprNum) {
    lines.push(
      `수납 승인 ${payment.apprNum}${payment.apprAt ? ` · ${formatDate(payment.apprAt)}` : ""}`,
    );
  }
  if (payment.cashReceiptState === "issued") {
    lines.push(
      `현금영수증 ${payment.cashReceiptApprNum ?? ""}${
        payment.cashReceiptIssuedAt
          ? ` · ${formatDate(payment.cashReceiptIssuedAt)}`
          : ""
      }`.trim(),
    );
  } else if (payment.cashReceiptState === "canceled") {
    lines.push("현금영수증 취소됨");
  }
  if (payment.refundedAt || payment.refundApprNum) {
    lines.push(
      `환불${payment.refundedAt ? ` ${formatDate(payment.refundedAt)}` : ""}${
        payment.refundApprNum ? ` · 승인 ${payment.refundApprNum}` : ""
      }`,
    );
    if (payment.refundReason) lines.push(`환불 사유: ${payment.refundReason}`);
  }
  return lines;
}

/**
 * 청구서 링크는 https만 허용한다 — 외부 시스템이 준 값을 그대로 href에 넣지 않는다
 * (javascript: 같은 스킴이 저장되는 경로가 생기면 화면이 그 실행지점이 된다).
 */
function safeBillUrl(url: string | null): string | null {
  return url && url.startsWith("https://") ? url : null;
}

export async function PayerView({
  session,
  studentId,
  studentName,
}: {
  session: PortalSession;
  studentId: string;
  studentName: string;
}) {
  // payer 관계가 없으면 빈 배열 — 다른 역할로는 어떤 행도 돌아오지 않는다(lib/portal/data.ts).
  const payments = await listPayerPayments(session, studentId);

  return (
    <section>
      <h2 className="mb-1 text-lg font-black tracking-tight text-ink">
        청구·수납 내역
      </h2>
      <p className="mb-4 text-xs leading-relaxed text-muted">
        {studentName} 학생의 청구·수납·환불 상태입니다. 금액·상태에 확인이 필요하면
        담당 선생님께 문의해 주세요.
      </p>

      {payments.length === 0 ? (
        <div className="rounded-card border border-line bg-white p-10 text-center">
          <p className="text-sm text-muted">발행된 청구 내역이 없습니다.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-white shadow-card">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-soft">
                <th className="px-4 py-3 text-xs font-extrabold tracking-tight text-muted">
                  기간
                </th>
                <th className="px-4 py-3 text-xs font-extrabold tracking-tight text-muted">
                  금액
                </th>
                <th className="px-4 py-3 text-xs font-extrabold tracking-tight text-muted">
                  결제 방법
                </th>
                <th className="px-4 py-3 text-xs font-extrabold tracking-tight text-muted">
                  상태
                </th>
                <th className="px-4 py-3 text-xs font-extrabold tracking-tight text-muted">
                  납부·기한
                </th>
                <th className="px-4 py-3 text-xs font-extrabold tracking-tight text-muted">
                  증빙
                </th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const proofs = proofLines(p);
                const billUrl = safeBillUrl(p.billUrl);
                const unpaid = p.status === "pending" || p.status === "overdue";
                return (
                  <tr key={p.id} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-3 text-sm font-bold tracking-tight text-ink">
                      {formatDate(p.periodStart)} ~ {formatDate(p.periodEnd)}
                    </td>
                    <td className="px-4 py-3 text-sm font-extrabold tracking-tight text-ink">
                      {formatWon(p.amount)}
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-soft">
                      {paymentMethodLabel(p.method)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${
                          TONE_CLASS[paymentStatusTone(p.status)] ?? TONE_CLASS.soft
                        }`}
                      >
                        {paymentStatusLabel(p.status)}
                      </span>
                      {unpaid && billUrl && (
                        <a
                          href={billUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 block text-[11px] font-extrabold text-brand-700 hover:underline"
                        >
                          청구서 열기
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-soft">
                      {dueCell(p)}
                    </td>
                    <td className="px-4 py-3 text-xs leading-relaxed text-muted">
                      {proofs.length === 0
                        ? "-"
                        : proofs.map((line) => <div key={line}>{line}</div>)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
