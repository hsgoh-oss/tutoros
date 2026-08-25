import { createServiceClient } from "@/lib/supabase/server";
import type { PaymentMethod, PaymentStatus } from "@/lib/types";
import { hasPortalAccess, type PortalSession } from "@/lib/portal/auth";

// 납부자 뷰 금전 조회 — 정본 P-05, 검수 17·19.
//
// 이 모듈이 별도 파일인 이유가 곧 검수 17의 보장 방식이다: "학생 뷰에 금전이 안 보인다"를
// 필터가 아니라 **코드 경로 부재**로 성립시키려면, 금전 쿼리가 학습 조회와 다른 모듈에 있고
// 학생·보호자 뷰가 그 모듈을 import하지 않아야 한다. 같은 파일에 두면 뷰가 이미 그 모듈에
// 의존하게 되어 한 줄만 잘못 추가해도 보장이 깨진다.
//
// import 하는 곳은 app/p/payer-view.tsx 하나여야 한다 — 늘리기 전에 검수 17을 다시 읽을 것.

export interface PortalPayment {
  id: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  method: PaymentMethod;
  /** draft(미발행)는 조회 자체에서 제외되므로 여기 오지 않는다. */
  status: Exclude<PaymentStatus, "draft">;
  dueDate: string | null;
  paidAt: string | null;
  /** 결제선생 청구서 링크 — 미납·연체분 결제 경로(P-05). 없으면 계좌이체 안내 대상. */
  billUrl: string | null;
  /** 수납 승인번호·승인시각 — 영수증 대조용 증빙. */
  apprNum: string | null;
  apprAt: string | null;
  /** 환불 승인번호·시각·사유(F). */
  refundApprNum: string | null;
  refundedAt: string | null;
  refundReason: string | null;
  /** 현금영수증 발행 상태·승인번호(증빙). */
  cashReceiptState: "issued" | "canceled" | null;
  cashReceiptApprNum: string | null;
  cashReceiptIssuedAt: string | null;
}

interface PaymentRow {
  id: string;
  period_start: string;
  period_end: string;
  amount: number;
  method: PaymentMethod;
  status: Exclude<PaymentStatus, "draft">;
  due_date: string | null;
  paid_at: string | null;
  bill_short_url: string | null;
  appr_num: string | null;
  appr_dt: string | null;
  refund_appr_num: string | null;
  refunded_at: string | null;
  refund_reason: string | null;
  cash_receipt_state: "issued" | "canceled" | null;
  cash_receipt_appr_num: string | null;
  cash_receipt_issued_at: string | null;
}

/**
 * 납부자 뷰 청구·수납·환불 내역 — 읽기 전용(P-05).
 *
 * payer 관계가 없으면 빈 배열이다: 학생·보호자 역할로는 이 함수가 어떤 행도 돌려주지 않는다(검수 17).
 * 발행 전 초안(draft)은 제외한다 — 아직 청구가 아니어서 납부자에게 보일 것이 없다.
 * 학습 데이터는 한 줄도 포함하지 않는다(검수 19 — 학습공유 플래그는 후속 과제).
 */
export async function listPayerPayments(
  session: PortalSession,
  studentId: string,
): Promise<PortalPayment[]> {
  if (!hasPortalAccess(session, "payer", studentId)) return [];
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("payments")
    .select(
      "id, period_start, period_end, amount, method, status, due_date, paid_at, bill_short_url, appr_num, appr_dt, refund_appr_num, refunded_at, refund_reason, cash_receipt_state, cash_receipt_appr_num, cash_receipt_issued_at",
    )
    .eq("tenant_id", session.tenantId)
    .eq("student_id", studentId)
    .neq("status", "draft")
    .order("period_start", { ascending: false });
  return ((data ?? []) as PaymentRow[]).map((row) => ({
    id: row.id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    amount: row.amount,
    method: row.method,
    status: row.status,
    dueDate: row.due_date,
    paidAt: row.paid_at,
    billUrl: row.bill_short_url,
    apprNum: row.appr_num,
    apprAt: row.appr_dt,
    refundApprNum: row.refund_appr_num,
    refundedAt: row.refunded_at,
    refundReason: row.refund_reason,
    cashReceiptState: row.cash_receipt_state,
    cashReceiptApprNum: row.cash_receipt_appr_num,
    cashReceiptIssuedAt: row.cash_receipt_issued_at,
  }));
}
