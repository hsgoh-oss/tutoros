"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { getBackup, recordBackup } from "@/lib/data/backup";
import { logActivity, runCritical } from "@/lib/data/activity";
import type { CrmActionResult } from "@/components/admin/crm/types";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";
const BACKUP_TARGET = "ddays";

interface DdayRow {
  id: string;
  name: string;
  exam_date: string;
  is_visible: boolean;
  sort_order: number;
}

function revalidateDday() {
  revalidatePath("/admin/dday");
  revalidatePath("/", "layout"); // 공개 사이트 D-day 배너 즉시 반영
}

async function fetchDdayRows(tenantId: string): Promise<DdayRow[]> {
  const db = createServiceClient()!;
  const { data } = await db
    .from("ddays")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("sort_order");
  return (data ?? []) as DdayRow[];
}

export async function createDday(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const name = String(formData.get("name") ?? "").trim();
  const examDate = String(formData.get("examDate") ?? "").trim();
  if (!name) return { ok: false, error: "이름을 입력해 주세요." };
  if (!examDate) return { ok: false, error: "시험일을 입력해 주세요." };

  const rows = await fetchDdayRows(session.tenantId);
  await recordBackup(session.tenantId, BACKUP_TARGET, rows);

  const nextSortOrder = rows.reduce((max, r) => Math.max(max, r.sort_order), -1) + 1;
  const db = createServiceClient()!;
  const { error } = await db.from("ddays").insert({
    tenant_id: session.tenantId,
    name,
    exam_date: examDate,
    is_visible: true,
    sort_order: nextSortOrder,
  });
  if (error) {
    console.error("[dday] insert failed", error);
    return { ok: false, error: "D-day 추가 중 오류가 발생했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "create",
    "dday",
    null,
    `D-day '${name}' 추가`,
  );

  revalidateDday();
  return { ok: true };
}

export async function updateDday(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const examDate = String(formData.get("examDate") ?? "").trim();
  if (!id) return { ok: false, error: "잘못된 요청입니다." };
  if (!name) return { ok: false, error: "이름을 입력해 주세요." };
  if (!examDate) return { ok: false, error: "시험일을 입력해 주세요." };

  const rows = await fetchDdayRows(session.tenantId);
  await recordBackup(session.tenantId, BACKUP_TARGET, rows);

  const db = createServiceClient()!;
  const { error } = await db
    .from("ddays")
    .update({ name, exam_date: examDate })
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[dday] update failed", error);
    return { ok: false, error: "D-day 수정 중 오류가 발생했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "update",
    "dday",
    id,
    `D-day '${name}' 수정`,
  );

  revalidateDday();
  return { ok: true };
}

export async function deleteDday(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const rows = await fetchDdayRows(session.tenantId);
  await recordBackup(session.tenantId, BACKUP_TARGET, rows);

  const db = createServiceClient()!;
  const { error } = await db
    .from("ddays")
    .delete()
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[dday] delete failed", error);
    return { ok: false, error: "D-day 삭제 중 오류가 발생했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "delete",
    "dday",
    id,
    "D-day 삭제",
  );

  revalidateDday();
  return { ok: true };
}

export async function toggleDdayVisibility(
  id: string,
  value: string,
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const rows = await fetchDdayRows(session.tenantId);
  await recordBackup(session.tenantId, BACKUP_TARGET, rows);

  const db = createServiceClient()!;
  const { error } = await db
    .from("ddays")
    .update({ is_visible: value === "true" })
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[dday] visibility update failed", error);
    return { ok: false, error: "노출 설정 변경 중 오류가 발생했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "update",
    "dday",
    id,
    `D-day 노출 ${value === "true" ? "켜기" : "끄기"}`,
  );

  revalidateDday();
  return { ok: true };
}

async function moveDday(id: string, direction: "up" | "down"): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const rows = await fetchDdayRows(session.tenantId);
  const idx = rows.findIndex((r) => r.id === id);
  if (idx === -1) return { ok: false, error: "D-day를 찾을 수 없습니다." };
  const targetIdx = direction === "up" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= rows.length) return { ok: true }; // 이미 끝 — 변화 없음

  await recordBackup(session.tenantId, BACKUP_TARGET, rows);

  const current = rows[idx];
  const target = rows[targetIdx];
  const db = createServiceClient()!;
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    db
      .from("ddays")
      .update({ sort_order: target.sort_order })
      .eq("tenant_id", session.tenantId)
      .eq("id", current.id),
    db
      .from("ddays")
      .update({ sort_order: current.sort_order })
      .eq("tenant_id", session.tenantId)
      .eq("id", target.id),
  ]);
  if (e1 || e2) {
    console.error("[dday] reorder failed", e1 ?? e2);
    return { ok: false, error: "정렬 변경 중 오류가 발생했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "update",
    "dday",
    id,
    `D-day 순서 변경 (${direction === "up" ? "위로" : "아래로"})`,
  );

  revalidateDday();
  return { ok: true };
}

export async function moveDdayUp(id: string): Promise<CrmActionResult> {
  return moveDday(id, "up");
}

export async function moveDdayDown(id: string): Promise<CrmActionResult> {
  return moveDday(id, "down");
}

export async function restoreDdayBackup(backupId: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const backup = await getBackup(session.tenantId, backupId);
  if (!backup) return { ok: false, error: "백업을 찾을 수 없습니다." };
  const snapshot = backup.snapshot;
  if (!Array.isArray(snapshot)) {
    return { ok: false, error: "백업 데이터가 올바르지 않습니다." };
  }
  // 스냅샷은 저장 시점 ddays 행 배열(snake_case)을 그대로 담고 있다.
  const snapshotRows = snapshot as DdayRow[];

  const rows = await fetchDdayRows(session.tenantId);
  await recordBackup(session.tenantId, BACKUP_TARGET, rows);

  const db = createServiceClient()!;
  // 백업 복원은 게시 데이터 전체 치환 — 감사 선기록(pending) 없이는 실행하지 않는다(fail-closed).
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "restore",
      targetType: "dday",
      targetId: backupId,
      summary: `D-day 백업 복원 (${snapshotRows.length}건)`,
      category: "privacy",
      // 복원 전 현재 규모 요약 — 전문 스냅샷은 위 recordBackup(backups 테이블) 몫.
      before: { dday_count: rows.length },
      after: { backup_id: backupId, restored_count: snapshotRows.length },
    },
    async () => {
      const { error: delError } = await db
        .from("ddays")
        .delete()
        .eq("tenant_id", session.tenantId);
      if (delError) {
        console.error("[dday] restore delete failed", delError);
        return { ok: false, error: "복원 중 오류가 발생했습니다." };
      }

      if (snapshotRows.length > 0) {
        const { error: insError } = await db.from("ddays").insert(
          snapshotRows.map((r) => ({
            id: r.id,
            tenant_id: session.tenantId,
            name: r.name,
            exam_date: r.exam_date,
            is_visible: r.is_visible,
            sort_order: r.sort_order,
          })),
        );
        if (insError) {
          console.error("[dday] restore insert failed", insError);
          return { ok: false, error: "복원 중 오류가 발생했습니다." };
        }
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidateDday();
  return result;
}
