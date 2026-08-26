"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { formatKDate, formatWon } from "@/lib/data/crm";
import { getSiteContent } from "@/lib/data/content";
import { runCritical } from "@/lib/data/activity";
import { createWorkItem } from "@/lib/data/work";
import { sendNotification } from "@/lib/notify/send";
import { renderTemplate } from "@/lib/notify/templates";
import {
  cancelBill,
  cancelCashReceipt,
  destroyBill,
  generateBillId,
  issueCashReceipt,
  readBill,
  resendBill,
  sendBill,
} from "@/lib/payssam/client";
import type { PayssamCashTrader } from "@/lib/payssam/types";
import type { PaymentMethod } from "@/lib/types";
import type { CrmActionResult } from "@/components/admin/crm/types";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";
const VALID_METHODS: PaymentMethod[] = ["payssaem", "bank"];

interface PaymentWithStudentRow {
  id: string;
  amount: number;
  method: PaymentMethod;
  student_id: string;
  students: { parent_phone: string; name: string } | null;
}

function revalidatePayment(id: string) {
  revalidatePath("/admin/payments");
  revalidatePath(`/admin/payments/${id}`);
}

/** date-only 문자열(YYYY-MM-DD)에 일수를 더한다 — UTC 자정 고정으로 타임존 드리프트 방지. */
function addDaysToDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function createPayment(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const studentId = String(formData.get("studentId") ?? "");
  const periodStart = String(formData.get("periodStart") ?? "");
  const periodEnd = String(formData.get("periodEnd") ?? "");
  const amountRaw = String(formData.get("amount") ?? "");
  const methodRaw = String(formData.get("method") ?? "");
  const dueDate = String(formData.get("dueDate") ?? "").trim();

  if (!studentId) return { ok: false, error: "학생을 선택해 주세요." };
  if (!periodStart || !periodEnd) {
    return { ok: false, error: "청구 기간을 입력해 주세요." };
  }

  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "금액을 올바르게 입력해 주세요." };
  }

  const method: PaymentMethod = VALID_METHODS.includes(methodRaw as PaymentMethod)
    ? (methodRaw as PaymentMethod)
    : "bank";

  const db = createServiceClient()!;
  // 청구 생성은 금전 전환(money) — 감사 선기록(pending) 없이는 실행하지 않는다(fail-closed).
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "create",
      targetType: "payment",
      targetId: null, // insert 전 선기록이라 새 행 id는 아직 없다 — after_data로 식별.
      summary: `청구 생성: ${formatWon(amount)}`,
      category: "money",
      after: {
        student_id: studentId,
        period_start: periodStart,
        period_end: periodEnd,
        amount,
        method,
        due_date: dueDate || null,
      },
    },
    async () => {
      const { error } = await db.from("payments").insert({
        tenant_id: session.tenantId,
        student_id: studentId,
        period_start: periodStart,
        period_end: periodEnd,
        amount,
        method,
        status: "pending",
        due_date: dueDate || null,
      });
      if (error) {
        console.error("[payments] insert failed", error);
        return { ok: false, error: "청구 생성 중 오류가 발생했습니다." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidatePath("/admin/payments");
  return result;
}

/**
 * 4주 청구 사이클 생성(기획 7-8 "4주 사이클 생성"). 직전 청구의 기간·금액·수단을 이어
 * 다음 4주 청구를 'pending'으로 생성한다. 발송은 기존대로 수동(자동 발송 금지, 기획 7-11).
 */
export async function createNextCycle(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const studentId = String(formData.get("studentId") ?? "");
  if (!studentId) return { ok: false, error: "학생을 선택해 주세요." };

  const db = createServiceClient()!;
  const { data: last, error: fetchError } = await db
    .from("payments")
    .select("period_end, amount, method")
    .eq("tenant_id", session.tenantId)
    .eq("student_id", studentId)
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (fetchError) {
    console.error("[payments] next-cycle fetch failed", fetchError);
    return { ok: false, error: "이전 청구 조회 중 오류가 발생했습니다." };
  }
  if (!last) {
    return {
      ok: false,
      error: "이전 청구가 없습니다. '신규 청구'에서 금액을 입력해 생성해 주세요.",
    };
  }
  const prev = last as { period_end: string; amount: number; method: PaymentMethod };
  const periodStart = addDaysToDate(prev.period_end, 1);
  const periodEnd = addDaysToDate(periodStart, 27); // 4주 정액

  // 청구 생성은 금전 전환(money) — 감사 선기록(pending) 없이는 실행하지 않는다(fail-closed).
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "create",
      targetType: "payment",
      targetId: null, // insert 전 선기록이라 새 행 id는 아직 없다 — after_data로 식별.
      summary: `4주 사이클 청구 생성: ${formatWon(prev.amount)}`,
      category: "money",
      after: {
        student_id: studentId,
        period_start: periodStart,
        period_end: periodEnd,
        amount: prev.amount,
        method: prev.method,
        due_date: periodEnd,
      },
    },
    async () => {
      const { error } = await db.from("payments").insert({
        tenant_id: session.tenantId,
        student_id: studentId,
        period_start: periodStart,
        period_end: periodEnd,
        amount: prev.amount,
        method: prev.method,
        status: "pending",
        due_date: periodEnd,
      });
      if (error) {
        console.error("[payments] next-cycle insert failed", error);
        return { ok: false, error: "다음 청구 생성 중 오류가 발생했습니다." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidatePath("/admin/payments");
  return result;
}

export async function markPaid(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  // 완납 확정 전 행을 before_data로 남기기 위해 먼저 조회한다(감사 선기록에 포함).
  const { data: payment, error: fetchError } = await db
    .from("payments")
    .select("status, amount, student_id, bill_id, appr_state")
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (fetchError || !payment) {
    console.error("[payments] markPaid fetch failed", fetchError);
    return { ok: false, error: "청구 정보를 찾을 수 없습니다." };
  }
  // 환불 완료(00014 refunded)는 paid의 소멸이 아니라 별도 업무 상태 — 재완납 처리 금지(검수 45).
  if ((payment.status as string) === "refunded") {
    return { ok: false, error: "환불 완료된 청구는 다시 완납 처리할 수 없습니다." };
  }
  // 발송된 결제선생 청구서(W)가 살아 있으면 수기 완납 전에 먼저 닫는다 — 카톡의 유효한 청구서로
  // 학부모가 추가 결제하면 이중 수납이 되고, 그 승인 통보는 paid 선검사에 흡수된다(검수 36·39 경계).
  if ((payment as { appr_state?: string | null }).appr_state === "W") {
    return {
      ok: false,
      error: "발송된 결제선생 청구서가 아직 유효합니다. '동기화'로 결제 여부를 확인하거나 파기로 닫은 뒤 수기 완납 처리해 주세요.",
    };
  }

  // 완납 확정은 금전 전환(money) — 감사 선기록(pending) 없이는 실행하지 않는다(fail-closed).
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "update",
      targetType: "payment",
      targetId: id,
      summary: `완납 처리: ${formatWon(payment.amount)}`,
      category: "money",
      before: { status: payment.status, amount: payment.amount, student_id: payment.student_id },
      after: { status: "paid" },
    },
    async () => {
      const { error } = await db
        .from("payments")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("tenant_id", session.tenantId)
        .eq("id", id);
      if (error) {
        console.error("[payments] markPaid failed", error);
        return { ok: false, error: "완납 처리 중 오류가 발생했습니다." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidatePayment(id);
  return result;
}

/** 청구 안내 알림 발송 — 선생님이 수동으로 클릭할 때만 발송(자동 발송 금지, 기획 고정).
 *  무통장입금·결제선생 모두 수동 완납이므로 링크 없이 안내 문구만 발송한다. */
export async function sendPaymentRequestNotice(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const { data, error: fetchError } = await db
    .from("payments")
    .select("id, amount, method, student_id, students(parent_phone, name)")
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (fetchError || !data) {
    return { ok: false, error: "청구 정보를 찾을 수 없습니다." };
  }
  // students는 to-one 관계지만 Database 제네릭 없이는 supabase-js가 배열로 추론한다 — 실제 응답은 단일 객체.
  const payment = data as unknown as PaymentWithStudentRow;
  if (!payment.students?.parent_phone) {
    return { ok: false, error: "학부모 연락처를 확인할 수 없습니다." };
  }
  const parentPhone = payment.students.parent_phone;

  let message = renderTemplate("payment_request", {
    name: payment.students.name,
    amount: formatWon(payment.amount),
  });
  // 계좌이체 청구는 설정된 입금 계좌 안내(site_settings.bankAccount)를 함께 발송한다(기획 7-11 "계좌 안내 표시").
  if (payment.method === "bank") {
    const { settings } = await getSiteContent(session.tenantId);
    if (settings.bankAccount) {
      message += `\n입금 계좌: ${settings.bankAccount}`;
    }
  }

  // 청구 안내 발송은 금전 전환의 일부(money) — 발송 시도·결과를 감사에 남긴다(fail-closed).
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "notify",
      targetType: "payment",
      targetId: id,
      summary: `청구 안내 발송: ${formatWon(payment.amount)}`,
      category: "money",
      after: {
        student_id: payment.student_id,
        amount: payment.amount,
        method: payment.method,
      },
    },
    async () => {
      const sent = await sendNotification({
        tenantId: session.tenantId,
        studentId: payment.student_id,
        type: "payment_request",
        phone: parentPhone,
        message,
        isAd: false,
      });
      if (!sent.ok) {
        if (sent.skipped) {
          // 다른 워커가 같은 알림을 발송 중 — 실패로 기록하지 않고 안내만 한다.
          return { ok: false, error: "이미 발송이 진행 중입니다 — 잠시 후 다시 확인해 주세요." };
        }
        return { ok: false, error: sent.error ?? "알림 발송에 실패했습니다." };
      }
      return { ok: true };
    },
  );
  return result;
}

export async function deletePayment(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  // 삭제 전 행을 before_data로 남기기 위해 먼저 조회한다(감사 선기록에 포함).
  const { data: payment, error: fetchError } = await db
    .from("payments")
    .select("status, amount, student_id, bill_id, appr_state")
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (fetchError || !payment) {
    console.error("[payments] delete fetch failed", fetchError);
    return { ok: false, error: "청구 정보를 찾을 수 없습니다." };
  }
  if (payment.status === "paid") {
    return { ok: false, error: "완납된 청구는 삭제할 수 없습니다." };
  }
  // 환불 이력이 있는 청구는 증빙·원장 추적을 위해 행을 보존한다(검수 45 수렴 근거).
  if ((payment.status as string) === "refunded") {
    return { ok: false, error: "환불된 청구는 삭제할 수 없습니다(이력 보존)." };
  }
  // 결제선생 청구서가 살아 있는(W) 행을 지우면 학부모에게 유령 청구서만 남는다 — 파기 먼저(검수 42 취지).
  if (payment.bill_id && payment.appr_state === "W") {
    return {
      ok: false,
      error: "발송된 결제선생 청구서가 있습니다. 먼저 청구서를 파기한 뒤 삭제해 주세요.",
    };
  }

  // 청구 삭제는 금전 전환(money) — 감사 선기록(pending) 없이는 실행하지 않는다(fail-closed).
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "delete",
      targetType: "payment",
      targetId: id,
      summary: `청구 삭제: ${formatWon(payment.amount)}`,
      category: "money",
      before: { status: payment.status, amount: payment.amount, student_id: payment.student_id },
    },
    async () => {
      const { error } = await db
        .from("payments")
        .delete()
        .eq("tenant_id", session.tenantId)
        .eq("id", id);
      if (error) {
        console.error("[payments] delete failed", error);
        return { ok: false, error: "청구 삭제 중 오류가 발생했습니다." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidatePath("/admin/payments");
  return result;
}

/* ======================= 결제선생(Payssam) API 연동 액션 =======================
 * 정본(flow-canon) 준수 사항:
 *  - 업무 상태(payments.status)와 외부 승인 스냅샷(appr_*)의 분리 — M0 분리 원칙.
 *  - 외부 결과 불명(NETWORK)은 성공이 아니다 — /bill/read 대조 전에는 수납 반영 금지(검수 37·128).
 *  - 중복 통보는 한 결제 — payssam_events applied 부분 유니크(23505)로 멱등(검수 36).
 *  - 수기 발송·완납 청구를 API로 재발송하지 않는다(검수 39).
 *  - 수납된 청구는 파기하지 않는다 — 취소·환불 먼저(검수 42), 환불 후 증빙 수렴(검수 45).
 *  - 금전 전환은 전부 runCritical(category money) fail-closed — begin 실패 시 외부 호출 금지.
 *  - 예외·불일치는 payssam_events 원장 + createWorkItem으로 수렴(정본 ⑧).
 */

type Db = NonNullable<ReturnType<typeof createServiceClient>>;

/** 결제선생 연동에 필요한 payments 행 + 학생 조인 — 00014 확장 컬럼 포함. */
interface PayssamPaymentRow {
  id: string;
  amount: number;
  method: PaymentMethod;
  /** 00014에서 'refunded'가 추가돼 lib/types PaymentStatus보다 넓다 — string으로 받는다. */
  status: string;
  period_start: string;
  period_end: string;
  student_id: string;
  paid_at: string | null;
  bill_id: string | null;
  bill_short_url: string | null;
  appr_state: string | null;
  appr_num: string | null;
  cash_receipt_state: string | null;
  cash_receipt_appr_num: string | null;
  cash_receipt_trader: string | null;
  students: { name: string; parent_phone: string | null } | null;
}

const PAYSSAM_PAYMENT_SELECT =
  "id, amount, method, status, period_start, period_end, student_id, paid_at, " +
  "bill_id, bill_short_url, appr_state, appr_num, cash_receipt_state, cash_receipt_appr_num, " +
  "cash_receipt_trader, students(name, parent_phone)";

async function fetchPayssamPayment(
  db: Db,
  tenantId: string,
  id: string,
): Promise<PayssamPaymentRow | null> {
  const { data, error } = await db
    .from("payments")
    .select(PAYSSAM_PAYMENT_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("[payssam] payment fetch failed", error);
    return null;
  }
  // students는 to-one 관계지만 Database 제네릭 없이는 배열로 추론된다 — 실제 응답은 단일 객체.
  return data as unknown as PayssamPaymentRow;
}

/**
 * 결제선생 승인 일시(apprDt "YYYYMMDDhhmmss", KST) → ISO(UTC) 변환.
 * 형식이 어긋나면 null — 호출부가 now() 등으로 대체한다(외부값 무보증).
 */
function payssamDtToIso(dt: string | null | undefined): string | null {
  if (!dt || !/^\d{14}$/.test(dt)) return null;
  const y = Number(dt.slice(0, 4));
  const mo = Number(dt.slice(4, 6));
  const d = Number(dt.slice(6, 8));
  const h = Number(dt.slice(8, 10));
  const mi = Number(dt.slice(10, 12));
  const s = Number(dt.slice(12, 14));
  const utcMs = Date.UTC(y, mo - 1, d, h, mi, s) - 9 * 3600 * 1000; // KST(UTC+9) → UTC
  const date = new Date(utcMs);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * payssam_events 원장 1행 기록(검수 36 멱등의 근거).
 * outcome='applied'는 부분 유니크에 걸리면 "duplicate"를 반환한다(수납 재반영 금지 신호).
 * 그 외 실패는 "error" — applied 원장을 못 쓰면 수납 반영도 하면 안 된다(호출부 fail-closed).
 */
async function recordPayssamEvent(
  db: Db,
  params: {
    tenantId: string;
    paymentId: string | null;
    billId: string;
    apprState?: string | null;
    apprNum?: string | null;
    apprPrice?: number | null;
    payload: unknown;
    outcome: "applied" | "duplicate" | "mismatch" | "unmatched";
    note?: string;
  },
): Promise<"inserted" | "duplicate" | "error"> {
  const { error } = await db.from("payssam_events").insert({
    tenant_id: params.tenantId,
    payment_id: params.paymentId,
    bill_id: params.billId,
    event_type: "sync", // 관리자 화면 경로는 전부 수동/대조 동기화 — 콜백(callback)은 API 라우트 소관.
    appr_state: params.apprState ?? null,
    appr_num: params.apprNum ?? null,
    appr_price: params.apprPrice ?? null,
    payload: params.payload ?? {},
    outcome: params.outcome,
    note: params.note ?? null,
  });
  if (!error) return "inserted";
  if (error.code === "23505") return "duplicate"; // 같은 승인 통보의 재적용 시도 — 멱등 no-op(검수 36)
  console.error("[payssam] event insert failed", error);
  return "error";
}

/**
 * 결제선생 예외를 업무 큐로 수렴(정본 ⑧). kind는 00013 work_items.kind가 자유 텍스트라
 * DB 제약이 없고, lib/data/work.ts 유니온에 payssam_* 미등재 상태라 단언으로 넘긴다(소유 밖 파일).
 */
async function createPayssamWorkItem(
  tenantId: string,
  kind: "payssam_unknown_result" | "payssam_mismatch",
  paymentId: string,
  title: string,
  detail: string,
  nextAction: string,
): Promise<void> {
  await createWorkItem(tenantId, {
    kind,
    title,
    detail,
    sourceType: "payment",
    sourceId: paymentId,
    nextAction,
    priority: "money",
  });
}

/**
 * ① 청구서 발송 — POST /bill.
 *
 * sendType은 둘이다. TALK은 학부모 카카오톡으로 바로 보내고 쌤포인트를 차감한다.
 * URL은 카카오톡을 쓰지 않고 청구서 단축 URL만 받아온다 — 포인트가 들지 않으므로,
 * 카카오톡 발송이 막혔을 때(포인트 미충전·계정 미연결 등) 운영자가 링크를 직접 전달해
 * 청구를 이어갈 수 있는 우회로다. 어느 쪽이든 청구서 자체는 동일하게 생성된다.
 * 가드: method=payssaem · status=pending · bill_id 없음 · 수기 완납 아님(검수 39).
 * NETWORK(결과 불명)면 billId를 저장하지 않고 원장(unmatched)+업무 큐로 수렴 —
 * 재클릭 시 새 billId로 발송하므로 유령 청구서가 내부 행을 오염시키지 않는다(파트너 생성 ID라 안전).
 */
/**
 * 링크만 발급 — 카카오톡을 쓰지 않는 발송(포인트 미차감).
 *
 * 별도 export인 이유: ActionButton은 클라이언트 컴포넌트라 서버 액션 참조만 넘길 수 있다.
 * 서버 컴포넌트에서 `(id) => sendPayssamBillAction(id, "URL")` 같은 인라인 함수를 넘기면
 * 직렬화할 수 없어 런타임에서 깨진다.
 */
export async function sendPayssamBillUrlAction(id: string): Promise<CrmActionResult> {
  return sendPayssamBillAction(id, "URL");
}

export async function sendPayssamBillAction(
  id: string,
  sendType: "TALK" | "URL" = "TALK",
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const payment = await fetchPayssamPayment(db, session.tenantId, id);
  if (!payment) return { ok: false, error: "청구 정보를 찾을 수 없습니다." };
  if (payment.method !== "payssaem") {
    return { ok: false, error: "결제선생 수단 청구만 발송할 수 있습니다." };
  }
  if (payment.bill_id) {
    return { ok: false, error: "이미 발송된 청구서가 있습니다. 재발송 버튼을 사용해 주세요." };
  }
  // 수기로 완납했거나 청구(pending) 상태가 아니면 API 발송 금지(검수 39 — 이중 청구 방지).
  if (payment.status !== "pending" || payment.paid_at) {
    return { ok: false, error: "청구 상태(청구·미납 이전)가 아니거나 이미 완납된 건은 발송할 수 없습니다." };
  }
  // 결제선생은 숫자만 허용 — 저장 형식(010-1234-5678)의 하이픈·공백을 제거해 전송한다
  // (로컬 실측 2026-08-25: 하이픈 포함 시 "휴대폰 번호 형식이 올바르지 않습니다" 거절).
  const phone = (payment.students?.parent_phone ?? "").replace(/\D/g, "");
  if (!phone) return { ok: false, error: "학부모 연락처를 확인할 수 없습니다." };
  const memberName = payment.students?.name ?? "학부모";

  const billId = generateBillId();
  const productName = `수강료 (${formatKDate(payment.period_start)}~${formatKDate(payment.period_end)})`;

  // 청구서 발송은 금전 전환(money) — 감사 선기록 실패 시 외부 호출 자체를 하지 않는다(fail-closed).
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "payssam_send",
      targetType: "payment",
      targetId: id,
      summary: `결제선생 청구서 ${sendType === "URL" ? "링크 발급" : "카카오톡 발송"}: ${formatWon(payment.amount)}`,
      category: "money",
      before: { status: payment.status, bill_id: null },
      after: { bill_id: billId, amount: payment.amount, student_id: payment.student_id },
    },
    async (): Promise<CrmActionResult> => {
      const sent = await sendBill({
        billId,
        productName,
        price: payment.amount,
        memberName,
        phone,
        sendType,
        // callbackUrl은 클라이언트가 PAYSSAM_CALLBACK_URL → SITE_URL+/api/payssam/callback로 보강한다.
      });
      if (!sent.ok) {
        if (sent.code === "NETWORK") {
          // 결과 불명 — 발송됐을 수 있으므로 billId를 원장에 남겨 추적 가능하게 한다(검수 37).
          // 내부 행에는 저장하지 않는다: 재시도는 새 billId로 나가고, 이 billId는 원장으로만 대조한다.
          await recordPayssamEvent(db, {
            tenantId: session.tenantId,
            paymentId: id,
            billId,
            payload: { phase: "send", error: sent.error, amount: payment.amount },
            outcome: "unmatched",
            note: "발송 결과 불명 — 내부 미저장 billId(재시도는 새 billId로 발송)",
          });
          await createPayssamWorkItem(
            session.tenantId,
            "payssam_unknown_result",
            id,
            "결제선생 청구서 발송 결과 불명",
            `billId=${billId} · ${formatWon(payment.amount)} · ${sent.error}`,
            "결제선생 관리자에서 해당 billId 발송 여부 확인 후, 발송됐다면 파기하고 다시 발송",
          );
          return {
            ok: false,
            error:
              "발송 결과를 확인할 수 없습니다(통신 오류). 업무 큐에서 실제 발송 여부를 확인해 주세요. 재시도하면 새 청구서 ID로 발송됩니다.",
          };
        }
        // 명시 거절 — 쌤포인트 부족 등 '운영 준비 실패'일 수 있다(검수 38). 알럿 1회로
        // 소멸시키지 않고 업무 큐에 남겨 운영자가 원인(잔액·설정)을 닫게 한다.
        await createWorkItem(session.tenantId, {
          kind: "automation_failure",
          title: "결제선생 청구서 발송 거절",
          detail: `${formatWon(payment.amount)} · ${sent.code ?? "-"} ${sent.error ?? ""}`,
          sourceType: "payment",
          sourceId: id,
          nextAction: "거절 사유(쌤포인트 잔액·설정) 확인 후 재발송",
          priority: "money",
        });
        return { ok: false, error: `결제선생이 발송을 거절했습니다: ${sent.error}` };
      }
      const { error } = await db
        .from("payments")
        .update({
          bill_id: billId,
          bill_short_url: sent.data.shortUrl ?? null,
          bill_sent_at: new Date().toISOString(),
          appr_state: "W", // 발송 직후 스냅샷 — 승인(F)은 /bill/read 대조·콜백 검증 후에만.
        })
        .eq("tenant_id", session.tenantId)
        .eq("id", id);
      if (error) {
        // 외부 발송은 성공했는데 내부 저장 실패 — 유령 청구서 방지를 위해 원장+업무 큐로 수렴.
        console.error("[payssam] send save failed", error);
        await recordPayssamEvent(db, {
          tenantId: session.tenantId,
          paymentId: id,
          billId,
          apprState: "W",
          payload: { phase: "send_saved_failed", shortUrl: sent.data.shortUrl ?? null },
          outcome: "unmatched",
          note: "발송 성공했으나 내부 저장 실패 — billId 수동 연결 필요",
        });
        await createPayssamWorkItem(
          session.tenantId,
          "payssam_unknown_result",
          id,
          "결제선생 발송 성공·내부 저장 실패",
          `billId=${billId} · shortUrl=${sent.data.shortUrl ?? "-"}`,
          "청구서는 발송됨 — billId를 결제 행에 수동 반영하거나 결제선생에서 파기 후 재발송",
        );
        return { ok: false, error: "청구서는 발송됐지만 저장에 실패했습니다. 업무 큐를 확인해 주세요." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidatePayment(id);
  return result;
}

/**
 * ② 청구서 재발송 — POST /bill/resend. 발송됨·미결제(W)만.
 * 재발송도 쌤포인트가 다시 차감된다(55P/건) — UI confirm 문구로 안내한다(검수 38).
 */
export async function resendPayssamBillAction(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const payment = await fetchPayssamPayment(db, session.tenantId, id);
  if (!payment) return { ok: false, error: "청구 정보를 찾을 수 없습니다." };
  if (!payment.bill_id) return { ok: false, error: "발송된 청구서가 없습니다. 먼저 발송해 주세요." };
  if (payment.appr_state !== "W") {
    return { ok: false, error: "미결제(발송됨) 상태의 청구서만 재발송할 수 있습니다." };
  }
  const billId = payment.bill_id;

  // 재발송은 쌤포인트 재차감이 있는 금전 전환(money) — fail-closed 감사.
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "payssam_resend",
      targetType: "payment",
      targetId: id,
      summary: `결제선생 청구서 재발송: ${formatWon(payment.amount)}`,
      category: "money",
      after: { bill_id: billId },
    },
    async (): Promise<CrmActionResult> => {
      const resent = await resendBill(billId);
      if (!resent.ok) {
        if (resent.code === "NETWORK") {
          // 재발송은 상태 전이가 없어 결과 불명이어도 내부가 오염되지 않는다 — 확인만 안내.
          return {
            ok: false,
            error: "재발송 결과를 확인할 수 없습니다(통신 오류). 학부모 수신 여부를 확인 후 재시도해 주세요.",
          };
        }
        return { ok: false, error: `결제선생이 재발송을 거절했습니다: ${resent.error}` };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidatePayment(id);
  return result;
}

/**
 * ③ 청구서 파기 — POST /bill/destroy. 승인 전(W)만(검수 42 — 수납된 청구를 단순 파기하지 않는다).
 * 성공 시 appr_state='D'만 기록하고 bill_id·이력은 보존한다(재청구는 새 결제 행으로).
 */
export async function destroyPayssamBillAction(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const payment = await fetchPayssamPayment(db, session.tenantId, id);
  if (!payment) return { ok: false, error: "청구 정보를 찾을 수 없습니다." };
  if (!payment.bill_id) return { ok: false, error: "발송된 청구서가 없습니다." };
  if (payment.appr_state !== "W") {
    return {
      ok: false,
      error: "미결제(발송됨) 청구서만 파기할 수 있습니다. 결제 완료 건은 환불(취소)을 사용하세요.",
    };
  }
  const billId = payment.bill_id;

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "payssam_destroy",
      targetType: "payment",
      targetId: id,
      summary: `결제선생 청구서 파기: ${formatWon(payment.amount)}`,
      category: "money",
      before: { bill_id: billId, appr_state: payment.appr_state },
      after: { appr_state: "D" },
    },
    async (): Promise<CrmActionResult> => {
      const destroyed = await destroyBill(billId, payment.amount); // 2필드 hash — phone 불필요(실측)
      if (!destroyed.ok) {
        if (destroyed.code === "NETWORK") {
          // 결과 불명 — 파기됐을 수도 있으니 D로 확정하지 않는다. 동기화로 실제 상태를 대조.
          return {
            ok: false,
            error: "파기 결과를 확인할 수 없습니다(통신 오류). '동기화'로 실제 상태를 확인해 주세요.",
          };
        }
        return { ok: false, error: `결제선생이 파기를 거절했습니다: ${destroyed.error}` };
      }
      const { error } = await db
        .from("payments")
        .update({ appr_state: "D" }) // bill_id·short_url·발송 시각은 청구 이력으로 보존
        .eq("tenant_id", session.tenantId)
        .eq("id", id);
      if (error) {
        console.error("[payssam] destroy save failed", error);
        return { ok: false, error: "파기는 됐지만 저장에 실패했습니다. '동기화'로 상태를 맞춰 주세요." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidatePayment(id);
  return result;
}

/**
 * ④ 동기화 — POST /bill/read 대조(검수 37·128: 통보를 그대로 믿지 않는 정본 경로).
 *  - F + 내부 pending + 금액 일치 → payssam_events applied 선기록(23505=duplicate no-op) 후 paid 반영.
 *  - 금액 불일치 → 수납 반영 금지, 원장 mismatch + work_item(payssam_mismatch)(검수 115·128).
 *  - C → 내부 refunded와의 정합 확인(불일치면 원장+업무 큐 수렴 — 검수 45).
 *  - 어떤 상태든 스냅샷(appr_state 등)과 last_synced_at은 갱신한다(외부 사실의 기록).
 */
export async function syncPayssamBillAction(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const payment = await fetchPayssamPayment(db, session.tenantId, id);
  if (!payment) return { ok: false, error: "청구 정보를 찾을 수 없습니다." };
  if (!payment.bill_id) return { ok: false, error: "발송된 청구서가 없어 동기화할 수 없습니다." };
  const billId = payment.bill_id;

  // 수납 반영 가능성이 있는 대조는 금전 전환(money) — fail-closed 감사.
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "payssam_sync",
      targetType: "payment",
      targetId: id,
      summary: `결제선생 청구서 동기화: ${formatWon(payment.amount)}`,
      category: "money",
      before: { status: payment.status, appr_state: payment.appr_state },
    },
    async (): Promise<CrmActionResult> => {
      const read = await readBill(billId);
      if (!read.ok) {
        if (read.code === "NETWORK") {
          return { ok: false, error: "결제선생 조회에 실패했습니다(통신 오류). 잠시 후 다시 시도해 주세요." };
        }
        return { ok: false, error: `결제선생 조회 거절: ${read.error}` };
      }
      const data = read.data;
      const now = new Date().toISOString();
      const apprState =
        data.apprState === "F" || data.apprState === "W" || data.apprState === "C" || data.apprState === "D"
          ? data.apprState
          : null;
      const apprPriceNum = data.apprPrice === undefined ? null : Number(data.apprPrice);
      const apprPrice = apprPriceNum !== null && Number.isFinite(apprPriceNum) ? apprPriceNum : null;

      // 공통 스냅샷 — 업무 상태(status)는 여기서 절대 건드리지 않는다(M0 분리).
      const snapshot: Record<string, unknown> = { last_synced_at: now };
      if (apprState) snapshot.appr_state = apprState;

      if (apprState === "F") {
        // 금액 대조 — 불일치면 수납 반영 금지, 원장·업무 큐로 수렴(검수 115·128).
        if (apprPrice === null || apprPrice !== payment.amount) {
          await recordPayssamEvent(db, {
            tenantId: session.tenantId,
            paymentId: id,
            billId,
            apprState,
            apprNum: data.apprNum ?? null,
            apprPrice,
            payload: { ...data, apiKey: "[redacted]" }, // 원문 보존하되 파트너 비밀키만 마스킹(콜백 라우트와 동일)
            outcome: "mismatch",
            note: `승인 금액 ${data.apprPrice ?? "?"} ≠ 내부 청구 ${payment.amount}`,
          });
          await createPayssamWorkItem(
            session.tenantId,
            "payssam_mismatch",
            id,
            "결제선생 승인 금액 불일치",
            `billId=${billId} · 승인 ${data.apprPrice ?? "?"}원 vs 내부 ${payment.amount}원`,
            "결제선생 관리자에서 승인 내역 확인 후 부분취소/재청구 등 수동 정정",
          );
          const { error } = await db
            .from("payments")
            .update(snapshot)
            .eq("tenant_id", session.tenantId)
            .eq("id", id);
          if (error) console.error("[payssam] sync snapshot save failed", error);
          return {
            ok: false,
            error: "승인 금액이 내부 청구 금액과 다릅니다. 수납을 반영하지 않았습니다 — 업무 큐를 확인해 주세요.",
          };
        }
        if (payment.status === "pending" || payment.status === "overdue") {
          // 수납 반영 전 원장 선기록 — applied 부분 유니크가 이중 반영을 막는다(검수 36).
          const recorded = await recordPayssamEvent(db, {
            tenantId: session.tenantId,
            paymentId: id,
            billId,
            apprState,
            apprNum: data.apprNum ?? null,
            apprPrice,
            payload: { ...data, apiKey: "[redacted]" }, // 원문 보존하되 파트너 비밀키만 마스킹(콜백 라우트와 동일)
            outcome: "applied",
          });
          if (recorded === "error") {
            // 멱등 원장을 못 쓰면 수납도 반영하지 않는다(이중 반영 위험 — fail-closed).
            return { ok: false, error: "동기화 원장 기록에 실패해 수납을 반영하지 않았습니다. 다시 시도해 주세요." };
          }
          const paidFields = {
            ...snapshot,
            status: "paid",
            paid_at: payssamDtToIso(data.apprDt) ?? now,
            appr_num: data.apprNum ?? null,
            appr_price: apprPrice,
            appr_issuer: data.apprIssuer ?? null,
            appr_dt: payssamDtToIso(data.apprDt),
          };
          if (recorded === "duplicate") {
            // sync 적용 기록은 이미 있는데 내부가 여전히 미수납이면 — 이전 시도가 반영 단계에서
            // 실패해 클레임만 잔존한 고착 상태다. 원장이 아니라 실제 상태로 판정해 재반영한다.
            const { data: retried, error: retryError } = await db
              .from("payments")
              .update(paidFields)
              .eq("tenant_id", session.tenantId)
              .eq("id", id)
              .in("status", ["pending", "overdue"])
              .select("id");
            if (retryError) {
              console.error("[payssam] sync re-apply failed", retryError);
              return { ok: false, error: "수납 반영 저장에 실패했습니다. 다시 동기화해 주세요." };
            }
            if (!retried?.length) {
              // 0행 = 이미 paid로 수렴돼 있던 진짜 재적용 시도 — 스냅샷만 갱신하는 no-op(검수 36).
              const { error } = await db
                .from("payments")
                .update(snapshot)
                .eq("tenant_id", session.tenantId)
                .eq("id", id);
              if (error) console.error("[payssam] sync snapshot save failed", error);
            }
            return { ok: true };
          }
          const { data: appliedRows, error } = await db
            .from("payments")
            .update(paidFields)
            .eq("tenant_id", session.tenantId)
            .eq("id", id)
            .in("status", ["pending", "overdue"]) // 콜백·수기와의 경합 방지 — 미수납일 때만 승격
            .select("id");
          if (error || !appliedRows?.length) {
            // 반영 실패(또는 그 사이 다른 경로가 수납) — 방금 넣은 applied 클레임을 회수한다.
            // 회수 없이는 재시도가 전부 duplicate로 흡수돼 영구 미수납으로 고착된다(콜백 라우트와 동일 방어).
            if (error) console.error("[payssam] sync apply failed", error);
            let rollback = db
              .from("payssam_events")
              .delete()
              .eq("tenant_id", session.tenantId)
              .eq("bill_id", billId)
              .eq("event_type", "sync")
              .eq("outcome", "applied");
            rollback = data.apprNum
              ? rollback.eq("appr_num", data.apprNum)
              : rollback.is("appr_num", null);
            const { error: rollbackError } = await rollback;
            if (rollbackError) {
              console.error("[payssam] sync claim rollback failed", rollbackError);
              await createPayssamWorkItem(
                session.tenantId,
                "payssam_unknown_result",
                id,
                "동기화 클레임 회수 실패 — 수납 고착 위험",
                `billId=${billId} · applied(sync) 원장이 남아 재동기화가 무시될 수 있음`,
                "payssam_events의 applied(sync) 행 확인 후 수동 정리·재동기화",
              );
            }
            if (error) {
              return { ok: false, error: "수납 반영 저장에 실패했습니다. 다시 동기화해 주세요." };
            }
            // 경합: 그 사이 콜백 등이 이미 수납 — 결과는 동일한 paid, 원장은 콜백 applied 1행만 남는다.
            return { ok: true };
          }
          return { ok: true };
        }
        // 이미 paid/refunded 등 — 스냅샷만 갱신(승인 스냅샷 최신화).
        const { error } = await db
          .from("payments")
          .update({
            ...snapshot,
            appr_num: data.apprNum ?? null,
            appr_price: apprPrice,
            appr_issuer: data.apprIssuer ?? null,
            appr_dt: payssamDtToIso(data.apprDt),
          })
          .eq("tenant_id", session.tenantId)
          .eq("id", id);
        if (error) console.error("[payssam] sync snapshot save failed", error);
        return { ok: true };
      }

      if (apprState === "C") {
        // 외부 취소 — 내부가 refunded로 수렴했는지 확인(검수 45). 불일치면 자동 전이하지 않고 수렴만.
        const { error } = await db
          .from("payments")
          .update(snapshot)
          .eq("tenant_id", session.tenantId)
          .eq("id", id);
        if (error) console.error("[payssam] sync snapshot save failed", error);
        if (payment.status !== "refunded") {
          await recordPayssamEvent(db, {
            tenantId: session.tenantId,
            paymentId: id,
            billId,
            apprState,
            apprNum: data.apprNum ?? null,
            apprPrice,
            payload: { ...data, apiKey: "[redacted]" }, // 원문 보존하되 파트너 비밀키만 마스킹(콜백 라우트와 동일)
            outcome: "mismatch",
            note: `외부 취소(C)인데 내부 상태 ${payment.status} — 환불 정합 확인 필요`,
          });
          await createPayssamWorkItem(
            session.tenantId,
            "payssam_mismatch",
            id,
            "결제선생 취소·내부 상태 불일치",
            `billId=${billId} · 외부 C vs 내부 ${payment.status}`,
            "결제선생 취소 경위 확인 후 내부 환불 처리(환불 버튼) 또는 정정",
          );
          return {
            ok: false,
            error: "외부 승인이 취소(C) 상태입니다. 내부 환불 상태와 불일치 — 업무 큐를 확인해 주세요.",
          };
        }
        return { ok: true };
      }

      // W(미결제)·D(파기)·해석 불가 상태 — 스냅샷·동기화 시각만 갱신.
      const { error } = await db
        .from("payments")
        .update(snapshot)
        .eq("tenant_id", session.tenantId)
        .eq("id", id);
      if (error) {
        console.error("[payssam] sync snapshot save failed", error);
        return { ok: false, error: "동기화 결과 저장에 실패했습니다." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidatePayment(id);
  return result;
}

/**
 * ⑤ 환불(전액취소) — POST /bill/cancel. status=paid + appr_state=F만(검수 42 — 파기가 아니라 취소).
 * NETWORK(결과 불명)면 refunded로 확정하지 않는다 — 업무 큐로 수렴하고 동기화로 실제 결과를 대조(검수 37).
 * 현금영수증 발급 건은 UI에서 발급 취소 선행을 경고한다(강제 차단 없음 — 검수 45 수렴은 사후 대조로).
 */
export async function refundPayssamBillAction(
  id: string,
  reason: string,
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const trimmedReason = reason.trim();
  if (!trimmedReason) return { ok: false, error: "환불 사유를 입력해 주세요." };

  const db = createServiceClient()!;
  const payment = await fetchPayssamPayment(db, session.tenantId, id);
  if (!payment) return { ok: false, error: "청구 정보를 찾을 수 없습니다." };
  if (!payment.bill_id) return { ok: false, error: "결제선생 청구서가 없는 건은 API 환불 대상이 아닙니다." };
  if (payment.status !== "paid" || payment.appr_state !== "F") {
    return { ok: false, error: "결제 완료(승인 F + 완납) 상태의 청구만 환불할 수 있습니다." };
  }
  const billId = payment.bill_id;

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "payssam_refund",
      targetType: "payment",
      targetId: id,
      summary: `결제선생 전액 환불: ${formatWon(payment.amount)}`,
      category: "money",
      before: { status: payment.status, appr_state: payment.appr_state, appr_num: payment.appr_num },
      after: { status: "refunded", appr_state: "C" },
      reason: trimmedReason,
    },
    async (): Promise<CrmActionResult> => {
      const canceled = await cancelBill(billId, payment.amount, trimmedReason); // 2필드 hash — phone 불필요(실측)
      if (!canceled.ok) {
        if (canceled.code === "NETWORK") {
          // 결과 불명은 성공이 아니다 — refunded로 확정하지 않고 업무 큐로 수렴(검수 37).
          await createPayssamWorkItem(
            session.tenantId,
            "payssam_unknown_result",
            id,
            "결제선생 환불 결과 불명",
            `billId=${billId} · ${formatWon(payment.amount)} · 사유: ${trimmedReason}`,
            "'동기화'로 실제 취소 여부를 대조한 뒤 환불 상태를 확정",
          );
          return {
            ok: false,
            error: "환불 결과를 확인할 수 없습니다(통신 오류). '동기화'로 실제 결과를 확인해 주세요.",
          };
        }
        return { ok: false, error: `결제선생이 환불을 거절했습니다: ${canceled.error}` };
      }
      const { error } = await db
        .from("payments")
        .update({
          status: "refunded",
          appr_state: "C",
          refund_appr_num: canceled.data.apprNum ?? null,
          refunded_at: payssamDtToIso(canceled.data.apprCancelDt) ?? new Date().toISOString(),
          refund_reason: trimmedReason,
        })
        .eq("tenant_id", session.tenantId)
        .eq("id", id);
      if (error) {
        // 외부 취소는 성공 — 내부 저장만 실패. 동기화(C 대조)가 수렴 경로다.
        console.error("[payssam] refund save failed", error);
        await createPayssamWorkItem(
          session.tenantId,
          "payssam_unknown_result",
          id,
          "결제선생 환불 성공·내부 저장 실패",
          `billId=${billId} · 취소 승인번호 ${canceled.data.apprNum ?? "-"}`,
          "'동기화'로 취소(C) 상태를 재대조해 내부 환불 상태를 확정",
        );
        return { ok: false, error: "환불은 됐지만 저장에 실패했습니다. '동기화'로 상태를 맞춰 주세요." };
      }
      if (payment.cash_receipt_state === "issued") {
        // 환불(청구·수납)은 수렴했지만 증빙이 발급 상태로 잔존 — 검수 45의 증빙 수렴을 업무로 남긴다.
        await createPayssamWorkItem(
          session.tenantId,
          "payssam_mismatch",
          id,
          "환불 완료·현금영수증 미취소",
          `billId=${billId} · 발급 승인번호 ${payment.cash_receipt_appr_num ?? "-"}`,
          "현금영수증 취소를 실행해 증빙 정합을 맞출 것",
        );
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidatePayment(id);
  return result;
}

/**
 * ⑥-a 현금영수증 발급 — POST /cash-receipt/issue. 완납(paid) + 결제선생 청구 건만.
 * supplyPrice·tax는 생략해 사업장의 면·과세 정책을 따른다(스펙 기본 동작).
 */
export async function issueCashReceiptAction(
  id: string,
  trader: string,
  issuanceNumber: string,
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  if (trader !== "0" && trader !== "1") {
    return { ok: false, error: "발급 구분(개인/사업자)을 선택해 주세요." };
  }
  const normalizedNumber = issuanceNumber.replace(/[^0-9]/g, "");
  if (!normalizedNumber) {
    return { ok: false, error: "발행 요청 번호(휴대폰/주민번호/사업자번호)를 입력해 주세요." };
  }

  const db = createServiceClient()!;
  const payment = await fetchPayssamPayment(db, session.tenantId, id);
  if (!payment) return { ok: false, error: "청구 정보를 찾을 수 없습니다." };
  if (!payment.bill_id) {
    return { ok: false, error: "결제선생 청구서로 결제된 건만 API로 현금영수증을 발급할 수 있습니다." };
  }
  if (payment.status !== "paid") {
    return { ok: false, error: "완납된 청구만 현금영수증을 발급할 수 있습니다." };
  }
  if (payment.cash_receipt_state === "issued") {
    return { ok: false, error: "이미 발급된 현금영수증이 있습니다. 정정은 취소 후 재발급으로 진행하세요." };
  }
  const billId = payment.bill_id;
  const traderValue: PayssamCashTrader = trader;

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "payssam_cash_receipt_issue",
      targetType: "payment",
      targetId: id,
      summary: `현금영수증 발급: ${formatWon(payment.amount)}`,
      category: "money",
      after: { bill_id: billId, trader: traderValue },
    },
    async (): Promise<CrmActionResult> => {
      const issued = await issueCashReceipt({
        billId,
        price: payment.amount,
        issuanceNumber: normalizedNumber,
        trader: traderValue,
      });
      if (!issued.ok) {
        if (issued.code === "NETWORK") {
          // 결과 불명 — 발급됐을 수 있으므로 성공/실패 확정 없이 업무 큐로 수렴(검수 37).
          await createPayssamWorkItem(
            session.tenantId,
            "payssam_unknown_result",
            id,
            "현금영수증 발급 결과 불명",
            `billId=${billId} · ${formatWon(payment.amount)}`,
            "결제선생 관리자에서 발급 이력 확인 후, 미발급이면 재시도",
          );
          return {
            ok: false,
            error: "발급 결과를 확인할 수 없습니다(통신 오류). 업무 큐에서 발급 이력을 확인해 주세요.",
          };
        }
        return { ok: false, error: `결제선생이 발급을 거절했습니다: ${issued.error}` };
      }
      const { error } = await db
        .from("payments")
        .update({
          cash_receipt_state: "issued",
          cash_receipt_appr_num: issued.data.apprCashNum ?? null,
          cash_receipt_trader: traderValue,
          cash_receipt_issued_at: new Date().toISOString(),
        })
        .eq("tenant_id", session.tenantId)
        .eq("id", id);
      if (error) {
        console.error("[payssam] cash receipt save failed", error);
        return { ok: false, error: "발급은 됐지만 저장에 실패했습니다. 새로고침 후 상태를 확인해 주세요." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidatePayment(id);
  return result;
}

/** ⑥-b 현금영수증 발급 취소 — POST /cash-receipt/cancel. 발급됨(issued)만(검수 45 증빙 수렴). */
export async function cancelCashReceiptAction(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const payment = await fetchPayssamPayment(db, session.tenantId, id);
  if (!payment) return { ok: false, error: "청구 정보를 찾을 수 없습니다." };
  if (!payment.bill_id) return { ok: false, error: "결제선생 청구서가 없는 건입니다." };
  if (payment.cash_receipt_state !== "issued") {
    return { ok: false, error: "발급된 현금영수증이 없습니다." };
  }
  const trader = payment.cash_receipt_trader;
  if (trader !== "0" && trader !== "1") {
    return { ok: false, error: "발급 구분 정보가 없어 취소 요청을 만들 수 없습니다." };
  }
  const billId = payment.bill_id;

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "payssam_cash_receipt_cancel",
      targetType: "payment",
      targetId: id,
      summary: `현금영수증 발급 취소: ${formatWon(payment.amount)}`,
      category: "money",
      before: { cash_receipt_state: "issued", cash_receipt_appr_num: payment.cash_receipt_appr_num },
      after: { cash_receipt_state: "canceled" },
    },
    async (): Promise<CrmActionResult> => {
      const canceled = await cancelCashReceipt({
        billId,
        price: payment.amount,
        trader,
      });
      if (!canceled.ok) {
        if (canceled.code === "NETWORK") {
          return {
            ok: false,
            error: "취소 결과를 확인할 수 없습니다(통신 오류). 결제선생 발급 이력 확인 후 재시도해 주세요.",
          };
        }
        return { ok: false, error: `결제선생이 취소를 거절했습니다: ${canceled.error}` };
      }
      const { error } = await db
        .from("payments")
        .update({ cash_receipt_state: "canceled" }) // 승인번호·발급 구분은 이력으로 보존
        .eq("tenant_id", session.tenantId)
        .eq("id", id);
      if (error) {
        console.error("[payssam] cash receipt cancel save failed", error);
        return { ok: false, error: "취소는 됐지만 저장에 실패했습니다. 새로고침 후 상태를 확인해 주세요." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidatePayment(id);
  return result;
}
