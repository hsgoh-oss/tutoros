"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { nextSessionNumber } from "@/lib/data/crm";
import { hasActiveBookingRestriction } from "@/lib/data/packages";
import { logActivity } from "@/lib/data/activity";
import { formatKDateTime, kstDateOnly, parseKstWallClock } from "@/lib/kst";
import { sendNotification } from "@/lib/notify/send";
import type { ClassType, ScheduleItem } from "@/lib/types";
import type { CrmActionResult } from "@/components/admin/crm/types";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";
const VALID_CLASS_TYPES: ClassType[] = ["inperson", "video"];
// 수동 상태 변경이 허용되는 값. 'conflict'는 후보 생성이 판정해서 붙이는 상태라 손으로 지정하지
// 않는다(화면 드롭다운도 같은 목록을 쓴다 — 목록과 검증이 어긋나면 고를 수 있는데 항상 거부된다).
const VALID_STATUSES: ScheduleItem["status"][] = ["planned", "done", "canceled", "makeup"];

function revalidateSchedules() {
  revalidatePath("/admin/schedules");
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

/**
 * 같은 학생의 살아 있는 회차와 겹치는지 확인한다(L-01 "겹치는 후보는 확정하지 않는다").
 *
 * 묶음 회차 생성(generate_package_sessions)은 겹치는 후보를 conflict로 남기는데, 손으로 만드는
 * 이 경로에는 검사가 없어 같은 학생·같은 시각에 회차가 조용히 두 개 생겼다(실검증에서 확인).
 * 잔액은 계약에 귀속된 쪽만 차감해 안전하지만, 학부모 캘린더·알림에 중복 회차가 나간다.
 *
 * 다른 학생끼리의 시간 충돌은 막지 않는다 — 정본은 충돌을 금지하지 않고(시범 T-02도 목록만
 * 돌려준다) 운영자가 판단할 몫이다. 여기서 막는 건 "한 학생이 같은 시각에 두 번"뿐이다.
 *
 * ends_at이 있는 회차는 구간으로, 없는 회차는 시각으로 본다 — 손으로 만든 회차엔 길이가 없다.
 */
async function findStudentOverlap(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  studentId: string,
  at: Date,
): Promise<string | null> {
  // 가장 긴 수업을 넘겨 잡아 후보를 좁힌 뒤, 겹침 판정은 아래에서 정확히 한다.
  const WINDOW_MS = 12 * 60 * 60 * 1000;
  const { data, error } = await db
    .from("schedules")
    .select("scheduled_at, ends_at")
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId)
    .in("status", ["planned", "makeup"])
    .gte("scheduled_at", new Date(at.getTime() - WINDOW_MS).toISOString())
    .lte("scheduled_at", new Date(at.getTime() + WINDOW_MS).toISOString());
  if (error) {
    // 검사에 실패했다고 등록을 막지는 않는다 — 중복은 되돌릴 수 있고 등록 불가는 되돌릴 수 없다.
    console.error("[schedules] overlap scan failed", error);
    return null;
  }

  const t = at.getTime();
  for (const row of (data ?? []) as { scheduled_at: string; ends_at: string | null }[]) {
    const start = new Date(row.scheduled_at).getTime();
    const end = row.ends_at ? new Date(row.ends_at).getTime() : start;
    if (t === start || (t > start && t < end)) {
      return formatKDateTime(row.scheduled_at);
    }
  }
  return null;
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

  // L-08 "제한은 새 예약·추가 자리 제안에만 적용한다": 예약 위험이 확정된 학생에게는 새 회차를
  // 잡지 않는다. 기존 확정 수업·보강(원 회차의 대체)·학습기록·정산 접근은 건드리지 않으므로
  // 이 게이트는 '새 예약'인 여기와 묶음 회차 생성·자리 제안에만 있다.
  if (await hasActiveBookingRestriction(session.tenantId, studentId)) {
    return {
      ok: false,
      error: "예약이 제한된 학생입니다. 출결·정정 화면에서 제한을 검토·해제한 뒤 예약하세요.",
    };
  }

  // 운영자가 친 "19:01"은 KST 19:01이다 — 서버가 UTC라 new Date()로 파싱하면 9시간 늦게 저장된다.
  const scheduledAt = parseKstWallClock(scheduledAtRaw);
  if (!scheduledAt) {
    return { ok: false, error: "올바르지 않은 일시입니다." };
  }

  const classType: ClassType = VALID_CLASS_TYPES.includes(classTypeRaw as ClassType)
    ? (classTypeRaw as ClassType)
    : "inperson";

  const db = createServiceClient()!;

  const overlap = await findStudentOverlap(db, session.tenantId, studentId, scheduledAt);
  if (overlap) {
    return {
      ok: false,
      error: `이 학생은 ${overlap} 회차와 시간이 겹칩니다. 기존 회차를 취소·보강으로 정리하거나 다른 시각을 골라 주세요.`,
    };
  }
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

  // M3 이후 회차의 상태는 출결·차감 판정의 결과다. 이 레거시 드롭다운은 그 판정을 거치지 않는
  // bare UPDATE라서, 묶음에 묶인 회차를 여기서 '완료'로 바꾸면 settle_attendance는 status가
  // planned/makeup이 아니라 거부하고 정정은 attendance가 null이라 거부해, 그 회차가 출결·잔액
  // 흐름에서 영구히 이탈한다(L-03 "기록 미완료: 회차 후속을 닫지 않는다"). 그래서 묶음 회차는
  // 회차 상세의 출결 확정·취소 경로로만 닫는다. 묶음에 묶이지 않은 옛 일정은 종전대로 둔다.
  const { data: current } = await db
    .from("schedules")
    .select("package_id, attendance, deduction_state")
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!current) return { ok: false, error: "일정을 찾을 수 없습니다." };
  const row = current as {
    package_id: string | null;
    attendance: string | null;
    deduction_state: string;
  };
  if (row.package_id !== null || row.attendance !== null || row.deduction_state !== "none") {
    return {
      ok: false,
      error: "수업 묶음 회차입니다. 회차 상세에서 출결 확정·취소로 처리해 주세요.",
    };
  }

  const { error } = await db
    .from("schedules")
    .update({ status })
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    // 조회와 갱신 사이에 출결이 확정될 수 있다 — 조건을 갱신 자체에 실어 창을 닫는다.
    .is("package_id", null)
    .is("attendance", null)
    .eq("deduction_state", "none");
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
