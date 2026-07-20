import { createServiceClient } from "@/lib/supabase/server";

// 변경 이력(감사) 로그 — 주요 mutation을 기록하고 최근순으로 조회한다.

export interface ActivityEntry {
  id: string;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  summary: string;
  createdAt: string;
}

interface ActivityRow {
  id: string;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  summary: string;
  created_at: string;
}

/** 변경 이력 1건 기록. 실패해도 호출부 흐름을 막지 않는다(로그만 남김). */
export async function logActivity(
  tenantId: string,
  actorEmail: string | null,
  action: string,
  targetType: string,
  targetId: string | null,
  summary: string,
): Promise<void> {
  const db = createServiceClient();
  if (!db) return;
  const { error } = await db.from("activity_log").insert({
    tenant_id: tenantId,
    actor_email: actorEmail,
    action,
    target_type: targetType,
    target_id: targetId,
    summary,
  });
  if (error) console.error("[activity] insert failed", error);
}

export async function listActivity(
  tenantId: string,
  limit = 20,
): Promise<ActivityEntry[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("activity_log")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => {
    const row = r as ActivityRow;
    return {
      id: row.id,
      actorEmail: row.actor_email,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      summary: row.summary,
      createdAt: row.created_at,
    };
  });
}
