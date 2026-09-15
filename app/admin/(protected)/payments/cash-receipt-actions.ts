"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { runCritical } from "@/lib/data/activity";
import { createWorkItem } from "@/lib/data/work";
import { getPayssamAccount } from "@/lib/payssam/account";
import { cancelCashReceipt, generateBillId, isPayssamConfigured, issueCashReceipt, readCashReceipt } from "@/lib/payssam/client";
import { cashReceiptAmounts, cashReceiptDate, parseCashReceiptHistory, validateCashReceiptInput } from "@/lib/payssam/cash-receipt";
import type { CrmActionResult } from "@/components/admin/crm/types";

type Db = NonNullable<ReturnType<typeof createServiceClient>>;
type Operation = "issue" | "cancel" | "sync";
interface ReceiptPayment {
  id: string;
  amount: number;
  method: string;
  status: string;
  bill_id: string | null;
  cash_receipt_bill_id: string | null;
  cash_receipt_state: "issued" | "canceled" | null;
  cash_receipt_appr_num: string | null;
  cash_receipt_trader: string | null;
  cash_receipt_operation: Operation | null;
  cash_receipt_operation_id: string | null;
  cash_receipt_operation_started_at: string | null;
}

const SELECT = "id, amount, method, status, bill_id, cash_receipt_bill_id, cash_receipt_state, cash_receipt_appr_num, cash_receipt_trader, cash_receipt_operation, cash_receipt_operation_id, cash_receipt_operation_started_at";
const CLEAR_OPERATION = { cash_receipt_operation: null, cash_receipt_operation_id: null, cash_receipt_operation_started_at: null };
const BUSY = "현금영수증 처리 중이거나 결과 확인이 필요합니다. 1분 후 ‘결제선생과 대조’를 눌러 주세요.";

async function context(id: string) {
  const session = await getAdminSession();
  if (!session) return { ok: false as const, error: "인증이 필요합니다." };
  const db = createServiceClient();
  if (!db) return { ok: false as const, error: "DB 연결 후 사용할 수 있습니다." };
  const { data, error } = await db.from("payments").select(SELECT)
    .eq("tenant_id", session.tenantId).eq("id", id).maybeSingle();
  if (error || !data) return { ok: false as const, error: "청구 정보를 불러올 수 없습니다. 현금영수증 DB 설정을 확인해 주세요." };
  const account = await getPayssamAccount(session.tenantId);
  if (!account || !isPayssamConfigured(account)) return { ok: false as const, error: "결제선생 사업장 연동이 설정되지 않았습니다." };
  const payment = data as ReceiptPayment;
  if (!Number.isSafeInteger(payment.amount) || payment.amount <= 0) return { ok: false as const, error: "청구 금액을 확인해 주세요." };
  return { ok: true as const, session, db, account, payment };
}

/** 처리권은 DB 조건부 UPDATE로 한 요청만 획득한다. 타임아웃은 발급/취소 재시도가 아닌 조회로 복구한다. */
async function claim(db: Db, tenantId: string, payment: ReceiptPayment, operation: Operation, billId: string) {
  if (payment.cash_receipt_operation && (operation !== "sync"
    || Date.now() - Date.parse(payment.cash_receipt_operation_started_at ?? "") < 60_000)) return null;
  const token = randomUUID();
  let query = db.from("payments").update({
    cash_receipt_bill_id: billId,
    cash_receipt_operation: operation,
    cash_receipt_operation_id: token,
    cash_receipt_operation_started_at: new Date().toISOString(),
  }).eq("tenant_id", tenantId).eq("id", payment.id).eq("amount", payment.amount).eq("status", payment.status);
  query = payment.cash_receipt_operation_id
    ? query.eq("cash_receipt_operation_id", payment.cash_receipt_operation_id)
    : query.is("cash_receipt_operation_id", null);
  query = payment.cash_receipt_state
    ? query.eq("cash_receipt_state", payment.cash_receipt_state)
    : query.is("cash_receipt_state", null);
  const { data, error } = await query.select("id").maybeSingle();
  return !error && data ? token : null;
}

