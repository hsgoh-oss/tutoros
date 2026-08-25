"use server";

// 출결·보강·정정·예약 제한 서버 액션 (M3 · L-03~L-06 · L-08 · L-10).
//
// 이 파일의 모든 전환은 00020의 RPC를 거친다. 이유는 하나다 — 조건 확인과 상태 변경이 두
// 문장으로 나뉘면 그 사이에 조건이 뒤집힌다(출결이 먼저 확정되거나, 보강이 먼저 잡히거나,
// 계약 귀속이 먼저 정정된다). RPC는 조건을 UPDATE의 WHERE에 넣어 그 창을 없앤다.
//
// 잔액을 움직이는 전환(차감을 동반하는 출결 확정·취소, 정정 승인)은 runCritical로 감싼다:
// 감사 기록이 먼저 남지 않으면 잔액을 건드리지 않는다(fail-closed).

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { logActivity, runCritical } from "@/lib/data/activity";
import type { CrmActionResult } from "@/components/admin/crm/types";
import type { Attendance } from "@/lib/types";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";

const ATTENDANCE_VALUES: Attendance[] = [
  "present",
  "late",
  "early_leave",
  "excused_absence",
  "absent",
  "noshow",
];

function revalidateAll(scheduleId?: string) {
  revalidatePath("/admin/schedules");
  revalidatePath("/admin/packages");
  revalidatePath("/admin/attendance");
  if (scheduleId) revalidatePath(`/admin/schedules/${scheduleId}`);
}

function rpcMessage(reason: string | undefined, map: Record<string, string>, fallback: string) {
  return map[reason ?? ""] ?? fallback;
}

const SETTLE_ERRORS: Record<string, string> = {
  not_found: "일정을 찾을 수 없습니다.",
  not_started: "아직 시작하지 않은 회차입니다. 사전 변경은 취소·보강으로 처리하세요.",
  invalid_attendance: "올바르지 않은 출결 값입니다.",
  noshow_contacts_incomplete:
    "노쇼 확정에는 10·20·30분 연락 기록이 모두 있어야 하고 전부 무응답이어야 합니다.",
  noshow_too_early: "수업 시작 30분이 지나야 노쇼로 확정할 수 있습니다.",
  gate:
    "확정할 수 없습니다 — 이미 출결이 확정됐거나, 계약 귀속이 미확정이거나, 묶음이 종료됐거나, 활성 보강이 있는 회차입니다.",
};

/**
 * 출결 확정(L-03·L-04). 회차당 한 번만 통과한다 — 바꾸려면 정정 흐름을 거친다.
 * 차감 여부는 운영자가 정하고, 차감 가능 여부(귀속·보강)는 RPC가 판정한다.
 */
export async function settleAttendance(
  scheduleId: string,
  form: FormData,
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const attendance = String(form.get("attendance") ?? "") as Attendance;
  if (!ATTENDANCE_VALUES.includes(attendance)) {
    return { ok: false, error: "출결을 선택해 주세요." };
  }
  const deduct = String(form.get("deduct") ?? "") === "on";
  const reason = String(form.get("reason") ?? "").trim();

  // L-04 주 전환: 지각은 "실제 시작 기록", 조퇴는 "실제 종료 기록"을 거쳐 진행된다.
  // 해당 출결이 아닌데 들어온 값은 무시한다 — 출석 회차에 실제 종료만 남는 기록은 뜻이 없다.
  const parseStamp = (key: string): string | null => {
    const raw = String(form.get(key) ?? "").trim();
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  const actualStartedAt = attendance === "late" ? parseStamp("actualStartedAt") : null;
  const actualEndedAt = attendance === "early_leave" ? parseStamp("actualEndedAt") : null;
  if (attendance === "late" && !actualStartedAt) {
    return { ok: false, error: "지각은 실제 시작 시각을 함께 기록해야 합니다." };
  }
  if (attendance === "early_leave" && !actualEndedAt) {
    return { ok: false, error: "조퇴는 실제 종료 시각을 함께 기록해야 합니다." };
  }

  const run = async () => {
    const db = createServiceClient()!;
    const { data, error } = await db.rpc("settle_attendance", {
      p_tenant: session.tenantId,
      p_schedule: scheduleId,
      p_attendance: attendance,
      p_deduct: deduct,
      p_reason: reason,
      p_actor: session.email,
      p_actual_started_at: actualStartedAt,
      p_actual_ended_at: actualEndedAt,
    });
    if (error) {
      console.error("[attendance] settle rpc failed", error);
      return { ok: false as const, error: "출결 확정 중 오류가 발생했습니다." };
    }
    const r = (data ?? {}) as { ok?: boolean; reason?: string; remaining?: number };
    if (!r.ok) {
      return {
        ok: false as const,
        error: rpcMessage(r.reason, SETTLE_ERRORS, "출결을 확정할 수 없습니다."),
      };
    }
    revalidateAll(scheduleId);
    return { ok: true as const };
  };

  // 차감 없는 확정은 잔액을 건드리지 않는다 — fail-open 로그로 충분하다.
  if (!deduct) {
    const result = await run();
    if (result.ok) {
      await logActivity(
        session.tenantId,
        session.email,
        "update",
        "schedule",
        scheduleId,
        `출결 확정 → ${attendance} (무차감)`,
      );
    }
    return result;
  }

  return runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "settle",
      targetType: "schedule",
      targetId: scheduleId,
      summary: `출결 확정 → ${attendance} (회차 차감)`,
      category: "money",
      after: { attendance, deduct: true },
      reason: reason || undefined,
    },
    run,
  );
}

