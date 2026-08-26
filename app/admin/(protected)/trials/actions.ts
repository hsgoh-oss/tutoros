"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { parseKstWallClock } from "@/lib/kst";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { formatKDateTime, getConsultation, getPayment } from "@/lib/data/crm";
import { getTrialSession } from "@/lib/data/intake";
import { logActivity, runCritical } from "@/lib/data/activity";
import { sendNotification } from "@/lib/notify/send";
import { renderTemplate } from "@/lib/notify/templates";
import type { CrmActionResult } from "@/components/admin/crm/types";
import type { TrialStatus } from "@/lib/types";
import {
  AUDIT_MONEY,
  AUDIT_OTHER,
  isNoshowContactMinute,
  isTrialCancelFault,
  isTrialResult,
  noshowContactAction,
  NOSHOW_CONFIRM_AFTER_MINUTES,
  NOSHOW_CONTACT_MINUTES,
  SCHEDULE_CONFLICT_WINDOW_MINUTES,
  trialCancelFaultLabel,
  trialResultLabel,
} from "./constants";

// 시범수업 서버 액션 (T-02 · T-03 · T-04) — 정본: docs/flow-canon/01_atlas_01_intake.md,
// 03_scenarios_133.md 검수 8·9·10·11.
//
// 규율(이 파일 전체에 적용):
//  ① 상태 전환은 전부 runCritical로 감싼다 — 감사 선기록(pending)이 남지 않으면 전환을
//     실행하지 않는다(fail-closed). 카테고리는 기본 'other'이고, 금전 판단에 직접 연결되는
//     전환(유료 여부·결제 확인·취소·노쇼 확정)만 'money'다.
//  ② 모든 UPDATE는 조건부다 — 기대 상태를 WHERE에 넣고 `.select().maybeSingle()`로 실제
//     갱신 여부를 확인한다. 읽고→판단하고→쓰는 사이에 다른 탭·다른 운영자가 상태를 바꿔도
//     반쪽 전환이 생기지 않는다(검수 8·9의 게이트가 조회 시점 값으로 통과되는 것을 막는다).
//  ③ 자동 판정 금지(T-04·검수 10) — 결과 결정과 노쇼 확정은 사람이 누른 것만 기록한다.
//     노쇼는 10·20·30분 연락 기록 3건이 모두 남고 30분이 지난 뒤에만 확정할 수 있다.
//  ④ 안내 실패는 회차를 되돌리지 않는다(T-02 예외) — 발송 실패는 notifications 큐와
//     전달 실패 업무가 수렴시키고, 확정 자체는 유지한다.

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";
const RACE_ERROR =
  "다른 곳에서 이미 상태가 바뀌었습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.";

/** 일정 충돌 경고를 담아 돌려주는 결과 — conflicts가 있으면 화면이 강행 여부를 묻는다. */
export interface TrialActionResult extends CrmActionResult {
  /** 같은 시각 ±1시간 안에 있는 기존 일정 설명. 비어 있지 않으면 확인이 필요하다는 뜻. */
  conflicts?: string[];
  /** 성공 후 옮겨 갈 곳 — 재예약처럼 "지금 보던 회차가 더 이상 진행 대상이 아닌" 경우에만 채운다. */
  redirectPath?: string;
}

function revalidateTrials(id?: string) {
  revalidatePath("/admin/trials");
  if (id) revalidatePath(`/admin/trials/${id}`);
}

/** datetime-local 입력(KST 벽시계) 파싱 — schedules/actions.ts createSchedule과 같은 규약. */
function parseDateTime(raw: string): Date | null {
  return parseKstWallClock(raw);
}

type Db = NonNullable<ReturnType<typeof createServiceClient>>;

/**
 * 같은 시각 ±1시간 충돌 확인(T-02 "충돌 확인").
 * 기존 수업 일정(schedules)과 다른 시범 회차를 함께 본다 — 둘 다 운영자의 같은 시간을 쓴다.
 * 판정은 하지 않는다: 목록만 돌려주고 강행 여부는 운영자가 고른다(정본은 충돌을 금지하지 않는다).
 */
async function findScheduleConflicts(
  db: Db,
  tenantId: string,
  at: Date,
  excludeTrialId?: string,
): Promise<string[]> {
  const windowMs = SCHEDULE_CONFLICT_WINDOW_MINUTES * 60 * 1000;
  const from = new Date(at.getTime() - windowMs).toISOString();
  const to = new Date(at.getTime() + windowMs).toISOString();
  const conflicts: string[] = [];

  const { data: schedules, error: scheduleError } = await db
    .from("schedules")
    .select("id, scheduled_at, students(name)")
    .eq("tenant_id", tenantId)
    .in("status", ["planned", "makeup"])
    .gte("scheduled_at", from)
    .lte("scheduled_at", to);
  if (scheduleError) console.error("[trials] conflict scan(schedules) failed", scheduleError);
  for (const r of (schedules ?? []) as unknown as {
    id: string;
    scheduled_at: string;
    students: { name: string } | null;
  }[]) {
    conflicts.push(
      `수업 일정 — ${r.students?.name ?? "학생 미상"} ${formatKDateTime(r.scheduled_at)}`,
    );
  }

  const { data: trials, error: trialError } = await db
    .from("trial_sessions")
    .select("id, scheduled_at, consultation_id")
    .eq("tenant_id", tenantId)
    .in("status", ["proposed", "scheduled"])
    .gte("scheduled_at", from)
    .lte("scheduled_at", to);
  if (trialError) console.error("[trials] conflict scan(trials) failed", trialError);
  const trialRows = ((trials ?? []) as { id: string; scheduled_at: string | null }[]).filter(
    (r) => r.id !== excludeTrialId,
  );
  for (const r of trialRows) {
    conflicts.push(`시범 회차 — ${formatKDateTime(r.scheduled_at)}`);
  }

  return conflicts;
}

