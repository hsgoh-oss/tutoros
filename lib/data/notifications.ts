import { createServiceClient } from "@/lib/supabase/server";

// 알림 발송 원장 조회 — 솔라피(알림톡·SMS)로 나간 모든 건의 현재 상태.
//
// 이 모듈이 생긴 이유: 발송 기록은 처음부터 notifications에 다 있었는데 볼 화면이 없었다.
// "상담 접수 문자가 실제로 갔나", "시범 확정 안내가 왜 안 갔나"를 확인하려면 학생 상세로
// 들어가 그 학생 것만 보거나, 대시보드 '오늘 업무'에 실패가 올라오기를 기다려야 했다.
// 업무 카드는 사람이 손대야 하는 것만 올라오므로(N-02 업무/전달 분리), 정상 발송·대기 중인
// 건은 어디에도 보이지 않았다 — 즉 "안 갔다"와 "아직 안 갔다"를 구분할 방법이 없었다.
//
// 상태 네 가지의 뜻(00001·00013):
//   queued   적재됨. 아직 안 나갔다(솔라피 미설정·야간 대기·크론 대기).
//   sending  발송 시도 중 클레임. 여기 오래 머물면 **결과 불명**이지 성공이 아니다.
//   sent     솔라피가 접수함. 단말 도착까지 보장하지는 않는다.
//   failed   시도했고 실패. retry_count가 상한(3)에 닿으면 업무 카드로 넘어간다.

export type NotificationStatus = "queued" | "sending" | "sent" | "failed";

export const NOTIFICATION_STATUSES: NotificationStatus[] = [
  "queued",
  "sending",
  "sent",
  "failed",
];

export function isNotificationStatus(value: string): value is NotificationStatus {
  return (NOTIFICATION_STATUSES as string[]).includes(value);
}

export interface NotificationEntry {
  id: string;
  studentId: string | null;
  studentName: string | null;
  type: string;
  channel: "alimtalk" | "sms";
  phone: string;
  message: string;
  status: NotificationStatus;
  isAd: boolean;
  retryCount: number;
  error: string | null;
  sentAt: string | null;
  claimedAt: string | null;
  createdAt: string;
}

interface NotificationRow {
  id: string;
  student_id: string | null;
  type: string;
  channel: "alimtalk" | "sms";
  phone: string;
  message: string;
  status: string;
  is_ad: boolean;
  retry_count: number;
  error: string | null;
  sent_at: string | null;
  claimed_at: string | null;
  created_at: string;
}

function mapRow(row: NotificationRow, studentNames: Map<string, string>): NotificationEntry {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_id ? (studentNames.get(row.student_id) ?? null) : null,
    type: row.type,
    channel: row.channel,
    phone: row.phone,
    message: row.message,
    // DB엔 CHECK가 있지만(00013) 타입 좁히기를 위해 한 번 더 판정한다. 미지의 값은 queued로
    // 보지 않고 failed로 본다 — 모르는 상태를 "아직 나갈 예정"으로 낙관하지 않는다.
    status: isNotificationStatus(row.status) ? row.status : "failed",
    isAd: row.is_ad,
    retryCount: row.retry_count,
    error: row.error,
    sentAt: row.sent_at,
    claimedAt: row.claimed_at,
    createdAt: row.created_at,
  };
}

const SELECT =
  "id, student_id, type, channel, phone, message, status, is_ad, retry_count, error, sent_at, claimed_at, created_at";

/**
 * 학생 이름은 임베드가 아니라 별도 조회로 붙인다.
 *
 * notifications는 students를 복합 FK(tenant_id, student_id)로 참조하고 student_id는 null을
 * 허용한다. 임베드가 해석되지 않으면 조회 전체가 오류로 떨어지고, 이 함수는 빈 배열을 돌려주므로
 * 화면에는 "발송 이력 없음"이 뜬다 — 발송이 안 된 것과 조회가 깨진 것을 구분할 수 없게 된다.
 * 이름은 곁들이는 정보지 이 화면의 본체가 아니라서, 실패해도 이름만 비는 쪽을 택한다.
 */
async function studentNameMap(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  ids: (string | null)[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(ids.filter((v): v is string => v !== null))];
  if (unique.length === 0) return names;
  const { data, error } = await db
    .from("students")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .in("id", unique);
  if (error) {
    console.error("[notifications] 학생 이름 조회 실패", error);
    return names;
  }
  for (const row of (data ?? []) as { id: string; name: string }[]) {
    names.set(row.id, row.name);
  }
  return names;
}

export interface NotificationFilter {
  status?: NotificationStatus;
  /** 알림 종류(notifications.type) 정확 일치. */
  type?: string;
  limit?: number;
}

/** 최근순 발송 이력. 기본 100건 — 더 필요하면 상태·종류로 좁혀서 본다. */
export async function listNotifications(
  tenantId: string,
  filter: NotificationFilter = {},
): Promise<NotificationEntry[]> {
  const db = createServiceClient();
  if (!db) return [];
  let query = db
    .from("notifications")
    .select(SELECT)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? 100);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.type) query = query.eq("type", filter.type);

  const { data, error } = await query;
  if (error) {
    console.error("[notifications] list failed", error);
    return [];
  }
  const rows = (data ?? []) as unknown as NotificationRow[];
  const names = await studentNameMap(db, tenantId, rows.map((r) => r.student_id));
  return rows.map((r) => mapRow(r, names));
}

export interface NotifySummary {
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  /** 솔라피 키·발신번호가 설정돼 있는지 — 미설정이면 queued가 쌓이는 게 정상이다. */
  configured: boolean;
}

/**
 * 상태별 건수. 화면 맨 위 한 줄로 "지금 막힌 게 있나"를 답한다.
 *
 * 전체 기간이 아니라 최근 30일만 센다 — 오래된 sent가 수천 건 쌓이면 그 숫자가 화면을 차지하고
 * 정작 오늘 막힌 건 몇 건인지가 묻힌다.
 */
export async function getNotifySummary(
  tenantId: string,
  configured: boolean,
  days = 30,
): Promise<NotifySummary> {
  const empty: NotifySummary = {
    queued: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    configured,
  };
  const db = createServiceClient();
  if (!db) return empty;

  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await db
    .from("notifications")
    .select("status")
    .eq("tenant_id", tenantId)
    .gte("created_at", since);
  if (error) {
    console.error("[notifications] summary failed", error);
    return empty;
  }

  const counts = { ...empty };
  for (const row of (data ?? []) as { status: string }[]) {
    if (isNotificationStatus(row.status)) counts[row.status] += 1;
  }
  return counts;
}

/**
 * 한 흐름(상담 1건·학생 1명)에서 나갔어야 할 안내가 실제로 나갔는지 확인할 때 쓰는 조회.
 * 학생이 붙지 않는 알림(상담 접수 확인 등)은 student_id가 null이라 번호로 찾는다.
 */
export async function listNotificationsByPhone(
  tenantId: string,
  phone: string,
  limit = 20,
): Promise<NotificationEntry[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data, error } = await db
    .from("notifications")
    .select(SELECT)
    .eq("tenant_id", tenantId)
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[notifications] listByPhone failed", error);
    return [];
  }
  const rows = (data ?? []) as unknown as NotificationRow[];
  const names = await studentNameMap(db, tenantId, rows.map((r) => r.student_id));
  return rows.map((r) => mapRow(r, names));
}
