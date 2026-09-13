import { createServiceClient } from "@/lib/supabase/server";
import { addKstDays, kstDateOnly, kstTodayDateOnly } from "@/lib/kst";

// 개인정보 보존기록 — 기산 사건 → 보존기한 → 파기 예정일 (정본 D-04) · 보존 잠금 (D-05).
// 표 구조와 "이 원장이 하지 않는 일"은 supabase/migrations/00023_privacy_retention.sql 주석에 있다.
//
// ─────────────────────────────────────────────────────────────────────────────
// 보존기한의 출처
//
// 아래 정책은 **공개 처리방침(lib/content/legal.ts PRIVACY_RETENTION_ROWS)에 이미 적혀 있는 값**을
// 그대로 옮긴 것이다. 새로 정한 기준이 아니다 — 밖에 약속한 기간과 안에서 계산하는 기간이
// 갈리면 원장 전체가 무의미해지므로, 방침 문구(label)까지 함께 박아 둔다.
// 방침을 고치면 여기도 같이 고쳐야 한다(이미 기산된 행은 당시 정책 스냅샷을 유지한다).

/** 데이터 종류(정책 키). retention_records.category에 그대로 들어간다. */
export type RetentionCategory =
  | "consultation_intake"
  | "student_service"
  | "consent_proof"
  | "payment_legal"
  | "review_consent";

export interface RetentionPolicy {
  /** 화면에 보여 줄 데이터 종류 이름. */
  label: string;
  /** 보존기한(일). */
  days: number;
  /** 공개 처리방침에 적힌 문구 — 증적으로 행에 박는다. */
  policyLabel: string;
}

export const RETENTION_POLICY: Record<RetentionCategory, RetentionPolicy> = {
  consultation_intake: {
    label: "정규 전환 없는 상담·시범수업 정보",
    days: 180,
    policyLabel: "내부 운영 기준: 상담 종료일부터 6개월",
  },
  student_service: {
    label: "정규 학생·일정·출결·수업·과제·AI 기록",
    days: 365,
    policyLabel: "내부 운영 기준: 서비스 종료일부터 12개월",
  },
  consent_proof: {
    label: "신청·동의 증명",
    days: 1095,
    policyLabel: "내부 운영 기준: 상담 종료 후 1년 또는 서비스 종료 후 3년",
  },
  payment_legal: {
    label: "계약·청약철회·대금·환불·현금영수증 기록",
    days: 1825,
    policyLabel: "법정 보존기간: 5년",
  },
  review_consent: {
    label: "후기·사례 동의·철회 최소 증명",
    days: 1095,
    policyLabel: "내부 운영 기준: 철회·종료 후 3년",
  },
};

/** 기산 사건(정본 D-04의 사건 목록 중 코드에 실제 타임스탬프가 있는 것). */
export type RetentionEvent =
  | "enrollment_ended"
  | "waitlist_closed"
  | "payment_settled";

export const RETENTION_EVENT_LABEL: Record<RetentionEvent, string> = {
  enrollment_ended: "등록·계약 종료",
  waitlist_closed: "대기 철회·만료",
  payment_settled: "거래 종료(완납)",
};

/**
 * 아직 자동 기산하지 않는 기산 사건 — **그 사건 자체가 코드에 없기 때문**이다.
 *
 * 화면에 그대로 띄운다. 원장이 비어 있는 이유를 운영자가 알아야 "우리 데이터는 다 정리됐다"는
 * 잘못된 안심을 하지 않는다. 사건이 구현되면 여기서 빼고 위 RetentionEvent에 넣는다.
 */
