import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { formatKDate, formatWon, getPayment, getStudent } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/admin/crm/action-button";
import {
  paymentMethodLabel,
  paymentStatusLabel,
  paymentStatusTone,
} from "../constants";
import {
  deletePayment,
  issueTossLink,
  markPaid,
  sendPaymentRequestNotice,
} from "../actions";

export default async function PaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAdminSession();
  if (!session) notFound();

  const payment = await getPayment(session.tenantId, id);
  if (!payment) notFound();

  const student = await getStudent(session.tenantId, payment.studentId);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black tracking-tight">
            {student?.name ?? "알 수 없음"} 청구
          </h1>
          <p className="mt-1 text-sm text-muted">
            {formatKDate(payment.periodStart)} ~ {formatKDate(payment.periodEnd)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={paymentStatusTone(payment.status)}>
            {paymentStatusLabel(payment.status)}
          </Badge>
          {payment.method === "toss" && payment.status !== "paid" && (
            <ActionButton
              action={issueTossLink}
              id={payment.id}
              label={payment.payUrl ? "토스 결제 링크 재발급" : "토스 결제 링크 발급"}
              pendingLabel="발급 중..."
              confirmText={
                payment.payUrl ? "기존 링크를 새로 발급하시겠습니까?" : undefined
              }
              className="rounded-full border border-line bg-soft px-4 py-2 text-xs font-bold text-brand-700 hover:bg-line/40"
            />
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <h2 className="mb-4 text-sm font-black text-ink-soft">기본 정보</h2>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-muted">학생</dt>
                <dd className="font-bold">
                  {student ? (
                    <Link
                      href={`/admin/students/${student.id}`}
                      className="text-brand-700 hover:underline"
                    >
                      {student.name}
                    </Link>
                  ) : (
                    "알 수 없음"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted">금액</dt>
                <dd className="font-bold">{formatWon(payment.amount)}</dd>
              </div>
              <div>
                <dt className="text-muted">청구 수단</dt>
                <dd className="font-bold">{paymentMethodLabel(payment.method)}</dd>
              </div>
              <div>
                <dt className="text-muted">납기일</dt>
                <dd className="font-bold">{formatKDate(payment.dueDate)}</dd>
              </div>
              <div>
                <dt className="text-muted">청구 기간</dt>
                <dd className="font-bold">
                  {formatKDate(payment.periodStart)} ~ {formatKDate(payment.periodEnd)}
                </dd>
              </div>
              {payment.paidAt && (
                <div>
                  <dt className="text-muted">완납일</dt>
                  <dd className="font-bold">{formatKDate(payment.paidAt)}</dd>
                </div>
              )}
            </dl>
            {payment.payUrl && (
              <div className="mt-4 rounded-panel bg-soft p-4 text-sm">
                <a
                  href={payment.payUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold text-brand-700 hover:underline"
                >
                  결제 링크 열기 →
                </a>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 text-sm font-black text-ink-soft">처리</h2>
            <div className="flex flex-col items-start gap-3">
              {payment.status !== "paid" && (
                <ActionButton
                  action={sendPaymentRequestNotice}
                  id={payment.id}
                  label="청구 안내 발송"
                  pendingLabel="발송 중..."
                  confirmText="학부모에게 청구 안내를 발송하시겠습니까?"
                />
              )}
              {payment.status !== "paid" && (
                <ActionButton
                  action={markPaid}
                  id={payment.id}
                  label="완납 처리"
                  confirmText="완납 처리하시겠습니까?"
                />
              )}
              {payment.status !== "paid" && (
                <ActionButton
                  action={deletePayment}
                  id={payment.id}
                  label="청구 삭제"
                  tone="danger"
                  confirmText="이 청구를 삭제하시겠습니까?"
                  redirectTo="/admin/payments"
                />
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
