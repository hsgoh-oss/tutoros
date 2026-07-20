"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { formatWon } from "@/lib/data/crm";
import { sendNotification } from "@/lib/notify/send";
import { renderTemplate } from "@/lib/notify/templates";
import type { PaymentMethod } from "@/lib/types";
import type { CrmActionResult } from "@/components/admin/crm/types";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";
const VALID_METHODS: PaymentMethod[] = ["payssaem", "bank"];

interface PaymentWithStudentRow {
  id: string;
  amount: number;
  student_id: string;
  students: { parent_phone: string; name: string } | null;
}

function revalidatePayment(id: string) {
  revalidatePath("/admin/payments");
  revalidatePath(`/admin/payments/${id}`);
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
    .select("id, amount, student_id, students(parent_phone, name)")
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (fetchError || !data) {
    return { ok: false, error: "청구 정보를 찾을 수 없습니다." };
  }
  // students는 payments.student_id 기준 to-one 관계 — Database 제네릭 없이는
  // supabase-js가 임베드 관계를 배열로 추론해 직접 캐스트가 거부된다. 실제 응답은 단일 객체.
  const payment = data as unknown as PaymentWithStudentRow;
  if (!payment.students?.parent_phone) {
    return { ok: false, error: "학부모 연락처를 확인할 수 없습니다." };
  }

  const message = renderTemplate("payment_request", {
    name: payment.students.name,
    amount: formatWon(payment.amount),
  });

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