async function finish(db: Db, tenantId: string, id: string, token: string, patch: Record<string, unknown> = {}) {
  const { data, error } = await db.from("payments").update({ ...patch, ...CLEAR_OPERATION })
    .eq("tenant_id", tenantId).eq("id", id).eq("cash_receipt_operation_id", token).select("id").maybeSingle();
  return !error && Boolean(data);
}

async function review(tenantId: string, id: string, billId: string, detail: string) {
  await createWorkItem(tenantId, {
    kind: "payssam_unknown_result", sourceType: "payment", sourceId: id,
    title: "현금영수증 처리 결과 확인", detail: `${detail} · 거래 ID ${billId}`,
    nextAction: "청구 상세에서 ‘결제선생과 대조’로 발급·취소 결과를 확인하세요. 확인 전에는 재발급하지 마세요.",
    priority: "money",
  });
}

function refresh(id: string) {
  revalidatePath("/admin/payments");
  revalidatePath(`/admin/payments/${id}`);
  revalidatePath("/p");
}

export async function issueCashReceiptAction(id: string, trader: string, number: string, taxType: string): Promise<CrmActionResult> {
  const input = validateCashReceiptInput(trader, number, taxType);
  if (!input.ok) return input;
  const ctx = await context(id);
  if (!ctx.ok) return ctx;
  const { session, db, account, payment } = ctx;
  if (payment.status !== "paid" || payment.method !== "bank") return { ok: false, error: "입금 확인 후 완납 처리한 계좌이체 청구에서 발급할 수 있습니다." };
  if (payment.cash_receipt_state === "issued") return { ok: false, error: "이미 발급되었습니다. 정정하려면 취소 후 재발급해 주세요." };
  if (payment.cash_receipt_operation) return { ok: false, error: BUSY };
  // 취소 후 재발급도 이미 사용한 billId는 BILL_001로 거절된다. 미확정 요청의 ID는 유지하되,
  // 취소가 확인된 새 발급은 새 ID를 쓰고 이전 ID·승인번호를 감사 이력에 보존한다.
  const billId = payment.cash_receipt_state === "canceled" ? generateBillId() : payment.cash_receipt_bill_id ?? generateBillId();
  const amounts = cashReceiptAmounts(payment.amount, input.taxType);
  const result = await runCritical({
    tenantId: session.tenantId, actorEmail: session.email, action: "payssam_cash_receipt_issue",
    targetType: "payment", targetId: id, category: "money", summary: `현금영수증 발급: ${payment.amount}원`,
    before: { cash_receipt_bill_id: payment.cash_receipt_bill_id, state: payment.cash_receipt_state, approval: payment.cash_receipt_appr_num },
    after: { cash_receipt_bill_id: billId, trader: input.trader, tax_type: input.taxType, ...amounts },
  }, async (): Promise<CrmActionResult> => {
    const token = await claim(db, session.tenantId, payment, "issue", billId);
    if (!token) return { ok: false, error: BUSY };
    // 이전 영수증이 있으면 새 발급 전에 실제 취소 상태를 확인한다.
    if (payment.cash_receipt_bill_id) {
      const read = await readCashReceipt(payment.cash_receipt_bill_id, payment.amount, account);
      const history = read.ok ? parseCashReceiptHistory(read.data, payment.cash_receipt_bill_id, payment.amount) : null;
      if (!read.ok || !history?.ok || history.latest?.apprState === "F"
        || (payment.cash_receipt_state === "canceled" && history.latest?.apprState !== "C")) {
        await finish(db, session.tenantId, id, token, { cash_receipt_bill_id: payment.cash_receipt_bill_id });
        return { ok: false, error: "기존 영수증 상태를 먼저 확인해야 합니다. ‘결제선생과 대조’를 눌러 주세요." };
      }
    }
    const issued = await issueCashReceipt({ billId, price: payment.amount, ...amounts, trader: input.trader, issuanceNumber: input.number }, account);
    if (!issued.ok) {
      if (issued.code !== "NETWORK") {
        await finish(db, session.tenantId, id, token, { cash_receipt_bill_id: payment.cash_receipt_bill_id });
        return { ok: false, error: `현금영수증 발급이 거절되었습니다: ${issued.error}` };
      }
      await review(session.tenantId, id, billId, "발급 응답을 받지 못했습니다.");
      return { ok: false, error: "발급 결과 확인이 필요합니다. 재발급하지 말고 1분 후 ‘결제선생과 대조’를 눌러 주세요." };
    }
    if (issued.data.billId !== billId || !issued.data.apprCashNum?.trim() || issued.data.trader !== input.trader) {
      await review(session.tenantId, id, billId, "발급 응답의 승인 정보를 확인할 수 없습니다.");
      return { ok: false, error: "승인 정보를 확인하지 못했습니다. ‘결제선생과 대조’로 확인해 주세요." };
    }
    const saved = await finish(db, session.tenantId, id, token, {
      cash_receipt_state: "issued", cash_receipt_appr_num: issued.data.apprCashNum,
      cash_receipt_trader: input.trader, cash_receipt_issued_at: new Date().toISOString(),
    });
    if (!saved) {
      await review(session.tenantId, id, billId, "발급은 성공했지만 내부 저장에 실패했습니다.");
      return { ok: false, error: "발급은 됐지만 저장하지 못했습니다. ‘결제선생과 대조’로 확인해 주세요." };
    }
    return { ok: true };
  });
  refresh(id);
  return result;
}