/** 회차 1건을 테넌트 스코프로 읽는다(전환 전 상태 확인용). */
async function loadSession(db: Db, tenantId: string, id: string) {
  const { data, error } = await db
    .from("trial_sessions")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) console.error("[trials] session fetch failed", error);
  return (data ?? null) as {
    id: string;
    consultation_id: string;
    form_id: string | null;
    scheduled_at: string | null;
    is_paid: boolean;
    payment_id: string | null;
    schedule_confirmed: boolean;
    payment_confirmed: boolean;
    status: TrialStatus;
  } | null;
}

/**
 * 조건부 UPDATE 실행기 — 기대 조건(match)이 그대로일 때만 갱신하고, 아니면 경합으로 본다.
 * 반환값이 ok:false면 호출부(runCritical)가 감사 기록을 aborted로 닫는다.
 */
async function conditionalUpdate(
  db: Db,
  tenantId: string,
  id: string,
  patch: Record<string, unknown>,
  match: Record<string, unknown>,
): Promise<CrmActionResult> {
  const { data, error } = await db
    .from("trial_sessions")
    .update(patch)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .match(match)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[trials] conditional update failed", error);
    return { ok: false, error: "저장 중 오류가 발생했습니다." };
  }
  if (!data) return { ok: false, error: RACE_ERROR };
  return { ok: true };
}

/* ---------- ① 회차 생성 (T-02 진입 · 검수 6) ---------- */

/**
 * 시범 회차 제안 생성.
 * 검수 6("동시에 활성화되는 다음 단계는 하나")을 이 화면 몫만큼 지킨다 — 같은 상담에 이미
 * 진행 중(proposed·scheduled)인 회차가 있으면 새로 만들지 않고 그 회차로 보낸다.
 * 재예약은 이 액션이 아니라 rescheduleTrial(기존 회차를 닫고 새 회차)을 쓴다(T-03).
 */
export async function createTrialSession(formData: FormData): Promise<TrialActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const consultationId = String(formData.get("consultationId") ?? "").trim();
  const isPaid = String(formData.get("isPaid") ?? "") === "1";
  if (!consultationId) return { ok: false, error: "상담을 선택해 주세요." };

  const consultation = await getConsultation(session.tenantId, consultationId);
  if (!consultation) return { ok: false, error: "상담 정보를 찾을 수 없습니다." };

  const db = createServiceClient()!;
  const { data: active, error: activeError } = await db
    .from("trial_sessions")
    .select("id")
    .eq("tenant_id", session.tenantId)
    .eq("consultation_id", consultationId)
    .in("status", ["proposed", "scheduled"])
    .limit(1);
  if (activeError) {
    console.error("[trials] active session scan failed", activeError);
    return { ok: false, error: "진행 중인 회차 확인에 실패했습니다." };
  }
  if (active && active.length > 0) {
    return {
      ok: false,
      error: "이 상담에는 이미 진행 중인 시범 회차가 있습니다 — 그 회차를 닫거나 재예약해 주세요.",
    };
  }

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "trial_propose",
      targetType: "trial_session",
      targetId: null, // insert 전 선기록이라 새 회차 id는 아직 없다 — after로 식별한다.
      summary: `시범 회차 제안 생성 (${consultation.name})`,
      category: AUDIT_OTHER,
      after: { consultation_id: consultationId, is_paid: isPaid, status: "proposed" },
    },
    async (): Promise<CrmActionResult & { id?: string }> => {
      const { data, error } = await db
        .from("trial_sessions")
        .insert({
          tenant_id: session.tenantId,
          consultation_id: consultationId,
          is_paid: isPaid,
          // 무료 시범은 결제 단계를 '통과 처리'하는 게 아니라 결제가 불필요한 것이다(T-02 예외).
          // 근거는 is_paid=false로 남고, payment_confirmed는 게이트 계산상 켜 둔다.
          payment_confirmed: !isPaid,
          status: "proposed",
        })
        .select("id")
        .single();
      if (error || !data) {
        console.error("[trials] insert failed", error);
        return { ok: false, error: "시범 회차 생성 중 오류가 발생했습니다." };
      }
      return { ok: true, id: (data as { id: string }).id };
    },
  );

  if (!result.ok) return result;
  revalidateTrials();
  return { ok: true };
}

/* ---------- ② 일정 합의 (T-02 · 검수 8) ---------- */

