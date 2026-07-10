// job=lesson_reminder — 매일 18:00 KST(09:00 UTC): 내일(KST) 수업 예정인 학생 학부모에게
// 리마인더를 큐잉하고 schedules.reminder_sent를 true로 전환한다.
// 실 발송은 하지 않는다 — notifications에 status='queued'로 적재만 하고, 실제 Solapi 호출은
// notify_queue_flush(app/api/cron/flush)가 담당한다 (엣지 함수는 Next 전용 dispatchQueued를
// import할 수 없으므로 여기서는 큐 적재까지만).

import type { SupabaseClient } from "../../_shared/db.ts";
import { kstDayRangeUtc, formatKstDateTime } from "../../_shared/kst.ts";
import { lessonReminderMessage } from "../../_shared/templates.ts";
import { defaultChannel } from "../../_shared/channel.ts";

interface ScheduleRow {
  id: string;
  tenant_id: string;
  student_id: string;
  scheduled_at: string;
  students: { name: string; parent_phone: string } | null;
}

export async function runLessonReminder(db: SupabaseClient) {
  const { start, end } = kstDayRangeUtc(1); // 내일(KST) 범위
  const { data, error } = await db
    .from("schedules")
    .select("id, tenant_id, student_id, scheduled_at, students(name, parent_phone)")
    .eq("status", "planned")
    .eq("reminder_sent", false)
    .gte("scheduled_at", start.toISOString())
    .lt("scheduled_at", end.toISOString());
  if (error) throw error;

  const channel = defaultChannel();
  let queued = 0;
  let skipped = 0;

  for (const row of (data ?? []) as unknown as ScheduleRow[]) {
    if (!row.students?.parent_phone) {
      skipped++;
      continue;
    }

    const { error: insertError } = await db.from("notifications").insert({
      tenant_id: row.tenant_id,
      student_id: row.student_id,
      type: "lesson_reminder",
      channel,
      phone: row.students.parent_phone,
      message: lessonReminderMessage(row.students.name, formatKstDateTime(row.scheduled_at)),
      is_ad: false,
      status: "queued",
    });
    if (insertError) {
      console.error("[lesson_reminder] notification insert failed", insertError);
      skipped++;
      continue;
    }

    await db.from("schedules").update({ reminder_sent: true }).eq("id", row.id);
    queued++;
  }

  return { targeted: data?.length ?? 0, queued, skipped };
}