/** 회차 취소(L-05). 차감 여부가 곧 정책 판정 결과다. */
export async function cancelSchedule(
  scheduleId: string,
  form: FormData,
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const deduct = String(form.get("deduct") ?? "") === "on";
  const reason = String(form.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: "취소 사유를 입력해 주세요." };

  const run = async () => {
    const db = createServiceClient()!;
    const { data, error } = await db.rpc("cancel_schedule", {
      p_tenant: session.tenantId,
      p_schedule: scheduleId,
      p_deduct: deduct,
      p_reason: reason,
      p_actor: session.email,
    });
    if (error) {
      console.error("[attendance] cancel rpc failed", error);
      return { ok: false as const, error: "취소 중 오류가 발생했습니다." };
    }
    const r = (data ?? {}) as { ok?: boolean; reason?: string };
    if (!r.ok) {
      return {
        ok: false as const,
        error: rpcMessage(
          r.reason,
          {
            reason_required: "취소 사유를 입력해 주세요.",
            gate: "취소할 수 없습니다 — 이미 종료됐거나, 계약 귀속이 미확정이거나, 묶음이 종료됐거나, 활성 보강이 있는 회차입니다.",
          },
          "취소할 수 없는 상태입니다.",
        ),
      };
    }
    revalidateAll(scheduleId);
    return { ok: true as const };
  };

  if (!deduct) {
    const result = await run();
    if (result.ok) {
      await logActivity(
        session.tenantId,
        session.email,
        "update",
        "schedule",
        scheduleId,
        `회차 취소(무차감) — ${reason}`,
      );
    }
    return result;
  }

  return runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "cancel",
      targetType: "schedule",
      targetId: scheduleId,
      summary: "회차 취소(차감)",
      category: "money",
      reason,
    },
    run,
  );
}

/**
 * 보강 생성(L-05). 원 회차 무차감 종료와 대체 회차 생성이 한 문장 안에서 끝난다.
 * 차감은 대체 회차에서 일어나므로 이중 차감이 없다.
 */
export async function createMakeup(
  originId: string,
  form: FormData,
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const at = String(form.get("scheduledAt") ?? "").trim();
  if (!at) return { ok: false, error: "보강 일시를 입력해 주세요." };
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, error: "보강 일시가 올바르지 않습니다." };
  }
  const durationMin = Number(form.get("durationMin") ?? 60);
  const endsAt = new Date(
    parsed.getTime() + (Number.isFinite(durationMin) && durationMin > 0 ? durationMin : 60) * 60_000,
  );
  const reason = String(form.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: "보강 사유를 입력해 주세요." };

  const db = createServiceClient()!;
  const { data, error } = await db.rpc("create_makeup", {
    p_tenant: session.tenantId,
    p_origin: originId,
    p_at: parsed.toISOString(),
    p_ends_at: endsAt.toISOString(),
    p_reason: reason,
    p_actor: session.email,
  });
  if (error) {
    console.error("[attendance] makeup rpc failed", error);
    return { ok: false, error: "보강 생성 중 오류가 발생했습니다." };
  }
  const r = (data ?? {}) as { ok?: boolean; reason?: string };
  if (!r.ok) {
    return {
      ok: false,
      error: rpcMessage(
        r.reason,
        {
          not_found: "원 회차를 찾을 수 없습니다.",
          reason_required: "보강 사유를 입력해 주세요.",
          origin_already_deducted: "이미 차감된 회차는 보강 대상이 아닙니다.",
          origin_not_open: "이미 종료·취소된 회차입니다.",
          conflict: "그 시간에는 이미 다른 수업이 있습니다.",
          makeup_exists: "이 회차에는 이미 활성 보강이 있습니다.",
        },
        "보강을 만들 수 없습니다.",
      ),
    };
  }
  await logActivity(
    session.tenantId,
    session.email,
    "create",
    "schedule",
    originId,
    `보강 생성 — ${reason}`,
  );
  revalidateAll(originId);
  return { ok: true };
}

