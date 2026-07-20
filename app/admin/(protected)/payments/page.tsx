import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import {
  formatKDate,
  formatWon,
  getPaymentSummary,
  hasDb,
  listPayments,
} from "@/lib/data/crm";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { ActionButton } from "@/components/admin/crm/action-button";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import { FilterChips } from "@/components/admin/crm/filter-chips";
import {
  PAYMENT_STATUS_OPTIONS,
  paymentMethodLabel,
  paymentStatusLabel,
  paymentStatusTone,
} from "./constants";
import { markPaid } from "./actions";
import type { PaymentStatus } from "@/lib/types";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; student?: string }>;
}) {
  const { status, student } = await searchParams;
  const session = await getAdminSession();
  const connected = hasDb();
  let payments = session
    ? await listPayments(session.tenantId, {
        status: status as PaymentStatus | undefined,
      })
    : [];
  if (student) payments = payments.filter((p) => p.studentId === student);

  const summary = session
    ? await getPaymentSummary(session.tenantId)
    : { paidThisMonth: 0, overdueTotal: 0, pendingTotal: 0 };

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black tracking-tight">결제 관리</h1>
          <p className="mt-1 text-sm text-muted">
            수강료 청구와 납부 현황을 관리합니다.
          </p>
        </div>
        <Link href="/admin/payments/new" className={buttonClass("primary", "sm")}>
          신규 청구
        </Link>
      </div>

      {!connected && <DbBanner />}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-xs font-bold text-muted">이번 달 완납</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-ink">
            {formatWon(summary.paidThisMonth)}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-muted">미납 합계</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-rose-600">
            {formatWon(summary.overdueTotal)}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-muted">청구 대기</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-amber-600">
            {formatWon(summary.pendingTotal)}
          </p>
        </Card>
      </div>

      <Card className="mb-6">
        <FilterChips
          basePath="/admin/payments"
          paramKey="status"
          current={status}
          options={PAYMENT_STATUS_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
          }))}
        />
      </Card>

      {payments.length === 0 ? (
        <EmptyState
          title="등록된 청구가 없습니다"
          description="신규 청구 버튼으로 수강료 청구를 생성할 수 있습니다."
          action={
            <Link href="/admin/payments/new" className={buttonClass("outline", "sm")}>
              신규 청구
            </Link>
          }
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>학생</Th>
                <Th>기간</Th>
                <Th>금액</Th>
                <Th>수단</Th>
                <Th>납기일</Th>
                <Th>상태</Th>
                <Th>처리</Th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <Link
                      href={`/admin/payments/${p.id}`}
                      className="font-bold text-ink hover:text-brand-600"
                    >
                      {p.studentName}
                    </Link>
                  </Td>
                  <Td>
                    {formatKDate(p.periodStart)} ~ {formatKDate(p.periodEnd)}
                  </Td>
                  <Td>{formatWon(p.amount)}</Td>
                  <Td>{paymentMethodLabel(p.method)}</Td>
                  <Td>{formatKDate(p.dueDate)}</Td>
                  <Td>
                    <Badge tone={paymentStatusTone(p.status)}>
                      {paymentStatusLabel(p.status)}
                    </Badge>
                  </Td>
                  <Td>
                    {p.status !== "paid" && (
                      <ActionButton
                        action={markPaid}
                        id={p.id}
                        label="완납 처리"
                        confirmText="완납 처리하시겠습니까?"
                      />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