/**
 * 일정 합의 저장 — 일시 입력 + 합의 여부.
 * 확정(status=scheduled)은 여기서 하지 않는다: 일정과 결제 두 게이트가 모두 선 뒤 confirmTrial이
 * 한다(검수 8 "폼 제출·일시 입력만으로 일정이 확정되지 않는다").
 * 이미 확정된 회차의 일시 변경은 재예약 흐름이다(T-03) — 여기서는 제안 상태만 받는다.
 */
export async function saveTrialSchedule(formData: FormData): Promise<TrialActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "").trim();
  const scheduledAtRaw = String(formData.get("scheduledAt") ?? "").trim();
  const agreed = String(formData.get("agreed") ?? "") === "1";
  const force = String(formData.get("force") ?? "") === "1";
  if (!id) return { ok: false, error: "잘못된 요청입니다." };
  if (!scheduledAtRaw) return { ok: false, error: "일시를 입력해 주세요." };

  const scheduledAt = parseDateTime(scheduledAtRaw);
  if (!scheduledAt) return { ok: false, error: "올바르지 않은 일시입니다." };

  const db = createServiceClient()!;
  const current = await loadSession(db, session.tenantId, id);
  if (!current) return { ok: false, error: "시범 회차를 찾을 수 없습니다." };
  if (current.status !== "proposed") {
    return {
      ok: false,
      error: "제안 상태에서만 일정을 고칠 수 있습니다 — 확정된 회차는 재예약으로 변경하세요.",
    };
  }

  // 충돌은 감사 기록을 만들기 전에 본다 — 되돌아가 다시 고를 수 있는 경고이지 전환이 아니다.
  if (!force) {
    const conflicts = await findScheduleConflicts(db, session.tenantId, scheduledAt, id);
    if (conflicts.length > 0) {
      return {
        ok: false,
        error: "같은 시각 앞뒤 1시간 안에 다른 일정이 있습니다. 확인 후 진행 여부를 선택해 주세요.",
        conflicts,
      };
    }
  }

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "trial_schedule",
      targetType: "trial_session",
      targetId: id,
      summary: `시범 일정 ${agreed ? "합의" : "저장"} (${formatKDateTime(scheduledAt.toISOString())})`,
      category: AUDIT_OTHER,
      before: {
        scheduled_at: current.scheduled_at,
        schedule_confirmed: current.schedule_confirmed,
      },
      after: { scheduled_at: scheduledAt.toISOString(), schedule_confirmed: agreed },
      reason: force ? "일정 충돌 경고 확인 후 강행" : undefined,
    },
    () =>
      conditionalUpdate(
        db,
        session.tenantId,
        id,
        { scheduled_at: scheduledAt.toISOString(), schedule_confirmed: agreed },
        { status: "proposed" },
      ),
  );

  if (!result.ok) return result;
  revalidateTrials(id);
  return { ok: true };
}

/* ---------- ③ 유료 여부·청구 연결·결제 확인 (T-02 · 검수 9) ---------- */

/**
 * 유료 시범 여부 전환.
 * 유료로 바꾸면 결제 확인은 초기화된다 — 청구를 연결하고 완납을 확인해야 다시 선다(검수 9).
 * 무료로 바꾸면 payment_confirmed는 켜지되 is_paid=false가 "결제 불필요"라는 근거로 남고,
 * 연결돼 있던 청구는 끊는다(무료 회차에 청구가 매달려 있으면 대사 때 판단이 흔들린다).
 */
export async function setTrialPaid(formData: FormData): Promise<TrialActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "").trim();
  const isPaid = String(formData.get("isPaid") ?? "") === "1";
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  const db = createServiceClient()!;
  const current = await loadSession(db, session.tenantId, id);
  if (!current) return { ok: false, error: "시범 회차를 찾을 수 없습니다." };
  if (current.status !== "proposed") {
    return { ok: false, error: "제안 상태에서만 유료 여부를 바꿀 수 있습니다." };
  }
  if (current.is_paid === isPaid) return { ok: true };

  const patch = isPaid
    ? { is_paid: true, payment_confirmed: false }
    : { is_paid: false, payment_confirmed: true, payment_id: null };

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "trial_set_paid",
      targetType: "trial_session",
      targetId: id,
      summary: isPaid ? "시범 유료 전환 — 결제 확인 필요" : "시범 무료 전환 — 결제 불필요",
      category: AUDIT_MONEY,
      before: {
        is_paid: current.is_paid,
        payment_id: current.payment_id,
        payment_confirmed: current.payment_confirmed,
      },
      after: patch,
    },
    () => conditionalUpdate(db, session.tenantId, id, patch, { status: "proposed", is_paid: current.is_paid }),
  );

  if (!result.ok) return result;
  revalidateTrials(id);
  return { ok: true };
}

/**
 * 유료 시범의 청구 연결·해제.
 * 새 청구 생성은 결제 관리(payments) 몫이라 여기서는 기존 청구를 고르기만 한다 —
 * 화면이 "결제 관리에서 청구 만들기" 링크로 안내한다.
 * 해제하면 결제 확인도 함께 내린다: 근거가 사라진 확인은 확인이 아니다(검수 9).
 */
