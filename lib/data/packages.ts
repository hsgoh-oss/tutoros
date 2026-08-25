// 수업 묶음·회차 원장·출결 데이터 계층 (M3).
// 스키마 정본: supabase/migrations/00020_lesson_packages.sql
//   (lesson_packages · session_ledger · lesson_package_balances 뷰 · attendance_contacts
//    · attendance_corrections · booking_restrictions — 제약·부분 유니크·트리거는 그쪽 주석 참조).
// 스타일은 lib/data/intake.ts·homework.ts와 같다(snake_case DB ↔ camelCase 앱, DB 미연결 시 빈 값).
//
// 정본 규칙(docs/flow-canon/01_atlas_02_portal_lessons.md):
//   - L-01: 회차 후보 시각 계산(요일·시간·타임존)은 앱 몫이고 충돌 판정·확정은 DB 몫이다.
//     expandCandidates가 후보만 만들고, 확정 여부는 RPC generate_package_sessions가 정한다.
//   - L-03·L-05: 잔액은 저장값이 아니라 원장 합이다. 이 파일은 lesson_package_balances 뷰만
//     읽는다 — 앱이 잔액을 따로 계산하면 원장과 어긋나는 두 번째 정본이 생긴다.
//   - L-10: contract_id가 null인 회차는 "귀속 미확정"이며 잔액·환불·매출 계산에서 확정 사실처럼
//     쓰지 않는다. listUnresolvedSchedules가 그 목록이고, 후보 계산은
//     listContractCandidates가 RPC와 같은 규칙으로 한다(표시용 — 판정 정본은 RPC의 WHERE다).
//
// 이 파일은 조회 전용이다. 모든 상태 전환은 서버 액션이 RPC를 통해 한다.

import { createServiceClient } from "@/lib/supabase/server";
import type {
  Attendance,
  AttendanceContact,
  AttendanceCorrection,
  BookingRestriction,
  DeductionState,
  LedgerEntry,
  LedgerKind,
  LessonPackage,
  LessonPackageStatus,
  PackageBalance,
  ScheduleItem,
  SessionPattern,
} from "@/lib/types";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * PostgREST 임베딩(`students(name)`)에서 이름만 꺼낸다.
 * to-one 관계는 런타임에 객체지만 생성 타입이 배열로 추론되는 경우가 있어 둘 다 받는다.
 */
function embeddedName(v: unknown): string | null {
  if (Array.isArray(v)) return (v[0] as { name?: string } | undefined)?.name ?? null;
  return (v as { name?: string } | null)?.name ?? null;
}


/* ---------- 후보 시각 계산 (L-01) ---------- */

export interface CandidateSlot {
  at: string;      // ISO (UTC)
  ends_at: string; // ISO (UTC)
}

export interface CandidateOptions {
  pattern: SessionPattern;
  startsOn: string;      // YYYY-MM-DD (KST)
  count: number;         // 만들 회차 수
  skipDates?: string[];  // 휴무·건너뛸 날 (YYYY-MM-DD, KST)
}

/** KST 벽시계(YYYY-MM-DD, HH:MM)를 실제 시각(UTC ISO)으로. 서버 TZ와 무관하다. */
function kstWallClockToIso(dateYmd: string, timeHm: string): string {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const [hh, mm] = timeHm.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - KST_OFFSET_MS).toISOString();
}

