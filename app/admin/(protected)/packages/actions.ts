"use server";

// 수업 묶음 서버 액션 (M3 · L-01).
// 상태 전환은 전부 00020의 RPC를 거친다 — 게이트 판정과 전환이 한 문장 안에서 끝나야
// 계약 철회·정원 변경이 판정과 전환 사이에 끼어들지 못한다(00018 activate_enrollment와 같은 규약).
// 잔액을 움직이는 전환(회차 부여·조정)은 runCritical(fail-closed)로 감싼다 — 감사 기록이
// 먼저 남지 않으면 잔액을 건드리지 않는다.

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { logActivity, runCritical } from "@/lib/data/activity";
import { expandCandidates, hasActiveBookingRestriction } from "@/lib/data/packages";
import type { CrmActionResult } from "@/components/admin/crm/types";
import type { SessionPattern } from "@/lib/types";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";

function revalidatePackages(id?: string) {
  revalidatePath("/admin/packages");
  if (id) revalidatePath(`/admin/packages/${id}`);
  revalidatePath("/admin/schedules");
}

/** RPC의 jsonb 반환을 액션 결과로. reason은 사용자 문구로 옮긴다. */
function rpcResult(
  data: unknown,
  messages: Record<string, string>,
  fallback: string,
): CrmActionResult {
  const r = (data ?? {}) as { ok?: boolean; reason?: string };
  if (r.ok) return { ok: true };
  return { ok: false, error: messages[r.reason ?? ""] ?? fallback };
}

function parsePattern(form: FormData): SessionPattern | null {
  const weekdays = form
    .getAll("weekdays")
    .map((v) => Number(String(v)))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  const time = String(form.get("time") ?? "").trim();
  const durationMin = Number(form.get("durationMin") ?? 60);
  if (weekdays.length === 0) return null;
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  if (!Number.isFinite(durationMin) || durationMin < 10 || durationMin > 480) return null;
  return { weekdays: [...new Set(weekdays)].sort(), time, durationMin };
}

/**
 * 묶음 생성(draft). 계약·등록 확인은 여기서 하지 않는다 — 활성화 RPC가 판정 정본이다.
 * 여기서는 폼 값의 형식만 본다.
 */
export async function createPackage(form: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const contractId = String(form.get("contractId") ?? "").trim();
  const enrollmentId = String(form.get("enrollmentId") ?? "").trim();
  const studentId = String(form.get("studentId") ?? "").trim();
  if (!contractId || !enrollmentId || !studentId) {
    return { ok: false, error: "계약·등록·학생을 선택해 주세요." };
  }

  const totalSessions = Number(form.get("totalSessions") ?? 0);
  if (!Number.isInteger(totalSessions) || totalSessions < 1 || totalSessions > 200) {
    return { ok: false, error: "총 회차는 1~200 사이여야 합니다." };
  }
  const unitPrice = Number(form.get("unitPrice") ?? 0);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return { ok: false, error: "회차 단가가 올바르지 않습니다." };
  }
  const startsOn = String(form.get("startsOn") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) {
    return { ok: false, error: "시작일이 올바르지 않습니다." };
  }
  const pattern = parsePattern(form);
  if (!pattern) return { ok: false, error: "요일·시간·수업 길이를 확인해 주세요." };

  const db = createServiceClient()!;
  const { data, error } = await db
    .from("lesson_packages")
    .insert({
      tenant_id: session.tenantId,
      enrollment_id: enrollmentId,
      contract_id: contractId,
      student_id: studentId,
      title: String(form.get("title") ?? "").trim(),
      total_sessions: totalSessions,
      unit_price: Math.round(unitPrice),
      pattern,
      starts_on: startsOn,
    })
    .select("id")
    .single();

  if (error) {
    // 한 계약에 살아 있는 묶음은 하나다(부분 유니크) — 사용자에게 그 뜻으로 알린다.
    if (error.code === "23505") {
      return { ok: false, error: "이 계약에는 이미 진행 중인 수업 묶음이 있습니다." };
    }
    console.error("[packages] insert failed", error);
    return { ok: false, error: "수업 묶음 생성 중 오류가 발생했습니다." };
  }

  const id = (data as { id: string }).id;
  await logActivity(session.tenantId, session.email, "create", "lesson_package", id, "수업 묶음 생성");
  revalidatePackages(id);
  return { ok: true };
}

/** 활성화(L-01) — 등록 active + 계약 동의가 있어야 통과한다. 판정은 RPC의 WHERE다. */
export async function activatePackage(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const { data, error } = await db.rpc("activate_lesson_package", {
    p_tenant: session.tenantId,
    p_package: id,
    p_actor: session.email,
  });
  if (error) {
    console.error("[packages] activate rpc failed", error);
    return { ok: false, error: "활성화 중 오류가 발생했습니다." };
  }
  const result = rpcResult(
    data,
    { gate: "활성 등록과 동의된 계약이 있어야 활성화할 수 있습니다." },
    "활성화할 수 없는 상태입니다.",
  );
  if (result.ok) {
    await logActivity(session.tenantId, session.email, "update", "lesson_package", id, "수업 묶음 활성화");
    revalidatePackages(id);
  }
  return result;
}

export interface GenerateResult extends CrmActionResult {
  total?: number;
  confirmed?: number;
  conflicted?: number;
  skipped?: number;
}