export async function linkTrialPayment(formData: FormData): Promise<TrialActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "").trim();
  const paymentId = String(formData.get("paymentId") ?? "").trim();
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  const db = createServiceClient()!;
  const current = await loadSession(db, session.tenantId, id);
  if (!current) return { ok: false, error: "시범 회차를 찾을 수 없습니다." };
  if (current.status !== "proposed") {
    return { ok: false, error: "제안 상태에서만 청구를 연결할 수 있습니다." };
  }
  if (!current.is_paid) {
    return { ok: false, error: "무료 시범에는 청구를 연결하지 않습니다 — 먼저 유료로 전환하세요." };
  }
  // 사용자 입력 id — 현재 테넌트의 청구일 때만 연결한다(타 테넌트 UUID 연결 차단).
  if (paymentId) {
    const payment = await getPayment(session.tenantId, paymentId);
    if (!payment) return { ok: false, error: "청구 정보를 찾을 수 없습니다." };
  }
  if ((paymentId || null) === current.payment_id) return { ok: true };

  // 연결이 바뀌면 결제 확인은 반드시 내려간다 — 확인은 특정 청구에 대한 판단이라,
  // 다른 청구로 갈아 끼운 뒤에도 확인이 남아 있으면 근거 없는 확정이 된다(검수 9).
  const patch = paymentId
    ? { payment_id: paymentId, payment_confirmed: false }
    : { payment_id: null, payment_confirmed: false };

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: paymentId ? "trial_link_payment" : "trial_unlink_payment",
      targetType: "trial_session",
      targetId: id,
      summary: paymentId ? "시범 청구 연결" : "시범 청구 연결 해제 — 결제 확인 해제",
      category: AUDIT_MONEY,
      before: { payment_id: current.payment_id, payment_confirmed: current.payment_confirmed },
      after: patch,
    },
    () => conditionalUpdate(db, session.tenantId, id, patch, { status: "proposed", is_paid: true }),
  );

  if (!result.ok) return result;
  revalidateTrials(id);
  return { ok: true };
}

/**
 * 결제 확인(유료 시범).
 * 연결된 청구가 완납(paid)일 때만 확인이 선다 — 검수 14의 "결제가 불명확하면 확정 수업으로
 * 안내하지 않는다"를 게이트 앞단에서 지킨다. 현금 수납 등은 결제 관리에서 완납 처리한 뒤 확인한다.
 */
export async function confirmTrialPayment(id: string): Promise<TrialActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  const db = createServiceClient()!;
  const current = await loadSession(db, session.tenantId, id);
  if (!current) return { ok: false, error: "시범 회차를 찾을 수 없습니다." };
  if (current.status !== "proposed") {
    return { ok: false, error: "제안 상태에서만 결제를 확인할 수 있습니다." };
  }
  if (!current.is_paid) return { ok: false, error: "무료 시범은 결제 확인 대상이 아닙니다." };
  if (!current.payment_id) return { ok: false, error: "먼저 청구를 연결해 주세요." };

  const payment = await getPayment(session.tenantId, current.payment_id);
  if (!payment) return { ok: false, error: "연결된 청구 정보를 찾을 수 없습니다." };
  if (payment.status !== "paid") {
    return {
      ok: false,
      error: "연결된 청구가 아직 완납이 아닙니다 — 결제 관리에서 완납 처리 후 확인해 주세요.",
    };
  }

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "trial_confirm_payment",
      targetType: "trial_session",
      targetId: id,
      summary: "시범 결제 확인",
      category: AUDIT_MONEY,
      before: { payment_confirmed: false },
      after: { payment_confirmed: true, payment_id: current.payment_id },
    },
    () =>
      conditionalUpdate(
        db,
        session.tenantId,
        id,
        { payment_confirmed: true },
        { status: "proposed", is_paid: true, payment_id: current.payment_id, payment_confirmed: false },
      ),
  );

  if (!result.ok) return result;
  revalidateTrials(id);
  return { ok: true };
}

/* ---------- ④ 시범 확정 (T-02 결과물: 확정 회차 1개) ---------- */

/**
 * 시범 확정 — 두 게이트가 모두 선 회차만 proposed→scheduled.
 * 게이트 조건을 UPDATE의 WHERE에 그대로 넣는다: 조회 시점에 통과였어도 갱신 시점에 뒤집혔으면
 * 확정되지 않는다(검수 8·9의 반쪽 확정 금지). DB CHECK도 같은 조건을 다시 본다(00018).
 * 확정 후 안내 발송은 실패해도 확정을 되돌리지 않는다(T-02 예외 — 회차 유지·전달 재시도).
 */
