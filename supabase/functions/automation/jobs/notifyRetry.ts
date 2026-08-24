// job=notify_retry — 발송 실패(status='failed') 알림을 retry_count 상한 전까지 재큐잉한다(다음 flush가 재발송).
// retry_count는 실패 시 send.ts(dispatchQueued)가 이미 +1 한다 — 여기서 또 올리면 이중 증가로
// 상한 3이 실제 시도 1~2회로 줄어든다. 재큐잉은 상태 전환만 담당한다(상한 3 = 실제 시도 3회).
// 추가로 10분 이상 sending에 머문 행(결과 불명)을 work_items로 수렴시킨다 — 결과 불명은 성공이 아니다.

import type { SupabaseClient } from "../../_shared/db.ts";

const MAX_RETRY = 3;
// sending 클레임 후 이 시간이 지나도록 결과가 없으면 결과 불명으로 본다.
// 판정 기준은 클레임 시각(claimed_at) — created_at은 야간 대기·재큐잉으로 수 시간 전일 수
// 있어 정상 발송 중 행을 오탐한다(00013에서 컬럼 추가, 클레임 시 send.ts가 스탬프).
const UNKNOWN_AFTER_MS = 10 * 60 * 1000;

interface FailedRow {
  id: string;
  retry_count: number;
}

interface SendingRow {
  id: string;
  tenant_id: string;
  type: string;
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
    // retry_count는 건드리지 않는다 — 실패 확정 시 send.ts가 이미 +1 했다.
    const { error: updateError } = await db
      .from("notifications")
      .update({ status: "queued" })
      .eq("id", row.id)
      .eq("status", "failed");
    if (updateError) {
      console.error("[notify_retry] update failed", updateError);
      continue;
    }
    requeued++;
  }

  // sending 장기 체류 = 발송 결과 불명. failed로 내리면 재큐잉→이중 발송 위험이 있고,
  // sent로 올리면 미발송을 성공으로 은폐한다 — 행 상태는 그대로 두고 사람이 확인할 업무로 넘긴다.
  const cutoff = new Date(Date.now() - UNKNOWN_AFTER_MS).toISOString();
  const { data: stuck, error: stuckError } = await db
    .from("notifications")
    .select("id, tenant_id, type")
    .eq("status", "sending")
    .lt("claimed_at", cutoff);
  if (stuckError) throw stuckError;

  let unknownReported = 0;
  for (const row of (stuck ?? []) as SendingRow[]) {
    // Deno 환경이라 lib/data/work.ts(createWorkItem)를 못 쓴다 — 직접 insert.
    // 같은 사건의 열린 업무가 있으면 부분 유니크가 23505를 내며 막는다(한 사건 한 업무 — 정상 경로).
    const { error: insertError } = await db.from("work_items").insert({
      tenant_id: row.tenant_id,
      kind: "notify_unknown_result",
      title: `알림 발송 결과 불명 — ${row.type}`,
      source_type: "notification",
      source_id: row.id,
      priority: "normal",
      status: "open",
      next_action: "실제 발송 여부 확인 후 수동 처리",
    });
    if (insertError) {
      if (insertError.code !== "23505") {
        console.error("[notify_retry] work_items insert failed", insertError);
      }
      continue;
    }
    unknownReported++;
  }

  return {
    failed: data?.length ?? 0,
    requeued,
    unknownSending: stuck?.length ?? 0,
    unknownReported,
  };
}