/** ISO 시각을 KST 기준 YYYY-MM-DD로. */
export function kstDate(iso: string): string {
  const k = new Date(new Date(iso).getTime() + KST_OFFSET_MS);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}-${String(
    k.getUTCDate(),
  ).padStart(2, "0")}`;
}

/**
 * 반복 조건에서 회차 후보를 만든다(L-01 "전체 회차 후보 생성").
 * 충돌 판정은 하지 않는다 — 그건 DB가 한다. 여기서는 요일·시간·건너뛸 날만 본다.
 * 무한 루프 방지를 위해 탐색 범위를 2년으로 제한한다(요일 배열이 비면 후보가 영영 안 나온다).
 */
export function expandCandidates(opts: CandidateOptions): CandidateSlot[] {
  const { pattern, startsOn, count } = opts;
  const weekdays = [...new Set(pattern.weekdays)].filter((d) => d >= 0 && d <= 6);
  if (weekdays.length === 0 || count <= 0) return [];
  if (!/^\d{2}:\d{2}$/.test(pattern.time)) return [];

  const skip = new Set(opts.skipDates ?? []);
  const durationMin = pattern.durationMin > 0 ? pattern.durationMin : 60;
  const out: CandidateSlot[] = [];

  const [y, m, d] = startsOn.split("-").map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));
  const limit = new Date(cursor.getTime() + 730 * 24 * 60 * 60 * 1000);

  while (out.length < count && cursor <= limit) {
    const ymd = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(
      cursor.getUTCDate(),
    ).padStart(2, "0")}`;
    if (weekdays.includes(cursor.getUTCDay()) && !skip.has(ymd)) {
      const at = kstWallClockToIso(ymd, pattern.time);
      out.push({
        at,
        ends_at: new Date(new Date(at).getTime() + durationMin * 60 * 1000).toISOString(),
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/* ---------- 수업 묶음 ---------- */

interface PackageRow {
  id: string;
  enrollment_id: string;
  contract_id: string;
  student_id: string;
  title: string;
  total_sessions: number;
  unit_price: number;
  pattern: Partial<SessionPattern> | null;
  starts_on: string;
  status: LessonPackageStatus;
  activated_at: string | null;
  ended_at: string | null;
  students?: { name: string } | null;
}

interface BalanceRow {
  package_id: string;
  total_sessions: number;
  consumed: number;
  remaining: number;
  confirmed_sessions: number;
  conflicted_sessions: number;
  unresolved_sessions: number;
}

function mapBalance(row: BalanceRow): PackageBalance {
  return {
    totalSessions: row.total_sessions,
    consumed: row.consumed,
    remaining: row.remaining,
    confirmedSessions: row.confirmed_sessions,
    conflictedSessions: row.conflicted_sessions,
    unresolvedSessions: row.unresolved_sessions,
  };
}

function mapPattern(raw: PackageRow["pattern"]): SessionPattern {
  return {
    weekdays: Array.isArray(raw?.weekdays) ? raw.weekdays : [],
    time: typeof raw?.time === "string" ? raw.time : "",
    durationMin: typeof raw?.durationMin === "number" ? raw.durationMin : 60,
  };
}

function mapPackage(row: PackageRow, balance: PackageBalance | null): LessonPackage {
  return {
    id: row.id,
    enrollmentId: row.enrollment_id,
    contractId: row.contract_id,
    studentId: row.student_id,
    studentName: embeddedName(row.students),
    title: row.title,
    totalSessions: row.total_sessions,
    unitPrice: row.unit_price,
    pattern: mapPattern(row.pattern),
    startsOn: row.starts_on,
    status: row.status,
    activatedAt: row.activated_at,
    endedAt: row.ended_at,
    balance,
  };
}

async function balancesFor(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  packageIds: string[],
): Promise<Map<string, PackageBalance>> {
  const map = new Map<string, PackageBalance>();
  if (packageIds.length === 0) return map;
  const { data } = await db
    .from("lesson_package_balances")
    .select("*")
    .eq("tenant_id", tenantId)
    .in("package_id", packageIds);
  for (const r of (data ?? []) as BalanceRow[]) map.set(r.package_id, mapBalance(r));
  return map;
}

export async function listPackages(
  tenantId: string,
  opts: { studentId?: string; status?: LessonPackageStatus } = {},
): Promise<LessonPackage[]> {
  const db = createServiceClient();
  if (!db) return [];
  let q = db
    .from("lesson_packages")
    .select("*, students(name)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (opts.studentId) q = q.eq("student_id", opts.studentId);
  if (opts.status) q = q.eq("status", opts.status);
  const { data } = await q;
  const rows = (data ?? []) as PackageRow[];
  const balances = await balancesFor(db, tenantId, rows.map((r) => r.id));
  return rows.map((r) => mapPackage(r, balances.get(r.id) ?? null));
}

export interface PackageDetail {
  pkg: LessonPackage;
  schedules: (ScheduleItem & { studentName: string })[];
  ledger: LedgerEntry[];
}

export async function getPackageDetail(
  tenantId: string,
  id: string,
): Promise<PackageDetail | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("lesson_packages")
    .select("*, students(name)")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as PackageRow;
  const balances = await balancesFor(db, tenantId, [id]);

  const [{ data: scheds }, { data: ledger }] = await Promise.all([
    db
      .from("schedules")
      .select("*, students(name)")
      .eq("tenant_id", tenantId)
      .eq("package_id", id)
      .order("scheduled_at"),
    db
      .from("session_ledger")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("package_id", id)
      .order("created_at"),
  ]);

  return {
    pkg: mapPackage(row, balances.get(id) ?? null),
    schedules: (scheds ?? []).map((s) => {
      const r = s as Record<string, unknown> & { students: unknown };
      return { ...mapScheduleRow(r), studentName: embeddedName(r.students) ?? "알 수 없음" };
    }),
    ledger: (ledger ?? []).map(mapLedger),
  };
}

/** crm.mapSchedule과 같은 매핑 — 순환 import를 피해 여기서 다시 쓴다. */
function mapScheduleRow(r: Record<string, unknown>): ScheduleItem {
  return {
    id: r.id as string,
    studentId: r.student_id as string,
    scheduledAt: r.scheduled_at as string,
    endsAt: (r.ends_at as string | null) ?? null,
    classType: r.class_type as ScheduleItem["classType"],
    status: r.status as ScheduleItem["status"],
    reminderSent: Boolean(r.reminder_sent),
    lessonId: (r.lesson_id as string | null) ?? null,
    packageId: (r.package_id as string | null) ?? null,
    contractId: (r.contract_id as string | null) ?? null,
    attendance: (r.attendance as Attendance | null) ?? null,
    deductionState: (r.deduction_state as DeductionState) ?? "none",
    correctionCount: (r.correction_count as number) ?? 0,
    originScheduleId: (r.origin_schedule_id as string | null) ?? null,
    conflictReason: (r.conflict_reason as string | null) ?? null,
  };
}

function mapLedger(r: unknown): LedgerEntry {
  const row = r as Record<string, unknown>;
  return {
    id: row.id as string,
    scheduleId: (row.schedule_id as string | null) ?? null,
    kind: row.kind as LedgerKind,
    delta: row.delta as number,
    correctionNo: row.correction_no as number,
    reason: (row.reason as string) ?? "",
    actorEmail: (row.actor_email as string | null) ?? null,
    reversesId: (row.reverses_id as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

/* ---------- 회차 상세 (출결·연락·정정) ---------- */

export interface ScheduleDetail {
  schedule: ScheduleItem;
  studentName: string;
  contacts: AttendanceContact[];
  corrections: AttendanceCorrection[];
  packageTitle: string | null;
  remaining: number | null;
}

export async function getScheduleDetail(
  tenantId: string,
  id: string,
): Promise<ScheduleDetail | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("schedules")
    .select("*, students(name)")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown> & { students: unknown };
  const schedule = mapScheduleRow(row);

  const [{ data: contacts }, { data: corrections }] = await Promise.all([
    db
      .from("attendance_contacts")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("schedule_id", id)
      .order("minute_mark"),
    db
      .from("attendance_corrections")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("schedule_id", id)
      .order("created_at", { ascending: false }),
  ]);

  let packageTitle: string | null = null;
  let remaining: number | null = null;
  if (schedule.packageId) {
    const [{ data: pkg }, { data: bal }] = await Promise.all([
      db
        .from("lesson_packages")
        .select("title")
        .eq("tenant_id", tenantId)
        .eq("id", schedule.packageId)
        .maybeSingle(),
      db
        .from("lesson_package_balances")
        .select("remaining")
        .eq("tenant_id", tenantId)
        .eq("package_id", schedule.packageId)
        .maybeSingle(),
    ]);
    packageTitle = (pkg as { title: string } | null)?.title ?? null;
    remaining = (bal as { remaining: number } | null)?.remaining ?? null;
  }

  return {
    schedule,
    studentName: embeddedName(row.students) ?? "알 수 없음",
    contacts: (contacts ?? []).map(mapContact),
    corrections: (corrections ?? []).map((c) => mapCorrection(c, null, null)),
    packageTitle,
    remaining,
  };
}

function mapContact(r: unknown): AttendanceContact {
  const row = r as Record<string, unknown>;
  return {
    id: row.id as string,
    scheduleId: row.schedule_id as string,
    minuteMark: row.minute_mark as 10 | 20 | 30,
    channel: row.channel as AttendanceContact["channel"],
    result: row.result as AttendanceContact["result"],
    contactedAt: row.contacted_at as string,
  };
}

function mapCorrection(
  r: unknown,
  studentName: string | null,
  scheduledAt: string | null,
): AttendanceCorrection {
  const row = r as Record<string, unknown>;
  return {
    id: row.id as string,
    scheduleId: row.schedule_id as string,
    studentName,
    scheduledAt,
    requesterRole: row.requester_role as AttendanceCorrection["requesterRole"],
    requestedBy: row.requested_by as string,
    fromAttendance: (row.from_attendance as Attendance | null) ?? null,
    toAttendance: row.to_attendance as Attendance,
    toDeduct: Boolean(row.to_deduct),
    reason: row.reason as string,
    status: row.status as AttendanceCorrection["status"],
    decidedBy: (row.decided_by as string | null) ?? null,
    decidedAt: (row.decided_at as string | null) ?? null,
    decisionReason: (row.decision_reason as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

/* ---------- 심사 대기 정정 (L-06) ---------- */

export async function listPendingCorrections(
  tenantId: string,
): Promise<AttendanceCorrection[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("attendance_corrections")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  // 참조 정보(학생 이름·회차 시각)는 임베딩 대신 명시 조회로 붙인다 — 조회가 비어도 목록은 뜬다.
  const scheduleIds = [...new Set(rows.map((r) => r.schedule_id as string))];
  const { data: scheds } = await db
    .from("schedules")
    .select("id, scheduled_at, students(name)")
    .eq("tenant_id", tenantId)
    .in("id", scheduleIds);
  const meta = new Map<string, { at: string; name: string | null }>();
  for (const s of (scheds ?? []) as (Record<string, unknown> & { students: unknown })[]) {
    meta.set(s.id as string, {
      at: s.scheduled_at as string,
      name: embeddedName(s.students),
    });
  }
  return rows.map((r) => {
    const m = meta.get(r.schedule_id as string);
    return mapCorrection(r, m?.name ?? null, m?.at ?? null);
  });
}

/* ---------- 귀속 미확정 회차 (L-10) ---------- */

export interface UnresolvedSchedule {
  id: string;
  studentId: string;
  studentName: string;
  scheduledAt: string;
  status: ScheduleItem["status"];
  originScheduleId: string | null;
}

export async function listUnresolvedSchedules(
  tenantId: string,
  limit = 100,
): Promise<UnresolvedSchedule[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("schedules")
    .select("id, student_id, scheduled_at, status, origin_schedule_id, students(name)")
    .eq("tenant_id", tenantId)
    .is("contract_id", null)
    .in("status", ["planned", "done", "makeup"])
    .order("scheduled_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as (Record<string, unknown> & { students: unknown })[]).map((r) => ({
    id: r.id as string,
    studentId: r.student_id as string,
    studentName: embeddedName(r.students) ?? "알 수 없음",
    scheduledAt: r.scheduled_at as string,
    status: r.status as ScheduleItem["status"],
    originScheduleId: (r.origin_schedule_id as string | null) ?? null,
  }));
}

export interface ContractCandidate {
  contractId: string;
  enrollmentId: string;
  agreedAt: string;
  activatedAt: string;
  endedAt: string | null;
}

/**
 * 회차의 유효 계약 후보(L-10). RPC resolve_schedule_contract와 같은 규칙으로 계산한다.
 * 표시용이며 판정 정본은 RPC의 WHERE다 — 조회와 확정 사이에 계약이 정정될 수 있다.
 */
export async function listContractCandidates(
  tenantId: string,
  scheduleId: string,
): Promise<ContractCandidate[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data: sched } = await db
    .from("schedules")
    .select("student_id, scheduled_at, origin_schedule_id")
    .eq("tenant_id", tenantId)
    .eq("id", scheduleId)
    .maybeSingle();
  if (!sched) return [];
  const s = sched as {
    student_id: string;
    scheduled_at: string;
    origin_schedule_id: string | null;
  };

  // 파생 회차는 원 회차의 귀속을 따른다 — 원 회차가 미확정이면 후보가 없다.
  if (s.origin_schedule_id) {
    const { data: origin } = await db
      .from("schedules")
      .select("contract_id")
      .eq("tenant_id", tenantId)
      .eq("id", s.origin_schedule_id)
      .maybeSingle();
    const contractId = (origin as { contract_id: string | null } | null)?.contract_id;
    if (!contractId) return [];
    const { data: c } = await db
      .from("contracts")
      .select("id, enrollment_id, agreed_at")
      .eq("tenant_id", tenantId)
      .eq("id", contractId)
      .maybeSingle();
    if (!c) return [];
    const row = c as { id: string; enrollment_id: string; agreed_at: string };
    return [
      {
        contractId: row.id,
        enrollmentId: row.enrollment_id,
        agreedAt: row.agreed_at,
        activatedAt: "",
        endedAt: null,
      },
    ];
  }

  const { data: enrollments } = await db
    .from("enrollments")
    .select("id, activated_at, ended_at")
    .eq("tenant_id", tenantId)
    .eq("student_id", s.student_id)
    .not("activated_at", "is", null);
  const inWindow = ((enrollments ?? []) as {
    id: string;
    activated_at: string;
    ended_at: string | null;
  }[]).filter(
    (e) =>
      e.activated_at <= s.scheduled_at &&
      (e.ended_at === null || e.ended_at >= s.scheduled_at),
  );
  if (inWindow.length === 0) return [];

  const { data: contracts } = await db
    .from("contracts")
    .select("id, enrollment_id, agreed_at")
    .eq("tenant_id", tenantId)
    .in("enrollment_id", inWindow.map((e) => e.id))
    .not("agreed_at", "is", null);
  const byEnrollment = new Map(inWindow.map((e) => [e.id, e]));
  return ((contracts ?? []) as {
    id: string;
    enrollment_id: string;
    agreed_at: string;
  }[]).map((c) => {
    const e = byEnrollment.get(c.enrollment_id);
    return {
      contractId: c.id,
      enrollmentId: c.enrollment_id,
      agreedAt: c.agreed_at,
      activatedAt: e?.activated_at ?? "",
      endedAt: e?.ended_at ?? null,
    };
  });
}

/* ---------- 예약 제한 (L-08) ---------- */

export async function listBookingRestrictions(
  tenantId: string,
): Promise<BookingRestriction[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("booking_restrictions")
    .select("*, students(name)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(100);
  return ((data ?? []) as (Record<string, unknown> & { students: unknown })[]).map((r) => ({
    id: r.id as string,
    studentId: r.student_id as string,
    studentName: embeddedName(r.students),
    status: r.status as BookingRestriction["status"],
    reason: r.reason as string,
    reviewOn: r.review_on as string,
    decidedBy: r.decided_by as string,
    decidedAt: r.decided_at as string,
    liftedAt: (r.lifted_at as string | null) ?? null,
    liftReason: (r.lift_reason as string | null) ?? null,
  }));
}

/** 새 예약·자리 제안을 막을 활성 제한이 있는지(L-08 "제한은 새 예약에만 적용"). */
export async function hasActiveBookingRestriction(
  tenantId: string,
  studentId: string,
): Promise<boolean> {
  const db = createServiceClient();
  if (!db) return false;
  const { data } = await db
    .from("booking_restrictions")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId)
    .eq("status", "active")
    .maybeSingle();
  return Boolean(data);
}

/* ---------- 활성 등록·동의 계약 (묶음 생성 폼용) ---------- */

export interface PackageTarget {
  enrollmentId: string;
  contractId: string;
  studentId: string;
  studentName: string;
  hasLivePackage: boolean;
}

export async function listPackageTargets(tenantId: string): Promise<PackageTarget[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data: enrollments } = await db
    .from("enrollments")
    .select("id, student_id, students(name)")
    .eq("tenant_id", tenantId)
    .eq("status", "active");
  const rows = ((enrollments ?? []) as (Record<string, unknown> & { students: unknown })[]).map((e) => ({
    id: e.id as string,
    studentId: e.student_id as string,
    studentName: embeddedName(e.students) ?? "알 수 없음",
  }));
  if (rows.length === 0) return [];

  const [{ data: contracts }, { data: packages }] = await Promise.all([
    db
      .from("contracts")
      .select("id, enrollment_id")
      .eq("tenant_id", tenantId)
      .in("enrollment_id", rows.map((r) => r.id))
      .not("agreed_at", "is", null),
    db
      .from("lesson_packages")
      .select("contract_id")
      .eq("tenant_id", tenantId)
      .in("status", ["draft", "active"]),
  ]);
  const live = new Set(
    ((packages ?? []) as { contract_id: string }[]).map((p) => p.contract_id),
  );
  const byEnrollment = new Map(rows.map((r) => [r.id, r]));
  return ((contracts ?? []) as { id: string; enrollment_id: string }[])
    .map((c) => {
      const e = byEnrollment.get(c.enrollment_id);
      if (!e) return null;
      return {
        enrollmentId: c.enrollment_id,
        contractId: c.id,
        studentId: e.studentId,
        studentName: e.studentName,
        hasLivePackage: live.has(c.id),
      };
    })
    .filter((x): x is PackageTarget => x !== null);
}
