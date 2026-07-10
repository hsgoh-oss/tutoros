"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import type { ClassType, ScheduleItem } from "@/lib/types";
import type { CrmActionResult } from "@/components/admin/crm/types";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";
const VALID_CLASS_TYPES: ClassType[] = ["inperson", "video"];
const VALID_STATUSES: ScheduleItem["status"][] = ["planned", "done", "canceled", "makeup"];

function revalidateSchedules() {
  revalidatePath("/admin/schedules");
}

export async function createSchedule(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const scheduledAtRaw = String(formData.get("scheduledAt") ?? "").trim();
  const classTypeRaw = String(formData.get("classType") ?? "inperson");

  if (!studentId) return { ok: false, error: "학생을 선택해 주세요." };
  if (!scheduledAtRaw) return { ok: false, error: "일시를 입력해 주세요." };

  const scheduledAt = new Date(scheduledAtRaw);
  if (Number.isNaN(scheduledAt.getTime())) {
    return { ok: false, error: "올바르지 않은 일시입니다." };
  }

  const classType: ClassType = VALID_CLASS_TYPES.includes(classTypeRaw as ClassType)
    ? (classTypeRaw as ClassType)
    : "inperson";

  const db = createServiceClient()!;
  const { error } = await db.from("schedules").insert({
    tenant_id: session.tenantId,
    student_id: studentId,
    scheduled_at: scheduledAt.toISOString(),
    class_type: classType,
    status: "planned",
    reminder_sent: false,
  });
  if (error) {
    console.error("[schedules] insert failed", error);
    return { ok: false, error: "일정 등록 중 오류가 발생했습니다." };
  }

  revalidateSchedules();
  return { ok: true };
}

export async function updateScheduleStatus(
  id: string,
  status: string,
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  if (!VALID_STATUSES.includes(status as ScheduleItem["status"])) {
    return { ok: false, error: "올바르지 않은 상태입니다." };
  }

  const db = createServiceClient()!;
  const { error } = await db
    .from("schedules")
    .update({ status })
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[schedules] status update failed", error);
    return { ok: false, error: "상태 변경 중 오류가 발생했습니다." };
  }

  revalidateSchedules();
  return { ok: true };
}

export async function deleteSchedule(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const { error } = await db
    .from("schedules")
    .delete()
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[schedules] delete failed", error);
    return { ok: false, error: "일정 삭제 중 오류가 발생했습니다." };
  }

  revalidateSchedules();
  return { ok: true };
}