/**
 * 미참석 연락 기록(L-04). 시각·경로·결과만 남긴다 — 통화 내용은 남기지 않는다.
 * 10·20·30분 각 시점당 한 행이며 수정·삭제가 불가능하다(append-only).
 */
export async function logAttendanceContact(
  scheduleId: string,
  form: FormData,
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const minuteMark = Number(form.get("minuteMark") ?? 0);
  if (![10, 20, 30].includes(minuteMark)) {
    return { ok: false, error: "연락 시점은 10·20·30분 중 하나여야 합니다." };
  }
  const channel = String(form.get("channel") ?? "");
  if (!["call", "sms", "kakao", "other"].includes(channel)) {
    return { ok: false, error: "연락 경로를 선택해 주세요." };
  }
  const result = String(form.get("result") ?? "");
  if (!["no_answer", "reached", "entered"].includes(result)) {
    return { ok: false, error: "연락 결과를 선택해 주세요." };
  }

  const db = createServiceClient()!;
  const { error } = await db.from("attendance_contacts").insert({
    tenant_id: session.tenantId,
    schedule_id: scheduleId,
    minute_mark: minuteMark,
    channel,
    result,
    actor_email: session.email,
  });
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `${minuteMark}분 연락은 이미 기록돼 있습니다.` };
    }
    console.error("[attendance] contact insert failed", error);
    return { ok: false, error: "연락 기록 중 오류가 발생했습니다." };
  }
  revalidateAll(scheduleId);
  return { ok: true };
}

/** 정정 요청 접수(L-06). 심사 중인 정정은 회차당 하나뿐이다(부분 유니크). */
export async function requestCorrection(
  scheduleId: string,
  form: FormData,
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const toAttendance = String(form.get("toAttendance") ?? "") as Attendance;
  if (!ATTENDANCE_VALUES.includes(toAttendance)) {
    return { ok: false, error: "정정할 출결을 선택해 주세요." };
  }
  const requesterRole = String(form.get("requesterRole") ?? "operator");
  if (!["operator", "teacher", "parent", "student"].includes(requesterRole)) {
    return { ok: false, error: "요청 주체를 선택해 주세요." };
  }
  const reason = String(form.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: "정정 사유를 입력해 주세요." };

  const db = createServiceClient()!;
  const { data: sched } = await db
    .from("schedules")
    .select("attendance, deduction_state")
    .eq("tenant_id", session.tenantId)
    .eq("id", scheduleId)
    .maybeSingle();
  if (!sched) return { ok: false, error: "일정을 찾을 수 없습니다." };
  const row = sched as { attendance: Attendance | null; deduction_state: string };
  // 정정은 확정된 출결을 고치는 흐름이다 — 미확정 회차는 출결 확정부터 해야 한다(L-06).
  // 승인 RPC도 같은 조건을 다시 본다(여기 통과 후 확정이 풀릴 창을 막기 위해).
  if (row.attendance === null) {
    return { ok: false, error: "출결이 확정되지 않은 회차입니다. 먼저 출결을 확정하세요." };
  }

  const { error } = await db.from("attendance_corrections").insert({
    tenant_id: session.tenantId,
    schedule_id: scheduleId,
    requester_role: requesterRole,
    requested_by: String(form.get("requestedBy") ?? "").trim() || session.email,
    from_attendance: row.attendance,
    from_deduction: row.deduction_state,
    to_attendance: toAttendance,
    to_deduct: String(form.get("toDeduct") ?? "") === "on",
    reason,
  });
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "이 회차에는 이미 심사 중인 정정 요청이 있습니다." };
    }
    console.error("[attendance] correction insert failed", error);
    return { ok: false, error: "정정 요청 중 오류가 발생했습니다." };
  }
  revalidateAll(scheduleId);
  return { ok: true };
}