export const RETENTION_EVENTS_NOT_TRACKED = [
  {
    label: "콘텐츠·후기 철회",
    reason:
      "후기를 철회로 전환하는 코드가 없고(S-03 미구현 — retracted는 상태값·라벨로만 존재), 철회 시각 컬럼도 없다(00016의 retracted_at은 ai_reports에만 붙었다).",
  },
  {
    label: "상담·시범 미전환 종결",
    reason:
      "상담에 '종결' 상태가 없다(consultations.status는 신규·연락·시범·등록·보류 다섯 가지) — 종결 시각이 없으니 기산할 값이 없다.",
  },
  {
    label: "폼·초대·상태조회 권한 만료",
    reason:
      "신청폼·포털 초대에는 만료가 아니라 회수만 있다(초대 링크는 무기한·회수로만 종료).",
  },
  {
    label: "거래 분쟁 종료",
    reason: "분쟁 접수·종료를 기록하는 곳이 아직 없다(F-02 요청 접수 미구현).",
  },
  {
    label: "계정 탈퇴",
    reason: "정보주체 권리 요청 접수 창구가 아직 없다(D-02 미구현).",
  },
] as const;

export type RetentionState = "held" | "due" | "keeping" | "destroyed";

export interface RetentionRecord {
  id: string;
  subjectType: "student" | "consultation" | "payment" | "review";
  subjectId: string;
  subjectLabel: string;
  category: RetentionCategory;
  categoryLabel: string;
  event: string;
  eventLabel: string;
  startedAt: string;
  /** "YYYY-MM-DD" (KST 달력일) */
  retainUntil: string;
  policyDays: number;
  policyLabel: string;
  holdAt: string | null;
  holdReason: string | null;
  holdBy: string | null;
  destroyedAt: string | null;
  destroyedBy: string | null;
  destroyedNote: string | null;
  /** 오늘(KST) 기준 상태 — 화면 분류의 단일 기준. */
  state: RetentionState;
  /** 파기 예정일까지 남은 일수(KST). 지났으면 음수. */
  daysLeft: number;
}

/**
 * 이름 가림 — 원장은 "개인정보 없는 대상 요약"이어야 한다(D-06).
 * 성만 남기고 마지막 글자를 남겨 동명이인 구분은 되게 한다.
 */
export function maskName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 1) return "*";
  if (trimmed.length === 2) return `${trimmed[0]}*`;
  return `${trimmed[0]}${"*".repeat(trimmed.length - 2)}${trimmed.at(-1)}`;
}

/** 기산일(UTC instant) + 보존기한(일) → 파기 예정일(KST 달력일). */
export function retainUntil(startedAt: string, days: number): string {
  const startDate = kstDateOnly(startedAt);
  if (!startDate) return kstTodayDateOnly();
  return addKstDays(startDate, days);
}

function daysBetween(fromDateOnly: string, toDateOnly: string): number {
  const a = Date.UTC(
    Number(fromDateOnly.slice(0, 4)),
    Number(fromDateOnly.slice(5, 7)) - 1,
    Number(fromDateOnly.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(toDateOnly.slice(0, 4)),
    Number(toDateOnly.slice(5, 7)) - 1,
    Number(toDateOnly.slice(8, 10)),
  );
  return Math.round((b - a) / 86_400_000);
}

interface RetentionRow {
  id: string;
  subject_type: string;
  subject_id: string;
  subject_label: string;
  category: string;
  event: string;
  started_at: string;
  retain_until: string;
  policy_days: number;
  policy_label: string;
  hold_at: string | null;
  hold_reason: string | null;
  hold_by: string | null;
  destroyed_at: string | null;
  destroyed_by: string | null;
  destroyed_note: string | null;
}

function isCategory(value: string): value is RetentionCategory {
  return Object.hasOwn(RETENTION_POLICY, value);
}

function mapRow(row: RetentionRow, today: string): RetentionRecord {
  const category = isCategory(row.category) ? row.category : "student_service";
  const daysLeft = daysBetween(today, row.retain_until);
  // 순서가 곧 우선순위다: 파기된 것은 끝, 잠긴 것은 기한이 지나도 파기 대상이 아니다(D-05).
  const state: RetentionState = row.destroyed_at
    ? "destroyed"
    : row.hold_at
      ? "held"
      : daysLeft <= 0
        ? "due"
        : "keeping";
  return {
    id: row.id,
    subjectType: row.subject_type as RetentionRecord["subjectType"],
    subjectId: row.subject_id,
    subjectLabel: row.subject_label,
    category,
    categoryLabel: RETENTION_POLICY[category].label,
    event: row.event,
    eventLabel:
      RETENTION_EVENT_LABEL[row.event as RetentionEvent] ?? row.event,
    startedAt: row.started_at,
    retainUntil: row.retain_until,
    policyDays: row.policy_days,
    policyLabel: row.policy_label,
    holdAt: row.hold_at,
    holdReason: row.hold_reason,
    holdBy: row.hold_by,
    destroyedAt: row.destroyed_at,
    destroyedBy: row.destroyed_by,
    destroyedNote: row.destroyed_note,
    state,
    daysLeft,
  };
}

export async function listRetentionRecords(
  tenantId: string,
): Promise<RetentionRecord[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data, error } = await db
    .from("retention_records")
    .select(
      "id, subject_type, subject_id, subject_label, category, event, started_at, retain_until, policy_days, policy_label, hold_at, hold_reason, hold_by, destroyed_at, destroyed_by, destroyed_note",
    )
    .eq("tenant_id", tenantId)
    .order("retain_until", { ascending: true });
  if (error) {
    console.error("[retention] list failed", error);
    return [];
  }
  const today = kstTodayDateOnly();
  return ((data ?? []) as RetentionRow[]).map((r) => mapRow(r, today));
}

