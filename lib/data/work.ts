import { createServiceClient } from "@/lib/supabase/server";

// 오늘 업무 큐 — 사람 손이 필요한 열린 일감을 우선순위순으로 관리한다.
// 원칙: 한 사건 한 업무(부분 유니크로 중복 생성 금지),
// 열린 업무에는 원본(source)·처리자·다음 행동·완결 상태 4요소가 있어야 한다.

/** 업무 종류 — 어떤 사건에서 생긴 일감인지. */
export type WorkItemKind =
  | "notify_exhausted" // 알림 재시도 소진
  | "notify_unknown_result" // 알림 발송 결과 불명(성공 아님 — 확인 대상)
  | "report_send_failed" // 리포트 발송 실패
  | "schedule_unresolved" // 일정 충돌·미확정
  | "automation_failure" // 자동화 실행 실패
  | "payssam_unknown_result" // 결제선생 결과 불명(발송·환불·동기화 — 확인 대상)
  | "payssam_mismatch" // 결제선생 승인·내부 원장 불일치(자동 조정 금지 — 사람 판정)
  | "audit_pending_stale" // 감사 대기 장기 미처리
  | "manual"; // 수동 등록

/** 우선순위 — risk > money > privacy > normal 순으로 처리한다. */
export type WorkItemPriority = "risk" | "money" | "privacy" | "normal";

export type WorkItemStatus = "open" | "in_progress" | "done" | "dismissed";

export interface WorkItem {
  id: string;
  kind: WorkItemKind;
  title: string;
  detail: string | null;
  sourceType: string;
  sourceId: string | null;
  priority: WorkItemPriority;
  status: WorkItemStatus;
  assigneeEmail: string | null;
  nextAction: string;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

interface WorkItemRow {
  id: string;
  kind: WorkItemKind;
  title: string;
  detail: string | null;
  source_type: string;
  source_id: string | null;
  priority: WorkItemPriority;
  status: WorkItemStatus;
  assignee_email: string | null;
  next_action: string;
  resolution: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

/** 업무 생성 입력 — 원본(sourceType)과 다음 행동(nextAction)은 타입에서 필수로 강제한다. */
export interface CreateWorkItemInput {
  kind: WorkItemKind;
  title: string;
  /** 원본 사건의 종류(예: notify_queue, report, automation_run). */
  sourceType: string;
  /** 원본 사건의 id. 없으면 null(부분 유니크에서 ''로 취급). */
  sourceId?: string | null;
  /** 담당자가 해야 할 다음 행동 — 열린 업무의 필수 요소. */
  nextAction: string;
  detail?: string | null;
  priority?: WorkItemPriority;
  assigneeEmail?: string | null;
}

function mapRow(row: WorkItemRow): WorkItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    detail: row.detail,
    sourceType: row.source_type,
    sourceId: row.source_id,
    priority: row.priority,
    status: row.status,
    assigneeEmail: row.assignee_email,
    nextAction: row.next_action,
    resolution: row.resolution,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

/** 목록 조회 시 우선순위 정렬용 순번(작을수록 먼저). */
const PRIORITY_RANK: Record<WorkItemPriority, number> = {
  risk: 0,
  money: 1,
  privacy: 2,
  normal: 3,
};

/**
 * 업무 1건 등록. 같은 사건의 열린 업무가 이미 있으면 새로 만들지 않는다(한 사건 한 업무).
 *
 * - 중복 판정은 부분 유니크 (tenant_id, kind, source_type, coalesce(source_id,''))
 *   where status in ('open','in_progress')에 맡긴다. 인덱스가 표현식이라
 *   upsert onConflict로 지정할 수 없으므로, insert 후 unique violation(23505)을
 *   무시하는 방식으로 기존 열린 항목을 유지한다.
 * - fail-open: 업무 큐 적재 실패가 원 업무(발송·자동화 등)를 실패시키면 안 되므로,
 *   어떤 오류든 로그만 남기고 호출부 흐름을 막지 않는다.
 */
export async function createWorkItem(
  tenantId: string,
  input: CreateWorkItemInput,
): Promise<void> {
  const db = createServiceClient();
  if (!db) return;
  const { error } = await db.from("work_items").insert({
    tenant_id: tenantId,
    kind: input.kind,
    title: input.title,
    detail: input.detail ?? null,
    source_type: input.sourceType,
    source_id: input.sourceId ?? null,
    priority: input.priority ?? "normal",
    status: "open",
    assignee_email: input.assigneeEmail ?? null,
    next_action: input.nextAction,
  });
  if (error && error.code !== "23505") {
    // 23505(unique violation)는 이미 같은 사건의 열린 업무가 있다는 뜻 — 정상 경로.
    console.error("[work] insert failed", error);
  }
}

/** 열린 업무(open·in_progress)를 priority(risk>money>privacy>normal)·created_at 순으로 조회. */
export async function listOpenWorkItems(
  tenantId: string,
  limit = 20,
): Promise<WorkItem[]> {
  const db = createServiceClient();
  if (!db) return [];
  // 우선순위는 enum 문자열이라 DB 정렬로 risk>money 순서를 만들 수 없다.
  // 열린 업무는 소량이므로 여유 있게 가져와 앱에서 정렬 후 자른다.
  const { data } = await db
    .from("work_items")
    .select("*")
    .eq("tenant_id", tenantId)
    .in("status", ["open", "in_progress"])
    .order("created_at", { ascending: true })
    .limit(Math.max(limit * 4, 200));
  const rows = (data ?? []) as WorkItemRow[];
  return rows
    .map(mapRow)
    .sort((a, b) => {
      const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (byPriority !== 0) return byPriority;
      return a.createdAt.localeCompare(b.createdAt); // 같은 우선순위면 오래된 업무 먼저
    })
    .slice(0, limit);
}

/**
 * 업무 완결 처리 — resolution(처리 내용)과 resolved_at을 기록한다.
 *
 * 열린 상태(open·in_progress)만 대상: 이미 완결된 업무의 resolution을
 * 덮어쓰지 않는다(승인된 사실은 덮어쓰지 않는다). 갱신된 행이 없으면 false.
 */
export async function resolveWorkItem(
  tenantId: string,
  id: string,
  resolution: string,
  status: "done" | "dismissed",
  resolvedBy: string | null = null,
): Promise<boolean> {
  const db = createServiceClient();
  if (!db) return false;
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("work_items")
    .update({
      status,
      resolution,
      resolved_at: now,
      updated_at: now,
      // 완결 시점에 처리자를 행에 스탬프한다 — 업무 4요소(원본·처리자·다음 행동·완결 상태, 검수 50).
      ...(resolvedBy ? { assignee_email: resolvedBy } : {}),
    })
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .in("status", ["open", "in_progress"])
    .select("id");
  if (error) {
    console.error("[work] resolve failed", error);
    return false;
  }
  return (data ?? []).length > 0;
}
