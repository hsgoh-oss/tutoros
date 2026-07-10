import { createServiceClient } from "@/lib/supabase/server";

// 콘텐츠 항목별 백업 — 기획 고정: 항목(target)별 최근 12개 순환 + 시점 복원.
// 각 관리자 모듈은 저장 직전 recordBackup(직전 상태 스냅샷)을 호출하고,
// 복원은 모듈별 액션이 getBackup 스냅샷을 자기 저장 로직으로 되돌려 쓴다.

export const MAX_BACKUPS_PER_TARGET = 12;

export interface BackupEntry {
  id: string;
  target: string;
  snapshot: unknown;
  createdAt: string;
}

interface BackupRow {
  id: string;
  target: string;
  snapshot: unknown;
  created_at: string;
}

function mapBackup(row: BackupRow): BackupEntry {
  return {
    id: row.id,
    target: row.target,
    snapshot: row.snapshot,
    createdAt: row.created_at,
  };
}

/** 저장 직전 호출 — 현재 상태를 스냅샷으로 남기고 target별 12개 초과분을 정리한다. */
export async function recordBackup(
  tenantId: string,
  target: string,
  snapshot: unknown,
): Promise<void> {
  const db = createServiceClient();
  if (!db) return;

  const { error: insertError } = await db.from("backups").insert({
    tenant_id: tenantId,
    target,
    snapshot,
  });
  if (insertError) {
    console.error("[backup] insert failed", insertError);
    return;
  }

  const { data: excess, error: listError } = await db
    .from("backups")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("target", target)
    .order("created_at", { ascending: false })
    .range(MAX_BACKUPS_PER_TARGET, MAX_BACKUPS_PER_TARGET + 50);
  if (listError || !excess || excess.length === 0) return;

  const { error: pruneError } = await db
    .from("backups")
    .delete()
    .eq("tenant_id", tenantId)
    .in(
      "id",
      excess.map((r: { id: string }) => r.id),
    );
  if (pruneError) console.error("[backup] prune failed", pruneError);
}

export async function listBackups(
  tenantId: string,
  target: string,
): Promise<BackupEntry[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("backups")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("target", target)
    .order("created_at", { ascending: false })
    .limit(MAX_BACKUPS_PER_TARGET);
  return (data ?? []).map((r) => mapBackup(r as BackupRow));
}

export async function getBackup(
  tenantId: string,
  id: string,
): Promise<BackupEntry | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("backups")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  return data ? mapBackup(data as BackupRow) : null;
}