/* ==================================================================
   기산 — 원 데이터를 훑어 보존기록을 만들거나 갱신한다
   ================================================================== */

interface DerivedRecord {
  subjectType: RetentionRecord["subjectType"];
  subjectId: string;
  subjectLabel: string;
  category: RetentionCategory;
  event: RetentionEvent;
  startedAt: string;
}

export interface RecomputeResult {
  ok: boolean;
  created: number;
  updated: number;
  /** 이미 파기 기록이 있어 건드리지 않은 행. */
  skippedDestroyed: number;
  error?: string;
}

/**
 * 기산 사건을 훑어 보존기록을 만들거나 기산일을 미룬다. 여러 번 돌려도 결과가 같다(멱등).
 *
 * 규칙 셋:
 *  ① 기산일은 **뒤로만** 간다. 같은 대상에 늦은 사건이 새로 생기면(재등록 등) 목적이 다시
 *     생긴 것이므로 기한을 다시 잡는다(D-04). 이른 사건으로 되돌리지는 않는다.
 *  ② **파기 기록이 있는 행은 건드리지 않는다.** 그 행은 이미 증적이다 — 덮어쓰면 언제 무엇을
 *     파기했는지가 사라진다.
 *  ③ **보존 잠금은 유지한다.** 기산일이 밀려도 잠금은 운영자가 풀 때까지 그대로다(D-05).
 *
 * 이 함수가 기산하지 못하는 사건은 RETENTION_EVENTS_NOT_TRACKED에 이유와 함께 적혀 있다.
 */
