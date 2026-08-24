import { createServiceClient } from "@/lib/supabase/server";

// 변경 이력(감사) 로그 — 주요 mutation을 기록하고 최근순으로 조회한다.
// 00013 이후 2계층 구조:
//   - logActivity: 기타 전환용. fail-open 유지(기존 40여 호출부 호환) — category='other', phase='committed'.
//   - beginCritical→commit/abort(+runCritical): 금전·권한·성적·개인정보 전환용. fail-closed —
//     감사 기록(pending)을 먼저 남기지 못하면 전환 자체를 실행하지 않는다(정본 ①).

/** 중요 전환 카테고리 — 금전·권한·성적·개인정보. 이 4종은 반드시 fail-closed 경로를 쓴다. */
export type ActivityCategory = "money" | "permission" | "grade" | "privacy";

export interface ActivityEntry {
  id: string;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  summary: string;
  createdAt: string;
  // 00013 확장 컬럼 — 기존 소비처가 깨지지 않도록 옵셔널로만 추가한다.
  category?: string;
  phase?: string;
  reason?: string | null;
}

interface ActivityRow {
  id: string;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  summary: string;
  created_at: string;
  // 00013 이전 데이터/미적용 DB에서도 조회가 죽지 않도록 옵셔널.
  category?: string | null;
  phase?: string | null;
  reason?: string | null;
}

/**
 * 변경 이력 1건 기록(기타 전환용). 실패해도 호출부 흐름을 막지 않는다(로그만 남김).
 * 금전·권한·성적·개인정보 전환에는 쓰지 말 것 — runCritical/beginCriticalActivity를 사용.
 */
export async function logActivity(
  tenantId: string,
  actorEmail: string | null,
  action: string,
  targetType: string,
  targetId: string | null,
  summary: string,
): Promise<void> {
  const db = createServiceClient();
  if (!db) return;
  const { error } = await db.from("activity_log").insert({
    tenant_id: tenantId,
    actor_email: actorEmail,
    action,
    target_type: targetType,
    target_id: targetId,
    summary,
    category: "other",
    phase: "committed",
  });
  if (error) console.error("[activity] insert failed", error);
}

/**
 * 중요 전환의 감사 기록을 phase='pending'으로 선기록한다(fail-closed).
 *
 * 계약(정본 ①): DB 미연결이거나 insert가 실패하면 {ok:false}를 반환하며,
 * 이때 호출부는 mutation을 실행하지 말고 오류를 그대로 반환해야 한다 —
 * 감사에 연결되지 않은 금전·권한·성적·개인정보 전환은 완료로 확정하지 않는다.
 * begin→mutation→commit/abort 순서를 직접 다루기 번거로우면 runCritical을 쓸 것.
 */
export async function beginCriticalActivity(
  tenantId: string,
  actorEmail: string | null,
  action: string,
  targetType: string,
  targetId: string | null,
  summary: string,
  opts: {
    category: ActivityCategory;
    before?: unknown;
    after?: unknown;
    reason?: string;
  },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const db = createServiceClient();
  if (!db) {
    return { ok: false, error: "DB 미연결 상태에서는 중요 변경을 실행할 수 없습니다." };
  }
  const { data, error } = await db
    .from("activity_log")
    .insert({
      tenant_id: tenantId,
      actor_email: actorEmail,
      action,
      target_type: targetType,
      target_id: targetId,
      summary,
      category: opts.category,
      phase: "pending",
      before_data: opts.before ?? null,
      after_data: opts.after ?? null,
      reason: opts.reason ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[activity] critical begin failed", error);
    return { ok: false, error: "감사 기록 생성에 실패했습니다." };
  }
  return { ok: true, id: (data as { id: string }).id };
}

/**
 * pending 감사 기록을 committed로 전환한다(전환 성공 확정).
 * 실패해도 이미 실행된 mutation을 되돌리지는 않는다 — 호출부는 성공을 유지하되
 * pending 잔존을 확인 필요 신호로 남긴다(runCritical의 auditWarning 참고).
 */
export async function commitCriticalActivity(
  tenantId: string,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = createServiceClient();
  if (!db) return { ok: false, error: "DB 미연결로 감사 기록을 확정하지 못했습니다." };
  const { data, error } = await db
    .from("activity_log")
    .update({ phase: "committed" })
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .eq("phase", "pending")
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[activity] critical commit failed", error);
    return { ok: false, error: "감사 기록 확정에 실패했습니다." };
  }
  if (!data) return { ok: false, error: "확정할 pending 감사 기록이 없습니다." };
  return { ok: true };
}

