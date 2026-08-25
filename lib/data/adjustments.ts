import { createServiceClient } from "@/lib/supabase/server";

// 조정 이력(adjustments) — 00013 append-only 공통 테이블의 첫 채택.
// 정본 불변식: "승인된 사실은 덮어쓰지 않는다 — 정정·취소·철회는 새 이력"(07_rollout_plan M0-③).
// 원 레코드를 고치는 대신 무엇을(target) 어떤 값에서(before) 어떤 값으로(after) 왜(reason)
// 바꿨는지를 행으로 쌓는다. 테이블 트리거가 UPDATE/DELETE를 전면 거부하므로
// 이 모듈은 insert(recordAdjustment)와 조회(listAdjustments)만 제공한다.
//
// 계약: recordAdjustment는 실패 시 {ok:false}를 반환한다 — 성적·금전·개인정보 등
// 중요 전환의 호출부는 이 결과를 확인해 fail-closed로 쓸 수 있다(이력 없이는 조정을 확정하지 않는다).
// 감사 로그(activity_log의 runCritical)와 별개 계층: activity_log는 "누가 무엇을 했나"의
// 전환 감사, adjustments는 "사실이 어떤 값으로 대체됐나"의 도메인 이력이다.

/** 조정 도메인 — 00013 주석의 채택 예정 목록 + 이번 정본 충돌 해소 범위(리뷰 철회). */
export type AdjustmentDomain =
  | "money" // 금전(결제·환불 정정)
  | "grade" // 성적 정정(A-06 — 원 결과 유지 → 새 결과본)
  | "attendance" // 출결 정정
  | "report" // 보고서 정정·철회(G-03 — 철회 이력 보존)
  | "review" // 후기·성적사례 철회·대체(S-03)
  | "enrollment"; // 등록 이력(E-05 — 종료 등록 재등록: 재활성이 아닌 새 등록 사건으로 기록)

export interface Adjustment {
  id: string;
  domain: AdjustmentDomain;
  targetType: string;
  targetId: string;
  /** 조정 전 값 — 신규 생성 조정이면 null. */
  before: unknown;
  /** 조정 후 값 — 새 사실(테이블에서 not null). */
  after: unknown;
  /** 사유 없는 조정은 없다(테이블에서 not null). */
  reason: string;
  actorEmail: string | null;
  createdAt: string;
}

interface AdjustmentRow {
  id: string;
  domain: AdjustmentDomain;
  target_type: string;
  target_id: string;
  before_data: unknown;
  after_data: unknown;
  reason: string;
  actor_email: string | null;
  created_at: string;
}

function mapRow(row: AdjustmentRow): Adjustment {
  return {
    id: row.id,
    domain: row.domain,
    targetType: row.target_type,
    targetId: row.target_id,
    before: row.before_data,
    after: row.after_data,
    reason: row.reason,
    actorEmail: row.actor_email,
    createdAt: row.created_at,
  };
}

/** 조정 이력 기록 입력 — 대상(target)·새 사실(after)·사유(reason)는 타입에서 필수로 강제한다. */
export interface RecordAdjustmentInput {
  domain: AdjustmentDomain;
  /** 대상 종류(예: grade_record, ai_report, review) — 다형 참조라 FK 없음(원본이 삭제돼도 이력 보존). */
  targetType: string;
  /** 대상 레코드 id(uuid). */
  targetId: string;
  /** 조정 전 값 — 신규 생성 조정이면 생략/null. */
  before?: unknown;
  /** 조정 후 값 — 새 사실. */
  after: unknown;
  /** 조정 사유 — 사유 없는 조정은 없다. */
  reason: string;
  actorEmail: string | null;
}

/**
 * 조정 이력 1건을 기록한다(append-only insert).
 *
 * 계약: DB 미연결이거나 insert가 실패하면 {ok:false}를 반환한다.
 * 중요 전환(성적 정정·보고서 철회 등)의 호출부는 이 결과를 확인해
 * 이력 기록에 실패한 조정을 완료로 확정하지 말 것(fail-closed).
 */
export async function recordAdjustment(
  tenantId: string,
  input: RecordAdjustmentInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const db = createServiceClient();
  if (!db) {
    return { ok: false, error: "DB 미연결 상태에서는 조정 이력을 기록할 수 없습니다." };
  }
  const { data, error } = await db
    .from("adjustments")
    .insert({
      tenant_id: tenantId,
      domain: input.domain,
      target_type: input.targetType,
      target_id: input.targetId,
      before_data: input.before ?? null,
      after_data: input.after,
      reason: input.reason,
      actor_email: input.actorEmail,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[adjustments] insert failed", error);
    return { ok: false, error: "조정 이력 기록에 실패했습니다." };
  }
  return { ok: true, id: (data as { id: string }).id };
}

/**
 * 대상 레코드 하나의 조정 이력을 최근순으로 조회한다
 * (idx_adjustments_target: tenant_id, target_type, target_id).
 */
export async function listAdjustments(
  tenantId: string,
  targetType: string,
  targetId: string,
): Promise<Adjustment[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data, error } = await db
    .from("adjustments")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[adjustments] list failed", error);
    return [];
  }
  return ((data ?? []) as AdjustmentRow[]).map(mapRow);
}
