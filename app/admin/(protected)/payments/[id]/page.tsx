import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import {
  formatKDate,
  formatKDateTime,
  formatWon,
  getPayment,
  getStudent,
} from "@/lib/data/crm";
import { createServiceClient } from "@/lib/supabase/server";
import { isPayssamConfigured } from "@/lib/payssam/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/admin/crm/action-button";
import {
  paymentMethodLabel,
  paymentStatusLabel,
  paymentStatusTone,
  payssamApprStateLabel,
  payssamApprStateTone,
  payssamCashTraderLabel,
  PAYSSAM_POINT_PER_SEND,
  type PaymentStatusEx,
} from "../constants";
import {
  cancelCashReceiptAction,
  deletePayment,
  destroyPayssamBillAction,
  markPaid,
  resendPayssamBillAction,
  sendPayssamBillAction,
  sendPayssamBillUrlAction,
  sendPaymentRequestNotice,
  syncPayssamBillAction,
} from "../actions";
import { PayssamRefundButton } from "../payssam-refund-button";
import { PayssamCashReceiptForm } from "../payssam-cash-receipt-form";

/** 00014 결제선생 확장 컬럼 — getPayment(Payment 타입)에 없는 원본 컬럼을 직접 조회한다. */
interface PayssamDetailRow {
  status: string; // 00014에서 'refunded' 추가 — 원본 그대로 받는다
  bill_id: string | null;
  bill_short_url: string | null;
  bill_sent_at: string | null;
  appr_state: string | null;
  appr_num: string | null;
  appr_dt: string | null;
  appr_price: number | null;
  appr_issuer: string | null;
  last_synced_at: string | null;
  refund_appr_num: string | null;
  refunded_at: string | null;
  refund_reason: string | null;
  cash_receipt_state: string | null;
  cash_receipt_appr_num: string | null;
  cash_receipt_trader: string | null;
  cash_receipt_issued_at: string | null;
}

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

  // 결제선생 스냅샷 컬럼 — 테넌트 스코프 유지(정본 테넌트 스코프 규칙).
  const db = createServiceClient();
  let ps: PayssamDetailRow | null = null;
  if (db) {
    const { data } = await db
      .from("payments")
      .select(
        "status, bill_id, bill_short_url, bill_sent_at, appr_state, appr_num, appr_dt, appr_price, appr_issuer, last_synced_at, refund_appr_num, refunded_at, refund_reason, cash_receipt_state, cash_receipt_appr_num, cash_receipt_trader, cash_receipt_issued_at",
      )
      .eq("tenant_id", session.tenantId)
      .eq("id", id)
      .maybeSingle();
    ps = (data as PayssamDetailRow | null) ?? null;
  }

  // 업무 상태 — 00014 'refunded'는 lib/types 유니온보다 넓어 화면 확장 타입으로 판정한다.
  const statusEx = (ps?.status ?? payment.status) as PaymentStatusEx;
  const actionable = statusEx !== "paid" && statusEx !== "refunded";
  const payssamConfigured = isPayssamConfigured();
  const showPayssamCard = payment.method === "payssaem" || Boolean(ps?.bill_id);
  const billActive = ps?.appr_state === "W"; // 발송됨·미결제 — 재발송/파기 가능 구간(검수 42)

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {student?.name ?? "알 수 없음"} 청구
          </h1>
          <p className="mt-1 text-sm text-muted">
            {formatKDate(payment.periodStart)} ~ {formatKDate(payment.periodEnd)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={paymentStatusTone(statusEx)}>
            {paymentStatusLabel(statusEx)}
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <h2 className="mb-4 text-sm font-semibold text-ink-soft">기본 정보</h2>
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
              {statusEx === "refunded" && ps?.refunded_at && (
                <div>
                  <dt className="text-muted">환불일</dt>
                  <dd className="font-bold">{formatKDate(ps.refunded_at)}</dd>
                </div>
              )}
            </dl>
          </Card>

          {showPayssamCard && (
            <Card>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink-soft">결제선생</h2>
                {ps?.bill_id && (
                  <Badge tone={payssamApprStateTone(ps.appr_state)}>
                    {payssamApprStateLabel(ps.appr_state)}
                  </Badge>
                )}
              </div>

              {!ps?.bill_id ? (
                // 미발송 — API 발송 진입점. 수기 완납·비 pending 상태는 발송 금지(검수 39).
                <div className="space-y-3">
                  {!payssamConfigured ? (
                    <p className="text-sm text-muted">
                      결제선생 연동이 설정되지 않았습니다. 환경변수 설정 후 사용할 수 있습니다.
                    </p>
                  ) : statusEx === "pending" ? (
                    <>
                      <p className="text-sm text-muted">
                        학부모 카카오톡으로 결제선생 청구서를 발송합니다 (건당{" "}
                        {PAYSSAM_POINT_PER_SEND}P 차감).
                      </p>
                      <div className="flex flex-wrap items-center gap-4">
                        <ActionButton
                          action={sendPayssamBillAction}
                          id={payment.id}
                          label="카카오톡 청구서 발송"
                          pendingLabel="발송 중..."
                          confirmText={`결제선생 카카오톡 청구서를 발송하시겠습니까?\n쌤포인트 ${PAYSSAM_POINT_PER_SEND}P가 차감됩니다.`}
                        />
                        {/*
                          카카오톡이 막혔을 때(포인트 미충전·계정 미연결 등)의 우회로.
                          청구서는 똑같이 만들어지고 단축 URL만 받아오므로, 운영자가 그 링크를
                          직접 전달하면 결제·콜백·수납은 카카오톡 발송과 동일하게 이어진다.
                        */}
                        <ActionButton
                          action={sendPayssamBillUrlAction}
                          id={payment.id}
                          label="링크만 발급 (카톡 미발송)"
                          pendingLabel="발급 중..."
                          confirmText={"카카오톡을 보내지 않고 청구서 링크만 발급합니다.\n쌤포인트는 차감되지 않으며, 발급된 링크는 직접 전달하셔야 합니다."}
                        />
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted">
                      청구(대기) 상태에서만 청구서를 발송할 수 있습니다.
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <dl className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <dt className="text-muted">청구서 ID</dt>
                      <dd className="font-bold break-all">{ps.bill_id}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">발송일시</dt>
                      <dd className="font-bold">{formatKDateTime(ps.bill_sent_at)}</dd>
                    </div>
                    {ps.bill_short_url && (
                      <div className="col-span-2">
                        <dt className="text-muted">청구서 링크</dt>
                        <dd className="font-bold">
                          <a
                            href={ps.bill_short_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-brand-700 hover:underline break-all"
                          >
                            {ps.bill_short_url}
                          </a>
                        </dd>
                      </div>
                    )}
                    {ps.appr_state === "F" && (
                      <>
                        <div>
                          <dt className="text-muted">승인번호</dt>
                          <dd className="font-bold">{ps.appr_num ?? "-"}</dd>
                        </div>
                        <div>
                          <dt className="text-muted">승인일시</dt>
                          <dd className="font-bold">{formatKDateTime(ps.appr_dt)}</dd>
                        </div>
                        <div>
                          <dt className="text-muted">승인 금액</dt>
                          <dd className="font-bold">
                            {ps.appr_price !== null ? formatWon(ps.appr_price) : "-"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted">카드/은행</dt>
                          <dd className="font-bold">{ps.appr_issuer ?? "-"}</dd>
                        </div>
                      </>
                    )}
                    {statusEx === "refunded" && (
                      <>
                        <div>
                          <dt className="text-muted">환불 승인번호</dt>
                          <dd className="font-bold">{ps.refund_appr_num ?? "-"}</dd>
                        </div>
                        <div>
                          <dt className="text-muted">환불 사유</dt>
                          <dd className="font-bold">{ps.refund_reason ?? "-"}</dd>
                        </div>
                      </>
                    )}
                    <div className="col-span-2">
                      <dt className="text-muted">마지막 동기화</dt>
                      <dd className="font-bold">{formatKDateTime(ps.last_synced_at)}</dd>
                    </div>
                  </dl>

                  <div className="flex flex-wrap items-center gap-4 border-t border-line pt-3">
                    {billActive && (
                      <ActionButton
                        action={resendPayssamBillAction}
                        id={payment.id}
                        label="재발송"
                        pendingLabel="재발송 중..."
                        confirmText={`청구서를 카카오톡으로 재발송하시겠습니까?\n재발송에도 쌤포인트 ${PAYSSAM_POINT_PER_SEND}P가 다시 차감됩니다.`}
                      />
                    )}
                    {billActive && (
                      <ActionButton
                        action={destroyPayssamBillAction}
                        id={payment.id}
                        label="청구서 파기"
                        tone="danger"
                        pendingLabel="파기 중..."
                        confirmText="발송된 청구서를 파기하시겠습니까? 학부모는 더 이상 결제할 수 없습니다."
                      />
                    )}
                    <ActionButton
                      action={syncPayssamBillAction}
                      id={payment.id}
                      label="동기화"
                      pendingLabel="동기화 중..."
                    />
                    {ps.appr_state === "F" && statusEx === "paid" && (
                      <PayssamRefundButton
                        id={payment.id}
                        cashReceiptIssued={ps.cash_receipt_state === "issued"}
                      />
                    )}
                  </div>

                  {/* 현금영수증 — 완납 건 증빙(검수 45 수렴 대상). 발급됨이면 승인번호+취소, 아니면 발급 폼. */}
                  {statusEx === "paid" && (
                    <div className="border-t border-line pt-4">
                      <h3 className="mb-3 text-sm font-semibold text-ink-soft">현금영수증</h3>
                      {ps.cash_receipt_state === "issued" ? (
                        <div className="space-y-3">
                          <dl className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <dt className="text-muted">승인번호</dt>
                              <dd className="font-bold">
                                {ps.cash_receipt_appr_num ?? "-"}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted">발급 구분</dt>
                              <dd className="font-bold">
                                {payssamCashTraderLabel(ps.cash_receipt_trader)}
                              </dd>
                            </div>
                            <div className="col-span-2">
                              <dt className="text-muted">발급일시</dt>
                              <dd className="font-bold">
                                {formatKDateTime(ps.cash_receipt_issued_at)}
                              </dd>
                            </div>
                          </dl>
                          <ActionButton
                            action={cancelCashReceiptAction}
                            id={payment.id}
                            label="현금영수증 발급 취소"
                            tone="danger"
                            pendingLabel="취소 중..."
                            confirmText="현금영수증 발급을 취소하시겠습니까?"
                          />
                        </div>
                      ) : (
                        <>
                          {ps.cash_receipt_state === "canceled" && (
                            <p className="mb-3 text-xs text-muted">
                              이전 발급분은 취소되었습니다. 필요하면 다시 발급할 수 있습니다.
                            </p>
                          )}
                          <PayssamCashReceiptForm id={payment.id} />
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink-soft">처리</h2>
            <div className="flex flex-col items-start gap-3">
              {actionable && (
                <ActionButton
                  action={sendPaymentRequestNotice}
                  id={payment.id}
                  label="청구 안내 발송"
                  pendingLabel="발송 중..."
                  confirmText="학부모에게 청구 안내를 발송하시겠습니까?"
                />
              )}
              {actionable && (
                <ActionButton
                  action={markPaid}
                  id={payment.id}
                  label="완납 처리"
                  confirmText={
                    billActive
                      ? "완납 처리하시겠습니까?\n발송된 결제선생 청구서(미결제)가 남아 있습니다 — 수기 완납 후에는 청구서를 파기해 주세요."
                      : "완납 처리하시겠습니까?"
                  }
                />
              )}
              {actionable && (
                <ActionButton
                  action={deletePayment}
                  id={payment.id}
                  label="청구 삭제"
                  tone="danger"
                  confirmText="이 청구를 삭제하시겠습니까?"
                  redirectTo="/admin/payments"
                />
              )}
              {!actionable && (
                <p className="text-sm text-muted">
                  {statusEx === "refunded"
                    ? "환불 완료된 청구입니다 — 이력 보존을 위해 수정할 수 없습니다."
                    : "완납된 청구입니다."}
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
