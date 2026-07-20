// job=payment_d3 — 매일 10:00 KST: due_date=D+3(KST)인 pending 청구에 "결제 예정 안내"를 큐잉.
// 계약: 이 안내만 자동(청구 링크 발송은 관리자 수동). 멱등: 오늘 같은 학생·타입 알림이 있으면 스킵.

import type { SupabaseClient } from "../../_shared/db.ts";
import { kstDateString, kstDayRangeUtc } from "../../_shared/kst.ts";
import { paymentD3Message } from "../../_shared/templates.ts";
import { defaultChannel } from "../../_shared/channel.ts";

interface PaymentRow {
  id: string;
  tenant_id: string;
  student_id: string;
  amount: number;
  students: { name: string; parent_phone: string } | null;
}

export async function runPaymentD3(db: SupabaseClient) {
  const dueDate = kstDateString(3); // D+3 (KST 날짜 문자열)
  const todayStart = kstDayRangeUtc(0).start; // 오늘(KST) 00:00 — 중복 방지 기준

  const { data, error } = await db
    .from("payments")
    .select("id, tenant_id, student_id, amount, students(name, parent_phone)")
    .eq("status", "pending")
    .eq("due_date", dueDate);
  if (error) throw error;

  const channel = defaultChannel();
  let queued = 0;
  let skipped = 0;

  for (const row of (data ?? []) as unknown as PaymentRow[]) {
    if (!row.students?.parent_phone) {
      skipped++;
      continue;
    }

    const { data: existing, error: existingError } = await db
      .from("notifications")
      .select("id")
      .eq("tenant_id", row.tenant_id)
      .eq("student_id", row.student_id)
      .eq("type", "payment_d3")
      .gte("created_at", todayStart.toISOString());
    if (existingError) throw existingError;
    if (existing && existing.length > 0) {
      skipped++;
      continue;
    }

    const { error: insertError } = await db.from("notifications").insert({
      tenant_id: row.tenant_id,
      student_id: row.student_id,
      type: "payment_d3",
      channel,
      phone: row.students.parent_phone,
      message: paymentD3Message(row.students.name, row.amount),
      is_ad: false,
      status: "queued",
    });
    if (insertError) {
      console.error("[payment_d3] notification insert failed", insertError);
      skipped++;
      continue;
    }
    queued++;
  }

  return { targeted: data?.length ?? 0, queued, skipped };
}
