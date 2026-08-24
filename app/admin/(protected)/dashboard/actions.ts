"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { hasDb } from "@/lib/supabase/server";
import { resolveWorkItem } from "@/lib/data/work";
import { logActivity } from "@/lib/data/activity";
import type { CrmActionResult } from "@/components/admin/crm/types";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";

/**
 * 오늘 업무 완결 처리(완료·무시) 서버 액션.
 *
 * - resolution(처리 내용) 없이 닫지 못한다 — 결과 불명을 성공으로 만들지 않기 위함.
 * - resolveWorkItem은 열린 업무만 갱신하므로 이미 완결된 항목은 실패로 알려
 *   승인된 사실을 덮어쓰지 않는다(새로 닫히지도 않음).
 * - 감사(activity_log) 기록까지 남긴 뒤 대시보드를 갱신한다.
 */
export async function resolveWorkItemAction(
  id: string,
  resolution: string,
  status: "done" | "dismissed",
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const trimmed = resolution.trim();
  if (!trimmed) return { ok: false, error: "처리 내용을 입력해 주세요." };
  if (status !== "done" && status !== "dismissed") {
    return { ok: false, error: "잘못된 완결 상태입니다." };
  }

  const updated = await resolveWorkItem(session.tenantId, id, trimmed, status, session.email);
  if (!updated) {
    return { ok: false, error: "이미 완결됐거나 존재하지 않는 업무입니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    status === "done" ? "resolve" : "dismiss",
    "work_item",
    id,
    `업무 ${status === "done" ? "완료" : "무시"} 처리 — ${trimmed}`,
  );

  revalidatePath("/admin/dashboard");
  return { ok: true };
}