/**
 * 전체 회차 후보 생성(L-01). 후보 시각은 앱이 만들고 충돌 판정·확정은 DB가 한다.
 * 결과는 confirmed + conflicted + skipped = total로 대사되어 화면에 그대로 안내된다.
 */
export async function generateSessions(
  packageId: string,
  form: FormData,
): Promise<GenerateResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const count = Number(form.get("count") ?? 0);
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    return { ok: false, error: "생성할 회차 수는 1~200 사이여야 합니다." };
  }
  const skipDates = String(form.get("skipDates") ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));

  const db = createServiceClient()!;
  const { data: pkg } = await db
    .from("lesson_packages")
    .select("pattern, starts_on, status, student_id")
    .eq("tenant_id", session.tenantId)
    .eq("id", packageId)
    .maybeSingle();
  if (!pkg) return { ok: false, error: "수업 묶음을 찾을 수 없습니다." };
  const row = pkg as {
    pattern: SessionPattern;
    starts_on: string;
    status: string;
    student_id: string;
  };
  if (row.status !== "active") {
    return { ok: false, error: "활성 상태의 묶음에서만 회차를 만들 수 있습니다." };
  }

  // L-08: 회차 후보 생성도 '새 예약'이다 — 예약이 제한된 학생에게는 만들지 않는다.
  // 이미 만들어진 회차는 그대로 둔다(제한은 기존 확정 수업을 취소하지 않는다).
  if (await hasActiveBookingRestriction(session.tenantId, row.student_id)) {
    return {
      ok: false,
      error: "예약이 제한된 학생입니다. 출결·정정 화면에서 제한을 검토·해제한 뒤 회차를 만드세요.",
    };
  }

  const candidates = expandCandidates({
    pattern: row.pattern,
    startsOn: row.starts_on,
    count,
    skipDates,
  });
  if (candidates.length === 0) {
    return { ok: false, error: "반복 조건으로 만들 수 있는 회차가 없습니다. 요일·시간을 확인해 주세요." };
  }

  const { data, error } = await db.rpc("generate_package_sessions", {
    p_tenant: session.tenantId,
    p_package: packageId,
    p_candidates: candidates,
    p_actor: session.email,
  });
  if (error) {
    console.error("[packages] generate rpc failed", error);
    return { ok: false, error: "회차 생성 중 오류가 발생했습니다." };
  }
  const r = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    total?: number;
    confirmed?: number;
    conflicted?: number;
    skipped?: number;
  };
  if (!r.ok) {
    return {
      ok: false,
      error:
        r.reason === "package_not_active"
          ? "활성 상태의 묶음에서만 회차를 만들 수 있습니다."
          : "회차 후보가 올바르지 않습니다.",
    };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "create",
    "lesson_package",
    packageId,
    `회차 생성 — 확정 ${r.confirmed}·충돌 ${r.conflicted}·기존 ${r.skipped}`,
  );
  revalidatePackages(packageId);
  return {
    ok: true,
    total: r.total,
    confirmed: r.confirmed,
    conflicted: r.conflicted,
    skipped: r.skipped,
  };
}

/**
 * 회차 조정(추가 부여·감액). 잔액이 움직이므로 감사 선기록이 실패하면 실행하지 않는다.
 * 원장은 append-only이므로 이 액션은 새 행만 쌓는다.
 */
export async function adjustPackageSessions(
  packageId: string,
  form: FormData,
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const delta = Number(form.get("delta") ?? 0);
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 200) {
    return { ok: false, error: "조정 회차 수를 확인해 주세요(0 제외, ±200 이내)." };
  }
  const reason = String(form.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: "조정 사유를 입력해 주세요." };

  return runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "adjust",
      targetType: "lesson_package",
      targetId: packageId,
      summary: `회차 ${delta > 0 ? "+" : ""}${delta} 조정`,
      category: "money",
      after: { delta },
      reason,
    },
    async () => {
      const db = createServiceClient()!;
      const { error } = await db.from("session_ledger").insert({
        tenant_id: session.tenantId,
        package_id: packageId,
        schedule_id: null,
        kind: delta > 0 ? "grant" : "adjust",
        delta,
        reason,
        actor_email: session.email,
      });
      if (error) {
        console.error("[packages] ledger insert failed", error);
        return { ok: false as const, error: "회차 조정 중 오류가 발생했습니다." };
      }
      revalidatePackages(packageId);
      return { ok: true as const };
    },
  );
}

/** 묶음 종료. 남은 회차는 원장에 그대로 남는다 — 정산·환불 계산의 근거다. */
export async function endPackage(packageId: string, form: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  const reason = String(form.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: "종료 사유를 입력해 주세요." };

  const db = createServiceClient()!;
  const { data, error } = await db
    .from("lesson_packages")
    .update({ status: "ended", ended_at: new Date().toISOString(), end_reason: reason })
    .eq("tenant_id", session.tenantId)
    .eq("id", packageId)
    .in("status", ["draft", "active"])
    .select("id");
  if (error) {
    console.error("[packages] end failed", error);
    return { ok: false, error: "종료 중 오류가 발생했습니다." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "이미 종료된 묶음입니다." };
  }
  await logActivity(
    session.tenantId,
    session.email,
    "update",
    "lesson_package",
    packageId,
    `수업 묶음 종료 — ${reason}`,
  );
  revalidatePackages(packageId);
  return { ok: true };
}
