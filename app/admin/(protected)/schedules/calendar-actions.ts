"use server";

import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { getScheduleDetail, listContractCandidates } from "@/lib/data/packages";
import { isUuid } from "@/lib/uuid";

/** Load a single session when its calendar controls open, always within the signed-in tenant. */
export async function getCalendarSchedule(id: string) {
  const session = await getAdminSession();
  if (!session) return { ok: false as const, error: "인증이 필요합니다." };
  const db = createServiceClient();
  if (!db || !isUuid(id)) return { ok: false as const, error: "일정을 불러올 수 없습니다." };
  const detail = await getScheduleDetail(session.tenantId, id);
  if (!detail) return { ok: false as const, error: "일정을 찾을 수 없습니다. 캘린더를 새로고침해 주세요." };
  const [pkg, replacement, candidates] = await Promise.all([
    detail.schedule.packageId ? db.from("lesson_packages").select("status")
      .eq("tenant_id", session.tenantId).eq("id", detail.schedule.packageId).maybeSingle() : null,
    db.from("schedules").select("id, scheduled_at").eq("tenant_id", session.tenantId)
      .eq("origin_schedule_id", id).neq("status", "canceled").maybeSingle(),
    detail.schedule.packageId && !detail.schedule.contractId ? listContractCandidates(session.tenantId, id) : [],
  ]);
  if (pkg?.error || replacement.error) return { ok: false as const, error: "수업 상태를 확인하지 못했습니다. 다시 시도해 주세요." };
  return { ok: true as const, detail: { ...detail, packageStatus: pkg?.data?.status as string | undefined,
    replacement: replacement.data ? { id: replacement.data.id as string, scheduledAt: replacement.data.scheduled_at as string } : null,
    candidates,
  } };
}

export type CalendarScheduleDetail = Extract<Awaited<ReturnType<typeof getCalendarSchedule>>, { ok: true }>["detail"];
