"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { formatWon } from "@/lib/data/crm";
import { getSiteContent } from "@/lib/data/content";
import { sendNotification } from "@/lib/notify/send";
import { renderTemplate } from "@/lib/notify/templates";
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

  revalidatePath("/admin/payments");
  return { ok: true };
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

  revalidatePath("/admin/payments");
  return { ok: true };
}

export async function markPaid(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const { error } = await db
    .from("payments")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[payments] markPaid failed", error);
    return { ok: false, error: "완납 처리 중 오류가 발생했습니다." };
  }

  revalidatePayment(id);
  return { ok: true };
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

  const result = await sendNotification({
    tenantId: session.tenantId,
    studentId: payment.student_id,
    type: "payment_request",
    phone: payment.students.parent_phone,
    message,
    isAd: false,
  });
  if (!result.ok) {
    return { ok: false, error: result.error ?? "알림 발송에 실패했습니다." };
  }
  return { ok: true };
}

export async function deletePayment(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const { data: payment, error: fetchError } = await db
    .from("payments")
    .select("status")
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

  const { error } = await db
    .from("payments")
    .delete()
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[payments] delete failed", error);
    return { ok: false, error: "청구 삭제 중 오류가 발생했습니다." };
  }

  revalidatePath("/admin/payments");
  return { ok: true };
}
