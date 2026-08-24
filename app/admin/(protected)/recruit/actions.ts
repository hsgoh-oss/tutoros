"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { getBackup, recordBackup } from "@/lib/data/backup";
import { logActivity, runCritical } from "@/lib/data/activity";
import type { RecruitState } from "@/lib/types";
import type { CrmActionResult } from "@/components/admin/crm/types";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";
const BACKUP_TARGET = "recruit_status";
const VALID_STATUSES: RecruitState[] = ["open", "closing", "waitlist", "closed"];

interface RecruitStatusRow {
  status: RecruitState;
  message: string;
  seat_count: number | null;
  is_banner_visible: boolean;
}

function revalidateRecruit() {
  revalidatePath("/admin/recruit");
  revalidatePath("/", "layout"); // 공개 사이트 모집 배너 즉시 반영
}

async function fetchRecruitRow(tenantId: string): Promise<RecruitStatusRow | null> {
  const db = createServiceClient()!;
  const { data } = await db
    .from("recruit_status")
    .select("status,message,seat_count,is_banner_visible")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return (data as RecruitStatusRow | null) ?? null;
}

export async function saveRecruitStatus(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const statusRaw = String(formData.get("status") ?? "open");
  const status: RecruitState = VALID_STATUSES.includes(statusRaw as RecruitState)
    ? (statusRaw as RecruitState)
    : "open";
  const message = String(formData.get("message") ?? "").trim();

  const seatCountRaw = String(formData.get("seatCount") ?? "").trim();
  const seatCount = seatCountRaw ? Number(seatCountRaw) : null;
  if (seatCountRaw && (!Number.isInteger(seatCount) || (seatCount as number) < 0)) {
    return { ok: false, error: "모집 인원은 0 이상의 정수로 입력해 주세요." };
  }

  const isBannerVisible = formData.get("isBannerVisible") === "on";

  const previous = await fetchRecruitRow(session.tenantId);
  await recordBackup(session.tenantId, BACKUP_TARGET, previous);

  const db = createServiceClient()!;
  const { error } = await db.from("recruit_status").upsert({
    tenant_id: session.tenantId,
    status,
    message,
    seat_count: seatCount,
    is_banner_visible: isBannerVisible,
  });
  if (error) {
    console.error("[recruit] save failed", error);
    return { ok: false, error: "모집 현황 저장 중 오류가 발생했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "update",
    "recruit",
    null,
    `모집 현황 변경 (${status})`,
  );

  revalidateRecruit();
  return { ok: true };
}

export async function restoreRecruitBackup(backupId: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const backup = await getBackup(session.tenantId, backupId);
  if (!backup) return { ok: false, error: "백업을 찾을 수 없습니다." };
  // 스냅샷은 저장 시점 recruit_status 행(snake_case) 또는 null(당시 행 없음)을 담고 있다.
  const snapshot = backup.snapshot as RecruitStatusRow | null;
  if (!snapshot) {
    return { ok: false, error: "이 백업 시점에는 저장된 모집 현황이 없습니다." };
  }

  const previous = await fetchRecruitRow(session.tenantId);
  await recordBackup(session.tenantId, BACKUP_TARGET, previous);

  const db = createServiceClient()!;
  // 백업 복원은 게시 데이터 전체 치환 — 감사 선기록(pending) 없이는 실행하지 않는다(fail-closed).
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "restore",
      targetType: "recruit",
      targetId: backupId,
      summary: `모집 현황 백업 복원 (${snapshot.status})`,
      category: "privacy",
      // 복원 전 행 요약(4필드 전부) — null이면 복원 전 저장된 모집 현황이 없던 상태.
      before: previous,
      after: snapshot,
    },
    async () => {
      const { error } = await db.from("recruit_status").upsert({
        tenant_id: session.tenantId,
        status: snapshot.status,
        message: snapshot.message,
        seat_count: snapshot.seat_count,
        is_banner_visible: snapshot.is_banner_visible,
      });
      if (error) {
        console.error("[recruit] restore failed", error);
        return { ok: false, error: "복원 중 오류가 발생했습니다." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidateRecruit();
  return result;
}