/**
 * 정정 승인·거절(L-06). 승인은 원 기입을 고치지 않고 반대 부호 원장 행(조정 이력)을 남긴다.
 * 게시된 보고서·진행 중 환불 영향은 자동으로 되돌리지 않고 업무로 띄운다 — 운영자 판단이다.
 */
export async function decideCorrection(
  correctionId: string,
  form: FormData,
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const approve = String(form.get("decision") ?? "") === "approve";
  const reason = String(form.get("decisionReason") ?? "").trim();
  if (!approve && !reason) return { ok: false, error: "거절 사유를 입력해 주세요." };

  return runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: approve ? "approve" : "reject",
      targetType: "attendance_correction",
      targetId: correctionId,
      summary: `출결 정정 ${approve ? "승인" : "거절"}`,
      category: "money",
      reason: reason || undefined,
    },
    async () => {
      const db = createServiceClient()!;
      const { data, error } = await db.rpc("decide_attendance_correction", {
        p_tenant: session.tenantId,
        p_correction: correctionId,
        p_approve: approve,
        p_decider: session.email,
        p_reason: reason,
      });
      if (error) {
        console.error("[attendance] correction decide rpc failed", error);
        return { ok: false as const, error: "정정 처리 중 오류가 발생했습니다." };
      }
      const r = (data ?? {}) as { ok?: boolean; reason?: string };
      if (!r.ok) {
        return {
          ok: false as const,
          error: rpcMessage(
            r.reason,
            {
              not_pending: "이미 처리된 정정 요청입니다.",
              schedule_missing: "원 회차를 찾을 수 없습니다.",
              not_settled: "출결이 확정되지 않은 회차는 정정 승인 대상이 아닙니다.",
              noshow_gate:
                "노쇼로 정정하려면 10·20·30분 연락이 모두 무응답이고 수업 시작 30분이 지나야 합니다.",
              reason_required: "거절 사유를 입력해 주세요.",
            },
            "정정을 처리할 수 없습니다.",
          ),
        };
      }
      revalidateAll();
      return { ok: true as const };
    },
  );
}

/**
 * 계약 귀속 확정(L-10). 운영자가 고른 계약을 그대로 적지 않는다 — RPC가 후보를 다시 계산해
 * 정확히 하나이고 그것과 일치할 때만 확정한다(임의 귀속 금지).
 */
export async function resolveScheduleContract(
  scheduleId: string,
  form: FormData,
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  const contractId = String(form.get("contractId") ?? "").trim();
  if (!contractId) return { ok: false, error: "계약을 선택해 주세요." };

  const db = createServiceClient()!;
  const { data, error } = await db.rpc("resolve_schedule_contract", {
    p_tenant: session.tenantId,
    p_schedule: scheduleId,
    p_contract: contractId,
    p_actor: session.email,
  });
  if (error) {
    console.error("[attendance] resolve contract rpc failed", error);
    return { ok: false, error: "귀속 확정 중 오류가 발생했습니다." };
  }
  const r = (data ?? {}) as { ok?: boolean; reason?: string };
  if (!r.ok) {
    return {
      ok: false,
      error: rpcMessage(
        r.reason,
        {
          not_found: "일정을 찾을 수 없습니다.",
          already_resolved: "이미 귀속이 확정된 회차입니다.",
          origin_unresolved: "원 회차의 귀속을 먼저 확정해야 합니다.",
          no_candidate: "이 회차 시각을 포함하는 동의된 계약이 없습니다. 등록 기간·계약을 먼저 정정하세요.",
          ambiguous: "유효 계약 후보가 둘 이상입니다. 계약 원장·기간을 먼저 정정하세요.",
          not_a_candidate: "선택한 계약은 이 회차의 유효 후보가 아닙니다.",
          raced: "다른 처리와 겹쳤습니다. 다시 조회한 뒤 시도해 주세요.",
        },
        "귀속을 확정할 수 없습니다.",
      ),
    };
  }
  await logActivity(
    session.tenantId,
    session.email,
    "update",
    "schedule",
    scheduleId,
    "계약 귀속 확정",
  );
  revalidateAll(scheduleId);
  return { ok: true };
}

