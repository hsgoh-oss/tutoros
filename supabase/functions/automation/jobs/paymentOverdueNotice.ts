// job=payment_overdue_notice — 매일 10:30 KST: status='overdue' 청구 학부모에게 미납 안내를 큐잉.
// 멱등: 주 1회(최근 7일 내 동일 알림이면 스킵). overdue 전환 자체는 payment_overdue_flag(순수 SQL)가 담당.

import type { SupabaseClient } from "../../_shared/db.ts";
import { paymentOverdueMessage } from "../../_shared/templates.ts";
import { defaultChannel } from "../../_shared/channel.ts";

interface PaymentRow {
  id: string;
  tenant_id: string;
  student_id: string;
  amount: number;
  students: { name: string; parent_phone: string } | null;
}

const DEDUP_WINDOW_DAYS = 7;

export async function runPaymentOverdueNotice(db: SupabaseClient) {
  const { data, error } = await db
    .from("payments")
    .select("id, tenant_id, student_id, amount, students(name, parent_phone)")
    .eq("status", "overdue");
  if (error) throw error;

  const channel = defaultChannel();
  const dedupSince = new Date(Date.now() - DEDUP_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
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
      .eq("type", "payment_overdue")
      .gte("created_at", dedupSince);
    if (existingError) throw existingError;
    if (existing && existing.length > 0) {
      skipped++;
      continue;
    }

    const { error: insertError } = await db.from("notifications").insert({
      tenant_id: row.tenant_id,
      student_id: row.student_id,
      type: "payment_overdue",
      channel,
      phone: row.students.parent_phone,
      message: paymentOverdueMessage(row.students.name, row.amount),
      is_ad: false,
      status: "queued",
    });
    if (insertError) {
      console.error("[payment_overdue_notice] notification insert failed", insertError);
      skipped++;
      continue;
    }
    queued++;
  }

  return { targeted: data?.length ?? 0, queued, skipped };
}