export async function confirmTrial(id: string): Promise<TrialActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  const db = createServiceClient()!;
  const current = await loadSession(db, session.tenantId, id);
  if (!current) return { ok: false, error: "시범 회차를 찾을 수 없습니다." };
  if (current.status !== "proposed") return { ok: false, error: "제안 상태의 회차만 확정할 수 있습니다." };
  if (!current.scheduled_at || !current.schedule_confirmed) {
    return { ok: false, error: "일정 합의가 끝나야 확정할 수 있습니다(결제 대기가 아니라 일정 확정 대기)." };
  }
  if (current.is_paid && !current.payment_confirmed) {
    return { ok: false, error: "결제 확인이 끝나야 확정할 수 있습니다 — 지금은 결제 대기 상태입니다." };
  }

  // 유료: 결제 확인이 선 채로 남아 있는지를 WHERE로 다시 본다(금전 게이트는 조회 시점을 믿지 않는다).
  // 무료: 결제 단계를 통과 처리하는 게 아니라 결제 불필요를 근거로 함께 기록한다 — is_paid=false가
  //       그 근거로 남고, 다른 경로로 만들어져 근거가 비어 있던 회차도 여기서 채워진다(T-02 예외).
  const patch = current.is_paid
    ? { status: "scheduled" }
    : { status: "scheduled", payment_confirmed: true };
  const match = current.is_paid
    ? { status: "proposed", is_paid: true, schedule_confirmed: true, payment_confirmed: true }
    : { status: "proposed", is_paid: false, schedule_confirmed: true };

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "trial_confirm",
      targetType: "trial_session",
      targetId: id,
      summary: `시범 확정 (${formatKDateTime(current.scheduled_at)})`,
      category: AUDIT_OTHER,
      before: { status: "proposed" },
      after: {
        status: "scheduled",
        scheduled_at: current.scheduled_at,
        is_paid: current.is_paid,
        payment_id: current.payment_id,
        payment_basis: current.is_paid ? "결제 확인" : "결제 불필요(무료 시범)",
      },
    },
    () => conditionalUpdate(db, session.tenantId, id, patch, match),
  );
  if (!result.ok) return result;

  // 상담 상태 미러 — 정본은 시범 회차이고 consultations.status는 기존 화면 호환 표시다.
  // 이미 등록(registered)으로 넘어간 상담은 되돌리지 않는다(조건부 update).
  const { error: consultationError } = await db
    .from("consultations")
    .update({ status: "trial" })
    .eq("tenant_id", session.tenantId)
    .eq("id", current.consultation_id)
    .in("status", ["new", "contacted", "hold"]);
  if (consultationError) console.error("[trials] consultation mirror failed", consultationError);

  await notifyTrialConfirmed(session.tenantId, current.consultation_id, current.scheduled_at);

  revalidateTrials(id);
  revalidatePath(`/admin/consultations/${current.consultation_id}`);
  return { ok: true };
}

/**
 * 시범 확정 안내 발송(trial_confirmed).
 * 실패해도 예외를 올리지 않는다 — 발송 실패는 notifications 큐·전달 실패 업무로 수렴하고
 * 회차는 확정 상태를 유지한다(T-02 "안내 실패: 회차는 유지하고 전달 재시도").
 */
async function notifyTrialConfirmed(
  tenantId: string,
  consultationId: string,
  scheduledAt: string,
): Promise<boolean> {
  const db = createServiceClient();
  if (!db) return false;
  const { data, error } = await db
    .from("consultations")
    .select("name, phone, guardian_phone, student_id")
    .eq("tenant_id", tenantId)
    .eq("id", consultationId)
    .maybeSingle();
  if (error || !data) {
    console.error("[trials] notify target fetch failed", error);
    return false;
  }
  const row = data as {
    name: string;
    phone: string;
    guardian_phone: string | null;
    student_id: string | null;
  };
  const result = await sendNotification({
    tenantId,
    studentId: row.student_id,
    type: "trial_confirmed",
    phone: row.guardian_phone || row.phone,
    message: renderTemplate("trial_confirmed", {
      name: row.name,
      date: formatKDateTime(scheduledAt),
    }),
    isAd: false,
  });
  if (!result.ok) console.error("[trials] trial_confirmed 발송 실패", result.error);
  return result.ok;
}

/** 확정 안내 재발송(T-02 "전달 재시도") — 회차 상태는 건드리지 않는 발송 전용 경로. */
export async function resendTrialConfirmedNotice(id: string): Promise<TrialActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const current = await loadSession(db, session.tenantId, id);
  if (!current) return { ok: false, error: "시범 회차를 찾을 수 없습니다." };
  if (current.status !== "scheduled" || !current.scheduled_at) {
    return { ok: false, error: "확정된 회차만 안내를 보낼 수 있습니다." };
  }

  const sent = await notifyTrialConfirmed(
    session.tenantId,
    current.consultation_id,
    current.scheduled_at,
  );
  if (!sent) {
    return { ok: false, error: "안내 발송에 실패했습니다 — 발송 대기열에 남아 재시도됩니다." };
  }
  await logActivity(
    session.tenantId,
    session.email,
    "notify",
    "trial_session",
    id,
    "시범 확정 안내 재발송",
  );
  revalidateTrials(id);
  return { ok: true };
}

/* ---------- ⑤ 진행 결과: 완료 (T-04 출결 확정) ---------- */

