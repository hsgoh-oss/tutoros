import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { isNightWindow, dispatchQueued } from "@/lib/notify/send";
import { isNotifyType } from "@/lib/notify/templates";
import type { NotifyChannel } from "@/lib/notify/solapi";

// job=notify_queue_flush — 매시 10분(pg_cron+pg_net이 CRON_SECRET으로 직접 호출).
// 엣지 함수(supabase/functions/automation)가 큐잉만 해 둔 알림과, 광고성이라 야간 대기 중이던
// 알림을 실제로 재시도 발송한다. Solapi 실발송 로직(알림톡→SMS 폴백 + 상태 갱신)은
// lib/notify/send.ts의 dispatchQueued를 그대로 재사용한다 — 로직 중복 없음.

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
    // notifications.type에는 CHECK 제약이 없고, SQL 자동화(예: automation_schedule_autoclean)와
    // 엣지 함수도 이 테이블에 직접 적재한다. 알 수 없는 타입은 코드-SQL 불일치 신호이므로
    // 반드시 로그로 드러내되, 발송은 막지 않는다 — message는 이미 완성돼 있고 알림톡 템플릿
    // 조회가 null을 반환해 SMS로 폴백하기 때문이다. 여기서 failed로 닫으면 정상 알림이 유실된다.
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