export async function recomputeRetention(tenantId: string): Promise<RecomputeResult> {
  const db = createServiceClient();
  if (!db) {
    return { ok: false, created: 0, updated: 0, skippedDestroyed: 0, error: "DB 미연결" };
  }

  const derived: DerivedRecord[] = [];

  // 이름은 별도 조회로 채운다 — 이 표들은 students·consultations를 복합 FK(tenant_id, id)로
  // 참조하고, 레포의 기존 조회도 임베드 대신 두 단계로 읽는다(lib/data/intake.ts
  // consultationBriefs). 한 번 모아 읽고 Map으로 붙인다.
  const studentNames = new Map<string, string>();
  const consultationNames = new Map<string, string>();

  const loadStudentNames = async (ids: string[]) => {
    const missing = [...new Set(ids)].filter((id) => !studentNames.has(id));
    if (missing.length === 0) return true;
    const { data, error } = await db
      .from("students")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .in("id", missing);
    if (error) {
      console.error("[retention] students 조회 실패", error);
      return false;
    }
    for (const row of (data ?? []) as { id: string; name: string }[]) {
      studentNames.set(row.id, row.name);
    }
    return true;
  };

  const fail = (message: string): RecomputeResult => ({
    ok: false,
    created: 0,
    updated: 0,
    skippedDestroyed: 0,
    error: message,
  });

  // ① 등록·계약 종료 → 학생 계열(12개월) + 동의 증명(3년).
  //    ended_at은 M2가 "보존기한·정산 대사의 기산점"으로 남기기 시작한 값이다.
  const { data: enrollments, error: enrollError } = await db
    .from("enrollments")
    .select("student_id, ended_at")
    .eq("tenant_id", tenantId)
    .eq("status", "ended")
    .not("ended_at", "is", null);
  if (enrollError) {
    console.error("[retention] enrollments 조회 실패", enrollError);
    return fail("등록 조회 실패");
  }
  const endedRows = (enrollments ?? []) as { student_id: string; ended_at: string }[];
  if (!(await loadStudentNames(endedRows.map((r) => r.student_id)))) {
    return fail("학생 이름 조회 실패");
  }
  for (const row of endedRows) {
    const label = maskName(studentNames.get(row.student_id) ?? "");
    for (const category of ["student_service", "consent_proof"] as const) {
      derived.push({
        subjectType: "student",
        subjectId: row.student_id,
        subjectLabel: label,
        category,
        event: "enrollment_ended",
        startedAt: row.ended_at,
      });
    }
  }

  // ② 대기 철회·만료 → 상담 계열(6개월). 자리가 반환된 시각이 그 사람과의 접점이 끝난 시각이다.
  //
  //    만료(expired)에는 responded_at이 없다 — 만료는 사람의 응답이 아니라서 그 컬럼을 비워
  //    두는 것이 규약이다(00018 constraint waitlist_offers_response_needs_time,
  //    recruit/actions.ts closeWaitlistOffer). 그래서 만료는 회신 기한(expires_at)을 기산 시각으로
  //    쓴다 — 자리가 실제로 돌아온 시점이 그때다.
  const { data: offers, error: offerError } = await db
    .from("waitlist_offers")
    .select("consultation_id, responded_at, expires_at, status")
    .eq("tenant_id", tenantId)
    .in("status", ["declined", "expired"]);
  if (offerError) {
    console.error("[retention] waitlist_offers 조회 실패", offerError);
    return fail("대기 제안 조회 실패");
  }
  const offerRows = (offers ?? []) as {
    consultation_id: string | null;
    responded_at: string | null;
    expires_at: string;
    status: string;
  }[];
  const consultationIds = [
    ...new Set(
      offerRows
        .map((r) => r.consultation_id)
        .filter((v): v is string => v !== null),
    ),
  ];
  if (consultationIds.length > 0) {
    const { data: consultRows, error: consultError } = await db
      .from("consultations")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .in("id", consultationIds);
    if (consultError) {
      console.error("[retention] consultations 조회 실패", consultError);
      return fail("상담 이름 조회 실패");
    }
    for (const row of (consultRows ?? []) as { id: string; name: string }[]) {
      consultationNames.set(row.id, row.name);
    }
  }
  for (const row of offerRows) {
    if (!row.consultation_id) continue;
    const startedAt = row.responded_at ?? row.expires_at;
    derived.push({
      subjectType: "consultation",
      subjectId: row.consultation_id,
      subjectLabel: maskName(consultationNames.get(row.consultation_id) ?? ""),
      category: "consultation_intake",
      event: "waitlist_closed",
      startedAt,
    });
  }

  // ③ 완납 → 법정 5년. 청구·수납·환불·현금영수증이 한 결제 행에 묶여 있으므로 대상도 그 행이다.
  const { data: payments, error: payError } = await db
    .from("payments")
    .select("id, student_id, paid_at")
    .eq("tenant_id", tenantId)
    .eq("status", "paid")
    .not("paid_at", "is", null);
  if (payError) {
    console.error("[retention] payments 조회 실패", payError);
    return fail("결제 조회 실패");
  }
  const paidRows = (payments ?? []) as {
    id: string;
    student_id: string;
    paid_at: string;
  }[];
  if (!(await loadStudentNames(paidRows.map((r) => r.student_id)))) {
    return fail("학생 이름 조회 실패");
  }
  for (const row of paidRows) {
    derived.push({
      subjectType: "payment",
      subjectId: row.id,
      subjectLabel: `${maskName(studentNames.get(row.student_id) ?? "")} 결제`,
      category: "payment_legal",
      event: "payment_settled",
      startedAt: row.paid_at,
    });
  }

  // 후기 철회(review_consent)는 여기 없다 — 기산할 시각이 없기 때문이다.
  // reviews에는 철회 시각 컬럼이 없고(00016의 retracted_at은 ai_reports에 붙었다), 애초에
  // 후기를 retracted로 전환하는 코드도 없다(S-03 미구현). 없는 사건을 updated_at 같은 대체
  // 값으로 지어내면 원장이 거짓이 되므로, RETENTION_EVENTS_NOT_TRACKED에 이유를 적고 비워 둔다.

  // 같은 (대상, 종류)에 사건이 여럿이면 가장 늦은 것만 남긴다(규칙 ①).
  const latest = new Map<string, DerivedRecord>();
  for (const d of derived) {
    const key = `${d.subjectType}:${d.subjectId}:${d.category}`;
    const prev = latest.get(key);
    if (!prev || d.startedAt > prev.startedAt) latest.set(key, d);
  }

  const { data: existingRows, error: existingError } = await db
    .from("retention_records")
    .select("id, subject_type, subject_id, category, started_at, destroyed_at")
    .eq("tenant_id", tenantId);
  if (existingError) {
    console.error("[retention] 기존 원장 조회 실패", existingError);
    return fail("원장 조회 실패");
  }
  const existing = new Map<
    string,
    { id: string; started_at: string; destroyed_at: string | null }
  >();
  for (const row of (existingRows ?? []) as {
    id: string;
    subject_type: string;
    subject_id: string;
    category: string;
    started_at: string;
    destroyed_at: string | null;
  }[]) {
    existing.set(`${row.subject_type}:${row.subject_id}:${row.category}`, {
      id: row.id,
      started_at: row.started_at,
      destroyed_at: row.destroyed_at,
    });
  }

  let created = 0;
  let updated = 0;
  let skippedDestroyed = 0;

  for (const [key, d] of latest) {
    const policy = RETENTION_POLICY[d.category];
    const until = retainUntil(d.startedAt, policy.days);
    const prev = existing.get(key);

    if (!prev) {
      const { error } = await db.from("retention_records").insert({
        tenant_id: tenantId,
        subject_type: d.subjectType,
        subject_id: d.subjectId,
        subject_label: d.subjectLabel,
        category: d.category,
        event: d.event,
        started_at: d.startedAt,
        retain_until: until,
        policy_days: policy.days,
        policy_label: policy.policyLabel,
      });
      if (error) {
        console.error("[retention] insert 실패", error);
        return {
          ok: false,
          created,
          updated,
          skippedDestroyed,
          error: "보존기록 적재에 실패했습니다.",
        };
      }
      created += 1;
      continue;
    }

    if (prev.destroyed_at) {
      // 규칙 ② — 증적을 덮어쓰지 않는다.
      skippedDestroyed += 1;
      continue;
    }
    if (d.startedAt <= prev.started_at) continue; // 규칙 ① — 기산일은 뒤로만.

    // tenant-scope-ok: prev.id는 바로 위에서 tenant_id로 좁혀 읽은 행의 id다.
    const { error } = await db
      .from("retention_records")
      .update({
        subject_label: d.subjectLabel,
        event: d.event,
        started_at: d.startedAt,
        retain_until: until,
        policy_days: policy.days,
        policy_label: policy.policyLabel,
        updated_at: new Date().toISOString(),
      })
      .eq("id", prev.id);
    if (error) {
      console.error("[retention] update 실패", error);
      return {
        ok: false,
        created,
        updated,
        skippedDestroyed,
        error: "보존기록 갱신에 실패했습니다.",
      };
    }
    updated += 1;
  }

  return { ok: true, created, updated, skippedDestroyed };
}
