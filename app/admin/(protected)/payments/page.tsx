import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import {
  formatKDate,
  formatWon,
  getPaymentSummary,
  hasDb,
  listPayments,
  listStudentOptions,
} from "@/lib/data/crm";
import { createServiceClient } from "@/lib/supabase/server";
import {
  isPayssamConfigured,
  readMerchantRemainPoint,
  readRemainPoint,
} from "@/lib/payssam/client";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Select } from "@/components/ui/form";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { ActionButton } from "@/components/admin/crm/action-button";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import { FilterChips } from "@/components/admin/crm/filter-chips";
import { Toolbar } from "@/components/admin/crm/toolbar";
import {
  PAYMENT_STATUS_OPTIONS,
  PAYSSAM_POINT_PER_SEND,
  PAYSSAM_POINT_WARN_THRESHOLD,
  paymentMethodLabel,
  paymentStatusLabel,
  paymentStatusTone,
  payssamApprStateLabel,
  payssamApprStateTone,
  type PaymentStatusEx,
} from "./constants";
import { createNextCycle, markPaid } from "./actions";
import type { PaymentStatus } from "@/lib/types";

/** 결제선생 발송 상태 최소 컬럼 — 목록 뱃지용(00014 확장 컬럼은 crm.ts Payment 매핑에 없다). */
interface PayssamListRow {
  id: string;
  bill_id: string | null;
  appr_state: string | null;
}

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

  const studentOptions = session ? await listStudentOptions(session.tenantId) : [];

  // 결제선생 발송 스냅샷(bill_id·appr_state) — 테넌트 스코프 조회 후 id 맵으로 결합.
  const payssamById = new Map<string, PayssamListRow>();
  if (session && connected) {
    const db = createServiceClient();
    if (db) {
      const { data } = await db
        .from("payments")
        .select("id, bill_id, appr_state")
        .eq("tenant_id", session.tenantId);
      for (const row of (data ?? []) as PayssamListRow[]) {
        payssamById.set(row.id, row);
      }
    }
  }

  // 쌤포인트 잔액 — 연동 설정 시에만 조회, 실패하면 카드 미표시(검수 38 잔액 소진 대비 안내).
  //
  // 둘을 함께 본다. /read/remain_count는 apiKey만 보내 **파트너 관리 사업장** 잔액을 주고,
  // /read/merchant/remain_count는 member·merchant까지 보내 **하위사업장** 잔액을 준다.
  // 실제로 차감되는 쪽은 파트너제휴 계약 방식에 달렸으므로(파트너 일관 관리 / 사업장 개별 관리),
  // 한쪽만 보여주면 "포인트 충분한데 왜 안 나가지"가 된다 — 실제로 그렇게 헤맸다.
  let payssamBalance: number | null = null;
  let payssamChargeUrl: string | null = null;
  let merchantBalance: number | null = null;
  let merchantChargeUrl: string | null = null;
  if (session && isPayssamConfigured()) {
    const [point, merchantPoint] = await Promise.all([
      readRemainPoint(),
      readMerchantRemainPoint(),
    ]);
    if (point.ok && typeof point.data.balance === "number") {
      payssamBalance = point.data.balance;
      payssamChargeUrl = point.data.chargeUrl ?? null;
    }
    if (merchantPoint.ok && typeof merchantPoint.data.balance === "number") {
      merchantBalance = merchantPoint.data.balance;
      merchantChargeUrl = merchantPoint.data.chargeUrl ?? null;
    }
  }

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">결제 관리</h1>
        </div>
        <Link href="/admin/payments/new" className={buttonClass("primary", "sm")}>
          신규 청구
        </Link>
      </div>

      {!connected && <DbBanner />}

      <div
        className={
          payssamBalance !== null
            ? "mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
            : "mb-6 grid gap-4 sm:grid-cols-3"
        }
      >
        <Card>
          <p className="text-xs font-bold text-muted">이번 달 완납</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-ink">
            {formatWon(summary.paidThisMonth)}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-muted">미납 합계</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-rose-600">
            {formatWon(summary.overdueTotal)}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-muted">청구 대기</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-amber-600">
            {formatWon(summary.pendingTotal)}
          </p>
        </Card>
        {payssamBalance !== null && (
          <Card>
            <p className="text-xs font-bold text-muted">쌤포인트 잔액</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-ink">
              {payssamBalance.toLocaleString("ko-KR")}P
              <span className="ml-1 text-xs font-normal text-muted">파트너</span>
            </p>
            {/*
              실제로 차감되는 쪽은 계약 방식에 달렸다(파트너 일관 관리 / 사업장 개별 관리).
              파트너 잔액만 보고 판단하면, 정작 하위사업장이 0이어서 발송이 막혀도 알 수 없다.
            */}
            <p className="mt-0.5 text-sm font-semibold tracking-tight text-ink">
              {merchantBalance === null
                ? "하위사업장 조회 실패"
                : `${merchantBalance.toLocaleString("ko-KR")}P`}
              <span className="ml-1 text-xs font-normal text-muted">하위사업장</span>
            </p>
            <p className="mt-1 text-xs text-muted">
              청구서 1건당 {PAYSSAM_POINT_PER_SEND}P 차감(재발송 포함). 계약 방식에 따라 둘 중
              한쪽에서 빠집니다.
            </p>
            {merchantBalance !== null && merchantBalance < PAYSSAM_POINT_WARN_THRESHOLD && (
              <p className="mt-1 text-xs font-semibold text-rose-600">
                하위사업장 잔액 부족 — 이 계정에서 차감되는 계약이면 발송이 막힙니다.{" "}
                {merchantChargeUrl && (
                  <a
                    href={merchantChargeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    충전하기
                  </a>
                )}
              </p>
            )}
            {payssamBalance < PAYSSAM_POINT_WARN_THRESHOLD && (
              <p className="mt-1 text-xs font-bold text-rose-600">
                잔액 부족 — 발송 가능 건수가 100건 미만입니다.{" "}
                {payssamChargeUrl && (
                  <a
                    href={payssamChargeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    충전하기
                  </a>
                )}
              </p>
            )}
          </Card>
        )}
      </div>

      {studentOptions.length > 0 && (
        <Card className="mb-6">
          <h2 className="text-sm font-semibold text-ink-soft">4주 청구 사이클 생성</h2>
          <p className="mt-1 mb-3 text-sm text-muted">
            선택한 학생의 직전 청구를 이어 다음 4주 청구를 생성합니다(금액·수단 승계, 발송은 수동).
          </p>
          <SubmitForm action={createNextCycle} submitLabel="다음 4주 청구 생성">
            <Field label="학생">
              <Select name="studentId" required defaultValue="">
                <option value="">학생 선택</option>
                {studentOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </SubmitForm>
        </Card>
      )}

      <Toolbar>
        <FilterChips
          basePath="/admin/payments"
          paramKey="status"
          current={status}
          options={PAYMENT_STATUS_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
          }))}
        />
      </Toolbar>

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
                <Th>결제선생</Th>
                <Th>처리</Th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                // 00014 'refunded'는 lib/types 유니온보다 넓다 — 화면 확장 타입으로 판정.
                const statusEx = p.status as PaymentStatusEx;
                const bill = payssamById.get(p.id);
                return (
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
                      <Badge tone={paymentStatusTone(statusEx)}>
                        {paymentStatusLabel(statusEx)}
                      </Badge>
                    </Td>
                    <Td>
                      {bill?.bill_id ? (
                        <Badge tone={payssamApprStateTone(bill.appr_state)}>
                          {payssamApprStateLabel(bill.appr_state)}
                        </Badge>
                      ) : p.method === "payssaem" ? (
                        <span className="text-xs text-muted">미발송</span>
                      ) : (
                        <span className="text-xs text-muted">-</span>
                      )}
                    </Td>
                    <Td>
                      {statusEx !== "paid" && statusEx !== "refunded" && (
                        <ActionButton
                          action={markPaid}
                          id={p.id}
                          label="완납 처리"
                          confirmText="완납 처리하시겠습니까?"
                        />
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