export async function cancelCashReceiptAction(id: string): Promise<CrmActionResult> {
  const ctx = await context(id);
  if (!ctx.ok) return ctx;
  const { session, db, account, payment } = ctx;
  const billId = payment.cash_receipt_bill_id ?? payment.bill_id;
  const trader = payment.cash_receipt_trader;
  if (!billId || payment.cash_receipt_state !== "issued" || (trader !== "0" && trader !== "1")) return { ok: false, error: "취소할 영수증의 승인번호·발급 구분을 먼저 대조해 주세요." };
  if (payment.cash_receipt_operation) return { ok: false, error: BUSY };
  const result = await runCritical({
    tenantId: session.tenantId, actorEmail: session.email, action: "payssam_cash_receipt_cancel",
    targetType: "payment", targetId: id, category: "money", summary: `현금영수증 취소: ${payment.amount}원`,
    before: { state: payment.cash_receipt_state, approval: payment.cash_receipt_appr_num },
  }, async (): Promise<CrmActionResult> => {
    const token = await claim(db, session.tenantId, payment, "cancel", billId);
    if (!token) return { ok: false, error: BUSY };
    const canceled = await cancelCashReceipt({ billId, price: payment.amount, trader }, account);
    if (!canceled.ok) {
      if (canceled.code !== "NETWORK") {
        await finish(db, session.tenantId, id, token);
        return { ok: false, error: `취소가 거절되었습니다: ${canceled.error}` };
      }
      await review(session.tenantId, id, billId, "취소 응답을 받지 못했습니다.");
      return { ok: false, error: "취소 결과 확인이 필요합니다. 1분 후 ‘결제선생과 대조’를 눌러 주세요." };
    }
    if (canceled.data.billId !== billId || !canceled.data.apprCashNum?.trim()) {
      await review(session.tenantId, id, billId, "취소 응답의 승인 정보를 확인할 수 없습니다.");
      return { ok: false, error: "취소 승인 정보를 확인하지 못했습니다. ‘결제선생과 대조’로 확인해 주세요." };
    }
    // 원 발급번호는 보존한다. 취소 영수증은 발급 취소일/번호로 가장하지 않는다.
    const saved = await finish(db, session.tenantId, id, token, { cash_receipt_state: "canceled" });
    if (!saved) {
      await review(session.tenantId, id, billId, "취소는 성공했지만 내부 저장에 실패했습니다.");
      return { ok: false, error: "취소는 됐지만 저장하지 못했습니다. ‘결제선생과 대조’로 확인해 주세요." };
    }
    return { ok: true };
  });
  refresh(id);
  return result;
}

