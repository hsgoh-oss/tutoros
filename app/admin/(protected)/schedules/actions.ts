"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { nextSessionNumber } from "@/lib/data/crm";
import { logActivity } from "@/lib/data/activity";
import { sendNotification } from "@/lib/notify/send";
import type { ClassType, ScheduleItem } from "@/lib/types";
import type { CrmActionResult } from "@/components/admin/crm/types";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";
const VALID_CLASS_TYPES: ClassType[] = ["inperson", "video"];
const VALID_STATUSES: ScheduleItem["status"][] = ["planned", "done", "canceled", "makeup"];

function revalidateSchedules() {
  revalidatePath("/admin/schedules");
}

/** scheduled_at(ISO)에서 KST(UTC+9) 기준 날짜(YYYY-MM-DD)만 추출 — 서버 TZ와 무관하게 일관. */
function kstDateOnly(iso: string): string {
  const kst = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 일정 완료 시 수업 기록 자동 생성·연결(기획 요구). idempotent, 실패해도 상태 변경은 유지(로그만).
 */
async function linkLessonForSchedule(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  scheduleId: string,
): Promise<void> {
  try {
    const { data: sched, error: fetchErr } = await db
      .from("schedules")
      .select("lesson_id, student_id, scheduled_at")
      .eq("tenant_id", tenantId)
      .eq("id", scheduleId)
      .maybeSingle();
    if (fetchErr || !sched) {
      if (fetchErr) console.error("[schedules] lesson-link fetch failed", fetchErr);
      return;
    }
    const row = sched as {
      lesson_id: string | null;
      student_id: string;
      scheduled_at: string;
    };
    if (row.lesson_id) return; // 이미 연결됨 — 재생성 방지

    const { data: lesson, error: insertErr } = await db
      .from("lessons")
      .insert({
        tenant_id: tenantId,
        student_id: row.student_id,
        lesson_date: kstDateOnly(row.scheduled_at),
        session_number: await nextSessionNumber(tenantId, row.student_id),
        content: "",
      })
      .select("id")
      .single();
    if (insertErr || !lesson) {
      console.error("[schedules] lesson auto-create failed", insertErr);
      return;
    }

    const { error: linkErr } = await db
      .from("schedules")
      .update({ lesson_id: (lesson as { id: string }).id })
      .eq("tenant_id", tenantId)
      .eq("id", scheduleId);
    if (linkErr) console.error("[schedules] lesson link update failed", linkErr);
  } catch (e) {
    console.error("[schedules] lesson auto-link error", e);
  }
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
  const { data, error } = await db
    .from("schedules")
    .insert({
      tenant_id: session.tenantId,
      student_id: studentId,
      scheduled_at: scheduledAt.toISOString(),
      class_type: classType,
      status: "planned",
      reminder_sent: false,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[schedules] insert failed", error);
    return { ok: false, error: "일정 등록 중 오류가 발생했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "create",
    "schedule",
    (data as { id: string } | null)?.id ?? null,
    "새 일정 등록",
  );

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

  // 완료 시 수업 기록 자동 연결(idempotent).
  if (status === "done") {
    await linkLessonForSchedule(db, session.tenantId, id);
  }

  await logActivity(
    session.tenantId,
    session.email,
    "update",
    "schedule",
    id,
    `상태 → ${status}`,
  );

  revalidateSchedules();
  return { ok: true };
}

/**
 * ⑨ 보강 안내(→학부모, 관리자 버튼·수동). 보강(makeup) 일정의 학부모에게 알림톡/SMS 발송.
 */
export async function sendMakeupNotice(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const { data: sched, error: schedErr } = await db
    .from("schedules")
    .select("student_id, scheduled_at")
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (schedErr || !sched) {
    console.error("[schedules] makeup-notice fetch failed", schedErr);
    return { ok: false, error: "일정을 찾을 수 없습니다." };
  }
  const s = sched as { student_id: string; scheduled_at: string };

  const { data: stu, error: stuErr } = await db
    .from("students")
    .select("name, parent_phone")
    .eq("tenant_id", session.tenantId)
    .eq("id", s.student_id)
    .maybeSingle();
  if (stuErr || !stu) {
    console.error("[schedules] makeup-notice student fetch failed", stuErr);
    return { ok: false, error: "학생 정보를 찾을 수 없습니다." };
  }
  const student = stu as { name: string; parent_phone: string };
  const dateText = kstDateOnly(s.scheduled_at);

  const result = await sendNotification({
    tenantId: session.tenantId,
    studentId: s.student_id,
    type: "schedule_changed",
    phone: student.parent_phone,
    message: `${student.name}님, 보강 수업이 ${dateText}에 예정되었습니다. 확인 부탁드립니다.`,
    isAd: false,
  });
  if (!result.ok) {
    return { ok: false, error: result.error ?? "알림 발송에 실패했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "notify",
    "schedule",
    id,
    `보강 안내 발송 (${dateText})`,
  );

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

  await logActivity(
    session.tenantId,
    session.email,
    "delete",
    "schedule",
    id,
    "일정 삭제",
  );

  revalidateSchedules();
  return { ok: true };
}