/** 시범 진행 완료 — 출결 확정(attended_at). 결과 결정은 별도 단계다(T-04). */
export async function completeTrial(formData: FormData): Promise<TrialActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "").trim();
  const attendedRaw = String(formData.get("attendedAt") ?? "").trim();
  if (!id) return { ok: false, error: "잘못된 요청입니다." };
  const attendedAt = attendedRaw ? parseDateTime(attendedRaw) : new Date();
  if (!attendedAt) return { ok: false, error: "올바르지 않은 일시입니다." };

  const db = createServiceClient()!;
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "trial_done",
      targetType: "trial_session",
      targetId: id,
      summary: `시범 진행 완료 (${formatKDateTime(attendedAt.toISOString())})`,
      category: AUDIT_OTHER,
      before: { status: "scheduled" },
      after: { status: "done", attended_at: attendedAt.toISOString() },
    },
    () =>
      conditionalUpdate(
        db,
        session.tenantId,
        id,
        { status: "done", attended_at: attendedAt.toISOString() },
        { status: "scheduled" },
      ),
  );

  if (!result.ok) return result;
  revalidateTrials(id);
  return { ok: true };
}

/* ---------- ⑥ 변경·취소·노쇼 (T-03 · 검수 10) ---------- */

/**
 * 취소 — 요청 주체·귀책과 사유를 함께 남긴다(T-03 "요청 주체·시각·귀책 확인").
 * 환불·차감 판정은 결제 관리 몫이라 여기서는 근거만 확정한다 — 그래서 금전 카테고리다.
 */
export async function cancelTrial(formData: FormData): Promise<TrialActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "").trim();
  const fault = String(formData.get("fault") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!id) return { ok: false, error: "잘못된 요청입니다." };
  if (!isTrialCancelFault(fault)) return { ok: false, error: "귀책을 선택해 주세요." };
  if (!reason) return { ok: false, error: "취소 사유를 입력해 주세요." };

  const db = createServiceClient()!;
  const current = await loadSession(db, session.tenantId, id);
  if (!current) return { ok: false, error: "시범 회차를 찾을 수 없습니다." };
  if (current.status !== "proposed" && current.status !== "scheduled") {
    return { ok: false, error: "진행 중인 회차만 취소할 수 있습니다." };
  }

  const canceledReason = `[${trialCancelFaultLabel(fault)}] ${reason}`;
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "trial_cancel",
      targetType: "trial_session",
      targetId: id,
      summary: `시범 취소 — ${trialCancelFaultLabel(fault)}`,
      category: AUDIT_MONEY,
      before: { status: current.status, is_paid: current.is_paid, payment_id: current.payment_id },
      after: { status: "canceled", canceled_reason: canceledReason },
      reason: canceledReason,
    },
    () =>
      conditionalUpdate(
        db,
        session.tenantId,
        id,
        { status: "canceled", canceled_reason: canceledReason },
        { status: current.status },
      ),
  );

  if (!result.ok) return result;
  revalidateTrials(id);
  return { ok: true };
}

/**
 * 노쇼 연락 기록 1건(10·20·30분 중 하나) — 확정이 아니라 사실 기록이다(검수 10).
 * 그 시점이 지나야 남길 수 있다: 시작 전에 미리 세 건을 찍어 두고 노쇼를 여는 길을 막는다.
 * 저장소는 activity_log(append-only) — 회차 행에는 남기지 않아 "확정 전에는 판단에 반영되지
 * 않는다"는 정본이 데이터에서도 유지된다.
 */
export async function recordNoshowContact(formData: FormData): Promise<TrialActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "").trim();
  const minute = Number(formData.get("minute") ?? 0);
  const note = String(formData.get("note") ?? "").trim();
  if (!id) return { ok: false, error: "잘못된 요청입니다." };
  if (!isNoshowContactMinute(minute)) return { ok: false, error: "연락 시점이 올바르지 않습니다." };

  const db = createServiceClient()!;
  const current = await loadSession(db, session.tenantId, id);
  if (!current) return { ok: false, error: "시범 회차를 찾을 수 없습니다." };
  if (current.status !== "scheduled" || !current.scheduled_at) {
    return { ok: false, error: "확정된 회차에만 연락 기록을 남길 수 있습니다." };
  }
  const dueAt = new Date(current.scheduled_at).getTime() + minute * 60 * 1000;
  if (Date.now() < dueAt) {
    return { ok: false, error: `아직 시작 후 ${minute}분이 지나지 않았습니다 — 그 시점에 기록해 주세요.` };
  }

  const { data: existing, error: existingError } = await db
    .from("activity_log")
    .select("id")
    .eq("tenant_id", session.tenantId)
    .eq("target_type", "trial_session")
    .eq("target_id", id)
    .eq("action", noshowContactAction(minute))
    .limit(1);
  if (existingError) {
    console.error("[trials] contact log scan failed", existingError);
    return { ok: false, error: "연락 기록 확인에 실패했습니다." };
  }
  if (existing && existing.length > 0) {
    return { ok: false, error: `${minute}분 연락 기록은 이미 남아 있습니다.` };
  }

  // 상태 전환이 아니라 사실 기록이라 logActivity를 쓴다(전환은 confirmNoshow 하나뿐).
  await logActivity(
    session.tenantId,
    session.email,
    noshowContactAction(minute),
    "trial_session",
    id,
    `노쇼 연락 ${minute}분 — 무응답${note ? ` · ${note}` : ""}`,
  );

  revalidateTrials(id);
  return { ok: true };
}