/**
 * pending 감사 기록을 aborted로 전환한다(전환 미실행/실패 확정 — 새 이력 원칙에 따라 삭제하지 않는다).
 * append-only 트리거는 phase 전환(pending→aborted)과 함께 reason 갱신까지만 허용한다(00013).
 */
export async function abortCriticalActivity(
  tenantId: string,
  id: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = createServiceClient();
  if (!db) return { ok: false, error: "DB 미연결로 감사 기록을 중단 처리하지 못했습니다." };
  const { data, error } = await db
    .from("activity_log")
    .update({ phase: "aborted", reason })
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .eq("phase", "pending")
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[activity] critical abort failed", error);
    return { ok: false, error: "감사 기록 중단 처리에 실패했습니다." };
  }
  if (!data) return { ok: false, error: "중단 처리할 pending 감사 기록이 없습니다." };
  return { ok: true };
}

/** runCritical의 감사 기록 파라미터 — beginCriticalActivity 인자와 1:1 대응. */
export interface CriticalActivityParams {
  tenantId: string;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  summary: string;
  category: ActivityCategory;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

/**
 * 중요 전환 한 건을 begin→mutate→commit/abort로 감싸는 편의 wrapper.
 * 호출부는 mutation 본문을 mutate 콜백에 넣기만 하면 fail-closed 계약이 적용된다.
 *
 * 실패 계약:
 * - begin 실패 → mutate를 실행하지 않고 {ok:false, error:"감사 기록에 실패해 변경을 실행하지 않았습니다..."}.
 * - mutate가 ok:false 반환 또는 throw → abort 후 mutate의 오류를 그대로 전달(throw는 다시 throw).
 * - commit 실패 → 전환은 이미 커밋됐으므로 결과는 성공으로 두되 console.error +
 *   반환값에 auditWarning을 실어 pending 잔존을 확인 필요 신호로 남긴다(정본 ⑤).
 */
export async function runCritical<T extends { ok: boolean; error?: string }>(
  params: CriticalActivityParams,
  mutate: () => Promise<T>,
): Promise<(T & { auditWarning?: string }) | { ok: false; error: string }> {
  const begun = await beginCriticalActivity(
    params.tenantId,
    params.actorEmail,
    params.action,
    params.targetType,
    params.targetId,
    params.summary,
    {
      category: params.category,
      before: params.before,
      after: params.after,
      reason: params.reason,
    },
  );
  if (!begun.ok) {
    return {
      ok: false,
      error: `감사 기록에 실패해 변경을 실행하지 않았습니다. 잠시 후 다시 시도해 주세요. (${begun.error})`,
    };
  }

  let result: T;
  try {
    result = await mutate();
  } catch (err) {
    // mutation이 던진 예외 — abort로 미실행/실패를 확정하고 오류는 그대로 올린다.
    const message = err instanceof Error ? err.message : String(err);
    const aborted = await abortCriticalActivity(params.tenantId, begun.id, `mutation 예외: ${message}`);
    if (!aborted.ok) console.error("[activity] critical abort skipped", aborted.error);
    throw err;
  }

  if (!result.ok) {
    const aborted = await abortCriticalActivity(
      params.tenantId,
      begun.id,
      result.error ?? "mutation 실패(사유 미기재)",
    );
    if (!aborted.ok) console.error("[activity] critical abort skipped", aborted.error);
    return result;
  }

  const committed = await commitCriticalActivity(params.tenantId, begun.id);
  if (!committed.ok) {
    console.error("[activity] critical commit failed after mutation", committed.error);
    return {
      ...result,
      auditWarning:
        "변경은 완료됐으나 감사 기록 확정에 실패했습니다. pending 감사 기록을 확인해 주세요.",
    };
  }
  return result;
}

export async function listActivity(
  tenantId: string,
  limit = 20,
): Promise<ActivityEntry[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("activity_log")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => {
    const row = r as ActivityRow;
    return {
      id: row.id,
      actorEmail: row.actor_email,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      summary: row.summary,
      createdAt: row.created_at,
      category: row.category ?? undefined,
      phase: row.phase ?? undefined,
      reason: row.reason ?? null,
    };
  });
}
