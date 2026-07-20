// job=notify_retry — 주기 실행: 발송 실패(status='failed') 알림을 재큐잉한다(retry_count 상한).
// status='queued'로 되돌리고 retry_count를 올리면 다음 flush(app/api/cron/flush)가 재발송한다.

import type { SupabaseClient } from "../../_shared/db.ts";

const MAX_RETRY = 3;

interface FailedRow {
  id: string;
  retry_count: number;
}

export async function runNotifyRetry(db: SupabaseClient) {
  const { data, error } = await db
    .from("notifications")
    .select("id, retry_count")
    .eq("status", "failed")
    .lt("retry_count", MAX_RETRY);
  if (error) throw error;

  let requeued = 0;
  for (const row of (data ?? []) as FailedRow[]) {
    const { error: updateError } = await db
      .from("notifications")
      .update({ status: "queued", retry_count: row.retry_count + 1 })
      .eq("id", row.id);
    if (updateError) {
      console.error("[notify_retry] update failed", updateError);
      continue;
    }
    requeued++;
  }

  return { failed: data?.length ?? 0, requeued };
}