/**
 * 노쇼 확정 — 자동 판정 금지(검수 10).
 * 서버가 다시 확인하는 조건: ① 확정된 회차, ② 시작 후 30분 경과, ③ 10·20·30분 연락 기록 3건.
 * 화면의 버튼 활성화는 편의일 뿐이고 판정 근거는 여기 세 줄이다.
 */
export async function confirmNoshow(formData: FormData): Promise<TrialActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  const db = createServiceClient()!;
  const current = await loadSession(db, session.tenantId, id);
  if (!current) return { ok: false, error: "시범 회차를 찾을 수 없습니다." };
  if (current.status !== "scheduled" || !current.scheduled_at) {
    return { ok: false, error: "확정된 회차만 노쇼로 확정할 수 있습니다." };
  }
  const passedAt =
    new Date(current.scheduled_at).getTime() + NOSHOW_CONFIRM_AFTER_MINUTES * 60 * 1000;
  if (Date.now() < passedAt) {
    return { ok: false, error: `시작 후 ${NOSHOW_CONFIRM_AFTER_MINUTES}분이 지나야 확정할 수 있습니다.` };
  }

  const actions = NOSHOW_CONTACT_MINUTES.map((m) => noshowContactAction(m));
  const { data: contacts, error: contactError } = await db
    .from("activity_log")
    .select("action")
    .eq("tenant_id", session.tenantId)
    .eq("target_type", "trial_session")
    .eq("target_id", id)
    .in("action", actions);
  if (contactError) {
    console.error("[trials] noshow contact scan failed", contactError);
    return { ok: false, error: "연락 기록 확인에 실패했습니다." };
  }
  const recorded = new Set((contacts ?? []).map((c) => (c as { action: string }).action));
  const missing = NOSHOW_CONTACT_MINUTES.filter((m) => !recorded.has(noshowContactAction(m)));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `연락 기록이 남지 않은 시점이 있습니다(${missing.join("·")}분) — 세 번 모두 기록해야 확정할 수 있습니다.`,
    };
  }

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "trial_noshow",
      targetType: "trial_session",
      targetId: id,
      summary: "시범 노쇼 확정 — 10·20·30분 연락 무응답",
      category: AUDIT_MONEY,
      before: { status: "scheduled", scheduled_at: current.scheduled_at },
      after: { status: "noshow", contacts: actions },
      reason: note || undefined,
    },
    () => conditionalUpdate(db, session.tenantId, id, { status: "noshow" }, { status: "scheduled" }),
  );

  if (!result.ok) return result;
  revalidateTrials(id);
  return { ok: true };
}

/**
 * 재예약(T-03 "기존 회차 닫기 → 충돌 확인 → 대체 회차 생성").
 * 확정된 회차의 일시를 고치지 않고, 기존 회차를 취소로 닫은 뒤 새 회차를 만든다 —
 * "무엇이 언제 왜 바뀌었는지"가 회차 두 줄로 남는다.
 * 유료 회차의 청구·결제 확인은 새 회차로 이어 붙인다(같은 결제로 다시 잡는 재예약).
 * 일정 합의는 새로 받아야 하므로 schedule_confirmed는 항상 false에서 시작한다.
 */