export async function syncCashReceiptAction(id: string): Promise<CrmActionResult> {
  const ctx = await context(id);
  if (!ctx.ok) return ctx;
  const { session, db, account, payment } = ctx;
  const billId = payment.cash_receipt_bill_id ?? payment.bill_id;
  if (!billId) return { ok: false, error: "아직 현금영수증 발급 이력이 없습니다." };
  const result = await runCritical({
    tenantId: session.tenantId, actorEmail: session.email, action: "payssam_cash_receipt_sync",
    targetType: "payment", targetId: id, category: "money", summary: "결제선생 현금영수증 대조",
    before: { state: payment.cash_receipt_state, approval: payment.cash_receipt_appr_num },
  }, async (): Promise<CrmActionResult> => {
    const token = await claim(db, session.tenantId, payment, "sync", billId);
    if (!token) return { ok: false, error: BUSY };
    // 조회 실패 시 이전 미확정 발급/취소 처리를 보존한다.
    const restore = async () => {
      if (!payment.cash_receipt_operation) return finish(db, session.tenantId, id, token);
      const { error } = await db.from("payments").update({
        cash_receipt_operation: payment.cash_receipt_operation,
        cash_receipt_operation_id: payment.cash_receipt_operation_id,
        cash_receipt_operation_started_at: payment.cash_receipt_operation_started_at,
      }).eq("tenant_id", session.tenantId).eq("id", id).eq("cash_receipt_operation_id", token);
      return !error;
    };
    const read = await readCashReceipt(billId, payment.amount, account);
    const history = read.ok ? parseCashReceiptHistory(read.data, billId, payment.amount) : null;
    if (!read.ok || !history?.ok) {
      await restore();
      return { ok: false, error: !read.ok ? `조회에 실패했습니다: ${read.error}` : history && !history.ok ? history.error : "영수증 이력을 확인할 수 없습니다." };
    }
    const latest = history.latest;
    const state = latest?.apprState === "F" ? "issued" : latest?.apprState === "C" ? "canceled" : null;
    const expected = payment.cash_receipt_operation === "issue" ? "issued" : payment.cash_receipt_operation === "cancel" ? "canceled" : null;
    const staleResult = expected && latest && payment.cash_receipt_operation_started_at
      && Date.parse(cashReceiptDate(latest.apprDt!)!) < Math.floor(Date.parse(payment.cash_receipt_operation_started_at) / 1000) * 1000;
    if ((!latest && payment.cash_receipt_state) || (expected && state !== expected) || staleResult) {
      await restore();
      await review(session.tenantId, id, billId, "이전 요청의 처리 결과가 조회 이력에서 확인되지 않습니다.");
      return { ok: false, error: "이전 요청의 결과를 확정할 수 없습니다. 결제선생에서 발급·취소 이력을 확인해 주세요." };
    }
    const patch: Record<string, unknown> = { cash_receipt_state: state };
    if (latest) {
      patch.cash_receipt_trader = latest.trader;
      if (state === "issued") {
        patch.cash_receipt_appr_num = latest.apprNum;
        patch.cash_receipt_issued_at = cashReceiptDate(latest.apprDt!);
      }
    }
    // 주민번호/휴대폰·API 키를 포함한 원문 대신 승인 대조에 필요한 값만 보관한다.
    const { error: eventError } = await db.from("payssam_events").insert({
      tenant_id: session.tenantId, payment_id: id, bill_id: billId, event_type: "sync",
      appr_state: latest?.apprState ?? null, appr_num: latest?.apprNum ?? null, appr_price: payment.amount,
      payload: { type: "cash_receipt", state, approval: latest?.apprNum ?? null, trader: latest?.trader ?? null, approvedAt: latest?.apprDt ?? null },
      outcome: "duplicate", note: "현금영수증 승인 정보 대조",
    });
    if (eventError) {
      await restore();
      return { ok: false, error: "대조 이력을 저장하지 못했습니다. 다시 시도해 주세요." };
    }
    if (!await finish(db, session.tenantId, id, token, patch)) return { ok: false, error: "대조 결과를 저장하지 못했습니다. 다시 시도해 주세요." };
    return { ok: true };
  });
  refresh(id);
  return result;
}