/**
 * 예약 제한(L-08). 반복 노쇼 누적은 검토 업무만 만들고 제한은 여기서만 생긴다 — 자동 제한 금지.
 * 제한은 새 예약·추가 자리 제안만 막고 기존 확정 수업·학습기록·정산 접근은 건드리지 않는다.
 */
export async function restrictBooking(
  studentId: string,
  form: FormData,
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  const reason = String(form.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: "제한 사유를 입력해 주세요." };
  const reviewOn = String(form.get("reviewOn") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewOn)) {
    return { ok: false, error: "재검토일을 입력해 주세요." };
  }

  return runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "restrict",
      targetType: "student",
      targetId: studentId,
      summary: "예약 위험 확정 — 신규 예약 제한",
      category: "permission",
      after: { reviewOn },
      reason,
    },
    async () => {
      const db = createServiceClient()!;
      const { error } = await db.from("booking_restrictions").insert({
        tenant_id: session.tenantId,
        student_id: studentId,
        reason,
        review_on: reviewOn,
        decided_by: session.email,
      });
      if (error) {
        if (error.code === "23505") {
          return { ok: false as const, error: "이 학생에게는 이미 활성 제한이 있습니다." };
        }
        console.error("[attendance] restriction insert failed", error);
        return { ok: false as const, error: "제한 설정 중 오류가 발생했습니다." };
      }
      // 검토 업무가 열려 있었다면 판단이 끝난 것이다.
      await db
        .from("work_items")
        .update({
          status: "done",
          resolution: "예약 위험 확정 — 신규 예약 제한",
          resolved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", session.tenantId)
        .eq("kind", "booking_risk_review")
        .eq("source_type", "student")
        .eq("source_id", studentId)
        .in("status", ["open", "in_progress"]);
      revalidatePath("/admin/attendance");
      return { ok: true as const };
    },
  );
}

/** 제한 해제(L-08 이의 처리·재검토 결과). 자동 만료는 없다 — 해제도 사람이 한다. */
export async function liftBookingRestriction(
  restrictionId: string,
  form: FormData,
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  const reason = String(form.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: "해제 사유를 입력해 주세요." };

  return runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "unrestrict",
      targetType: "booking_restriction",
      targetId: restrictionId,
      summary: "예약 제한 해제",
      category: "permission",
      reason,
    },
    async () => {
      const db = createServiceClient()!;
      const { data, error } = await db
        .from("booking_restrictions")
        .update({
          status: "lifted",
          lifted_by: session.email,
          lifted_at: new Date().toISOString(),
          lift_reason: reason,
        })
        .eq("tenant_id", session.tenantId)
        .eq("id", restrictionId)
        .eq("status", "active")
        .select("id");
      if (error) {
        console.error("[attendance] restriction lift failed", error);
        return { ok: false as const, error: "해제 중 오류가 발생했습니다." };
      }
      if (!data || data.length === 0) {
        return { ok: false as const, error: "이미 해제된 제한입니다." };
      }
      revalidatePath("/admin/attendance");
      return { ok: true as const };
    },
  );
}

/** 예약 위험 검토를 "제한 없음"으로 종결(L-08 운영자 판단 분기). */
export async function dismissBookingRisk(
  studentId: string,
  form: FormData,
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  const reason = String(form.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: "판단 사유를 입력해 주세요." };

  const db = createServiceClient()!;
  const { data, error } = await db
    .from("work_items")
    .update({
      status: "dismissed",
      resolution: `제한 없음 — ${reason}`,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", session.tenantId)
    .eq("kind", "booking_risk_review")
    .eq("source_type", "student")
    .eq("source_id", studentId)
    .in("status", ["open", "in_progress"])
    .select("id");
  if (error) {
    console.error("[attendance] risk dismiss failed", error);
    return { ok: false, error: "처리 중 오류가 발생했습니다." };
  }
  if (!data || data.length === 0) return { ok: false, error: "열린 검토 업무가 없습니다." };
  await logActivity(
    session.tenantId,
    session.email,
    "update",
    "student",
    studentId,
    `예약 위험 검토 종결(제한 없음) — ${reason}`,
  );
  revalidatePath("/admin/attendance");
  return { ok: true };
}