export async function rescheduleTrial(formData: FormData): Promise<TrialActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "").trim();
  const scheduledAtRaw = String(formData.get("scheduledAt") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const force = String(formData.get("force") ?? "") === "1";
  if (!id) return { ok: false, error: "잘못된 요청입니다." };
  if (!reason) return { ok: false, error: "재예약 사유를 입력해 주세요." };
  const scheduledAt = scheduledAtRaw ? parseDateTime(scheduledAtRaw) : null;
  if (scheduledAtRaw && !scheduledAt) return { ok: false, error: "올바르지 않은 일시입니다." };

  const db = createServiceClient()!;
  const current = await loadSession(db, session.tenantId, id);
  if (!current) return { ok: false, error: "시범 회차를 찾을 수 없습니다." };
  if (current.status !== "proposed" && current.status !== "scheduled") {
    return { ok: false, error: "진행 중인 회차만 재예약할 수 있습니다." };
  }

  if (scheduledAt && !force) {
    const conflicts = await findScheduleConflicts(db, session.tenantId, scheduledAt, id);
    if (conflicts.length > 0) {
      return {
        ok: false,
        error: "같은 시각 앞뒤 1시간 안에 다른 일정이 있습니다. 확인 후 진행 여부를 선택해 주세요.",
        conflicts,
      };
    }
  }

  const closeReason = `[재예약] ${reason}`;
  const previousStatus = current.status;
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "trial_reschedule",
      targetType: "trial_session",
      targetId: id,
      summary: "시범 재예약 — 기존 회차 종료 후 대체 회차 생성",
      category: AUDIT_OTHER,
      before: { status: previousStatus, scheduled_at: current.scheduled_at },
      after: { status: "canceled", next_scheduled_at: scheduledAt?.toISOString() ?? null },
      reason: closeReason,
    },
    async (): Promise<CrmActionResult & { id?: string }> => {
      // ① 기존 회차를 먼저 닫는다 — 닫기 전에 새 회차를 만들면 같은 상담에 진행 중인 회차가
      //    잠시 둘이 된다(검수 6).
      const closed = await conditionalUpdate(
        db,
        session.tenantId,
        id,
        { status: "canceled", canceled_reason: closeReason },
        { status: previousStatus },
      );
      if (!closed.ok) return closed;

      const { data: created, error: insertError } = await db
        .from("trial_sessions")
        .insert({
          tenant_id: session.tenantId,
          consultation_id: current.consultation_id,
          form_id: current.form_id,
          scheduled_at: scheduledAt ? scheduledAt.toISOString() : null,
          is_paid: current.is_paid,
          payment_id: current.payment_id,
          schedule_confirmed: false, // 새 일시는 다시 합의해야 한다(검수 8)
          payment_confirmed: current.payment_confirmed,
          status: "proposed",
        })
        .select("id")
        .single();
      if (insertError || !created) {
        console.error("[trials] reschedule insert failed", insertError);
        // 보상 복구 — 대체 회차가 생기지 못했으면 기존 회차를 원래 상태로 되돌린다.
        // 실패하면 닫힌 회차만 남으므로 사유를 명시해 운영자가 직접 다시 만들도록 안내한다.
        const restored = await conditionalUpdate(
          db,
          session.tenantId,
          id,
          { status: previousStatus, canceled_reason: null },
          { status: "canceled", canceled_reason: closeReason },
        );
        if (!restored.ok) {
          return {
            ok: false,
            error: "대체 회차 생성에 실패했고 기존 회차 복구도 실패했습니다 — 목록에서 회차를 새로 만들어 주세요.",
          };
        }
        return { ok: false, error: "대체 회차 생성 중 오류가 발생했습니다 — 기존 회차는 그대로 유지했습니다." };
      }
      return { ok: true, id: (created as { id: string }).id };
    },
  );

  if (!result.ok) return result;
  revalidateTrials(id);
  // 지금 보던 회차는 닫혔다 — 이어서 볼 곳은 대체 회차다.
  const nextId = "id" in result ? result.id : undefined;
  return { ok: true, redirectPath: nextId ? `/admin/trials/${nextId}` : "/admin/trials" };
}

/* ---------- ⑦ 시범 결과 (T-04 · 검수 11) ---------- */

/**
 * 결과 결정 — trial_results에 새 행을 쌓는다(덮어쓰지 않는다, T-04).
 * 같은 회차에 결과가 여러 번 기록될 수 있고, 현재 결과는 가장 최근 결정이다.
 * 정규 폼 발급 게이트(검수 11) 자체는 상담 화면 몫이라 여기서는 결과 기록까지 하고
 * 화면이 "정규 제안일 때만 정규 폼이 열린다"를 안내한다.
 */
export async function decideTrialResult(formData: FormData): Promise<TrialActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "").trim();
  const result = String(formData.get("result") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!id) return { ok: false, error: "잘못된 요청입니다." };
  if (!isTrialResult(result)) return { ok: false, error: "결과를 선택해 주세요." };

  const detail = await getTrialSession(session.tenantId, id);
  if (!detail) return { ok: false, error: "시범 회차를 찾을 수 없습니다." };
  // 출결이 확정된 뒤에 결과를 정한다(T-04 주 전환: 출결 확정 → 진행 → 결과 결정).
  // 취소·노쇼도 결과 대상이다(신청자 거절·미진행 분기가 거기서 나온다).
  if (detail.status === "proposed" || detail.status === "scheduled") {
    return { ok: false, error: "진행 결과(완료·노쇼·취소)가 확정된 뒤에 시범 결과를 정할 수 있습니다." };
  }
  if (detail.latestResult?.result === result) {
    return { ok: false, error: "같은 결과가 이미 현재 결과입니다 — 바뀐 결정만 기록합니다." };
  }

  const db = createServiceClient()!;
  const outcome = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "trial_result",
      targetType: "trial_session",
      targetId: id,
      summary: `시범 결과 결정 — ${trialResultLabel(result)}`,
      category: AUDIT_OTHER,
      before: { result: detail.latestResult?.result ?? null },
      after: { result },
      reason: note || undefined,
    },
    async (): Promise<CrmActionResult> => {
      const { error } = await db.from("trial_results").insert({
        tenant_id: session.tenantId,
        trial_session_id: id,
        result,
        note: note || null,
        decided_by: session.email,
      });
      if (error) {
        console.error("[trials] result insert failed", error);
        return { ok: false, error: "결과 기록 중 오류가 발생했습니다." };
      }
      return { ok: true };
    },
  );

  if (!outcome.ok) return outcome;
  revalidateTrials(id);
  revalidatePath(`/admin/consultations/${detail.consultationId}`);
  return { ok: true };
}
