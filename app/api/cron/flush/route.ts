import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { isNightWindow, dispatchQueued } from "@/lib/notify/send";
import { isNotifyType } from "@/lib/notify/templates";
import type { NotifyChannel } from "@/lib/notify/solapi";

// job=notify_queue_flush — 매시 10분 pg_cron. queued 상태 및 야간 대기 알림을 dispatchQueued로 재발송한다.

const FLUSH_LIMIT = 50;

interface QueuedRow {
  id: string;
  tenant_id: string;
  student_id: string | null;
  type: string;
  channel: NotifyChannel;
  phone: string;
  message: string;
  is_ad: boolean;
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();
  if (!db) {
    return NextResponse.json({ error: "db not configured" }, { status: 400 });
  }

  // tenant-scope-ok: 큐 플러시 크론은 전 테넌트의 queued 알림을 처리한다(플랫폼 경로).
  // 각 행의 tenant_id는 dispatchQueued로 그대로 전달되며, 테넌트 간 데이터가 섞이지 않는다.
  let query = db
    .from("notifications")
    .select("id, tenant_id, student_id, type, channel, phone, message, is_ad")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(FLUSH_LIMIT);
  if (isNightWindow()) {
    query = query.eq("is_ad", false); // 광고성은 야간(21~08) 재시도 제외
  }

  const { data, error } = await query;
  if (error) {
    console.error("[cron/flush] queued 조회 실패", error);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;
  let unknownType = 0;
  for (const row of (data ?? []) as QueuedRow[]) {
    // 미지의 type은 코드-SQL 불일치 신호 — 로그만 남기고 발송은 막지 않는다(정상 알림 유실 방지).
    if (!isNotifyType(row.type)) {
      console.error(
        `[cron/flush] NotifyType에 없는 알림 타입 '${row.type}' — SMS로 발송 시도 (id=${row.id}). ` +
          `lib/notify/templates.ts와 SQL을 동기화하세요 (pnpm audit:notify).`,
      );
      unknownType++;
    }

    const result = await dispatchQueued(
      row.id,
      {
        tenantId: row.tenant_id,
        studentId: row.student_id,
        type: row.type,
        phone: row.phone,
        message: row.message,
        isAd: row.is_ad,
      },
      row.channel,
    );
    if (result.ok) sent++;
    else failed++;
  }

  return NextResponse.json({
    ok: true,
    processed: data?.length ?? 0,
    sent,
    failed,
    unknownType,
  });
}
