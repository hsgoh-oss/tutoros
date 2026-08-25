// 유입 퍼널 데이터 계층 — 신청폼·시범 회차·정규 등록·대기 자리 (M2).
// 스키마 정본: supabase/migrations/00018_intake.sql
//   (intake_forms · trial_sessions · trial_results · enrollments · contracts · waitlist_offers
//    — 컬럼·상태값·부분 유니크·트리거는 그쪽 주석 참조).
// 스타일은 lib/data/crm.ts·homework.ts와 같다(snake_case DB ↔ camelCase 앱, DB 미연결 시 빈 배열/null).
//
// 정본 규칙(docs/flow-canon/01_atlas_01_intake.md · 03_scenarios_133.md):
//   - T-01·검수 7: 같은 상담의 같은 종류(kind) 활성 폼은 하나 — 새 폼을 발급하면 이전 sent 폼을 닫는다
//     (DB 부분 유니크가 강제). 이 파일의 getActiveForm이 '닫을 대상' 조회다.
//   - 검수 8·9(T-02): 폼 제출만으로 일정이 확정되지 않는다. 유료 시범은 일정 확정과 결제 확인이
//     둘 다 있어야 status=scheduled다. 무료 시범은 결제 단계를 '통과 처리'하는 게 아니라
//     is_paid=false로 결제 불필요임을 근거로 남긴다 — pendingGates가 그 판정을 그대로 계산한다.
//   - T-04: 시범 결과는 덮어쓰지 않는다 — trial_results는 append-only(UPDATE·DELETE 거부 트리거)이고
//     현재 결과는 '가장 최근 결정'이다. 이력 전체를 함께 반환해 이전 결정도 화면에 남는다.
//   - R-04·검수 12·13·14: 네 게이트(관계·계약·결제·일정)가 모두 true여야 등록이 활성화된다.
//     미충족이면 pending('등록 준비 중')에 머물고, 결제 확인 전에는 확정 수업으로 안내하지 않는다.
//   - O-04·검수 61·62·63: 남은 자리는 recruit_status.seat_count 대비 활성 등록 + 열린 자리 제안으로
//     산정한다. 열린 제안은 기한이 지났어도 자리를 점유한 것으로 세고(자동 반환 금지),
//     같은 자리 번호에 열린 제안이 있으면 그 자리에 새 제안을 만들지 않는다.
//
// 이 파일은 조회 전용이다. 상태 전환(폼 발급·시범 확정·결과 결정·등록 활성·자리 제안)은 서버 액션이 한다.
// 특히 등록 활성화의 판정 정본은 여기서 계산한 pendingGates가 아니라 RPC activate_enrollment의 WHERE다
// (조회 → 활성화 사이에 게이트가 뒤집힐 수 있다 — 반쪽 활성 금지, 검수 12·15). pendingGates는 표시용이다.
//
// 부모 이름·전화 같은 참조 정보는 PostgREST 임베딩(`consultations(name)`) 대신 명시 조회 + Map 매핑으로
// 붙인다 — 00018은 신규 테이블이라 관계 캐시·복합 FK 힌트에 조회 성공 여부를 걸지 않기 위해서다
// (참조 조회가 비어도 목록 자체는 뜨고 이름만 null이 된다).

import { createServiceClient } from "@/lib/supabase/server";
import { getRecruitStatus } from "@/lib/data/crm";
import type {
  EnrollmentStatus,
  IntakeFormKind,
  IntakeFormStatus,
  PaymentStatus,
  RecruitState,
  TrialResult,
  TrialStatus,
  WaitlistOfferStatus,
} from "@/lib/types";

type Db = NonNullable<ReturnType<typeof createServiceClient>>;

/* ---------- 공용 유틸 ---------- */

/** 기한 경과 판정 — null(기한 없음)·파싱 불가는 '경과 아님'. 시각 비교만 하고 상태를 바꾸지 않는다. */
function isPast(iso: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t < Date.now();
}

/** 상담 요약(이름·연락처) — 목록에 신청자 표시용. 폼·시범·대기 목록이 공유한다. */
export interface ConsultationBrief {
  id: string;
  name: string;
  phone: string;
}

async function consultationBriefs(
  db: Db,
  tenantId: string,
  ids: string[],
): Promise<Map<string, ConsultationBrief>> {
  const map = new Map<string, ConsultationBrief>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return map;
  const { data } = await db
    .from("consultations")
    .select("id,name,phone")
    .eq("tenant_id", tenantId)
    .in("id", unique);
  for (const row of (data ?? []) as ConsultationBrief[]) map.set(row.id, row);
  return map;
}

async function studentNames(
  db: Db,
  tenantId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return map;
  const { data } = await db
    .from("students")
    .select("id,name")
    .eq("tenant_id", tenantId)
    .in("id", unique);
  for (const row of (data ?? []) as { id: string; name: string }[]) {
    map.set(row.id, row.name);
  }
  return map;
}

/* ---------- ① 신청폼 (intake_forms · T-01·R-01) ---------- */

/**
 * token_hash는 select 목록에서 뺀다 — 링크 대조는 해시 값을 인자로 받아 DB에서 수행하고,
 * 앱 레이어·서버 컴포넌트 직렬화 경로에 해시를 얹지 않는다.
 */
const FORM_COLUMNS =
  "id,consultation_id,kind,status,payload,sent_at,submitted_at,closed_at,close_reason,expires_at";

interface IntakeFormRow {
  id: string;
  consultation_id: string;
  kind: IntakeFormKind;
  status: IntakeFormStatus;
  payload: Record<string, unknown> | null;
  sent_at: string | null;
  submitted_at: string | null;
  closed_at: string | null;
  close_reason: string | null;
  expires_at: string | null;
}

export interface IntakeForm {
  id: string;
  consultationId: string;
  kind: IntakeFormKind;
  status: IntakeFormStatus;
  /** 제출 내용(jsonb) — 미제출이면 null. 필드 구성은 폼 종류별로 제출 액션이 정한다. */
  payload: Record<string, unknown> | null;
  sentAt: string | null;
  submittedAt: string | null;
  closedAt: string | null;
  /** 닫힌 사유 — 새 폼 발급·상담 결과 변경·철회 등(검수 6·7). */
  closeReason: string | null;
  expiresAt: string | null;
  /** 기한이 지났는데 아직 sent — 링크 종료 후 재발급 대상(T-01). 조회가 상태를 바꾸지는 않는다. */
  isExpired: boolean;
  /** 지금 이 링크로 작성할 수 있는가 — sent이고 기한 전. */
  isOpen: boolean;
}

function mapForm(row: IntakeFormRow): IntakeForm {
  const expired = row.status === "sent" && isPast(row.expires_at);
  return {
    id: row.id,
    consultationId: row.consultation_id,
    kind: row.kind,
    status: row.status,
    payload: row.payload,
    sentAt: row.sent_at,
    submittedAt: row.submitted_at,
    closedAt: row.closed_at,
    closeReason: row.close_reason,
    expiresAt: row.expires_at,
    isExpired: expired,
    isOpen: row.status === "sent" && !expired,
  };
}

export interface IntakeFormFilters {
  consultationId?: string;
  kind?: IntakeFormKind;
  status?: IntakeFormStatus;
}

export interface IntakeFormListItem extends IntakeForm {
  consultationName: string | null;
  consultationPhone: string | null;
}

/** 신청폼 목록(운영자) — 발송 시각 최신순. 신청자 표시는 상담 요약을 붙여서 준다. */
export async function listForms(
  tenantId: string,
  filters: IntakeFormFilters = {},
): Promise<IntakeFormListItem[]> {
  const db = createServiceClient();
  if (!db) return [];
  let query = db
    .from("intake_forms")
    .select(FORM_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("sent_at", { ascending: false });
  if (filters.consultationId) query = query.eq("consultation_id", filters.consultationId);
  if (filters.kind) query = query.eq("kind", filters.kind);
  if (filters.status) query = query.eq("status", filters.status);
  const { data } = await query;
  const rows = (data ?? []) as unknown as IntakeFormRow[];
  if (rows.length === 0) return [];
  const briefs = await consultationBriefs(
    db,
    tenantId,
    rows.map((r) => r.consultation_id),
  );
  return rows.map((row) => {
    const brief = briefs.get(row.consultation_id);
    return {
      ...mapForm(row),
      consultationName: brief?.name ?? null,
      consultationPhone: brief?.phone ?? null,
    };
  });
}

export interface IntakeFormDetail extends IntakeForm {
  consultationName: string | null;
}

/**
 * 링크 토큰 해시로 폼 조회(공개 작성 화면) — 원문 토큰은 호출부가 해시해서 넘긴다.
 * 존재 여부와 무관하게 같은 모양으로 실패해야 하므로, 못 찾으면 null만 준다(사유 구분 없음).
 * 작성 가능 여부는 isOpen으로 판단한다 — 닫힌·만료 링크도 행은 남아 화면이 안내를 띄울 수 있다.
 */
export async function getFormByTokenHash(
  tenantId: string,
  tokenHash: string,
): Promise<IntakeFormDetail | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("intake_forms")
    .select(FORM_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as IntakeFormRow;
  const briefs = await consultationBriefs(db, tenantId, [row.consultation_id]);
  return {
    ...mapForm(row),
    // 이름만 붙인다 — 공개 화면에 연락처까지 되돌려주지 않는다(오수신 대비).
    consultationName: briefs.get(row.consultation_id)?.name ?? null,
  };
}

/**
 * 같은 상담·같은 종류의 현재 활성 폼(status='sent') — 없으면 null.
 * 새 폼을 발급하는 액션이 '닫을 이전 폼'을 찾는 데 쓴다(검수 7). 부분 유니크 덕에 최대 1건이다.
 * 기한이 지난 sent 폼도 여기 걸린다 — 만료 확정 전까지는 그 자리를 비워 두지 않는다.
 */
export async function getActiveForm(
  tenantId: string,
  consultationId: string,
  kind: IntakeFormKind,
): Promise<IntakeForm | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("intake_forms")
    .select(FORM_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("consultation_id", consultationId)
    .eq("kind", kind)
    .eq("status", "sent")
    .maybeSingle();
  return data ? mapForm(data as unknown as IntakeFormRow) : null;
}

/** 폼 조회(운영자 상세) — 상담 상세 화면에서 특정 폼 한 건을 여는 용도. */
export async function getForm(
  tenantId: string,
  id: string,
): Promise<IntakeFormDetail | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("intake_forms")
    .select(FORM_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as IntakeFormRow;
  const briefs = await consultationBriefs(db, tenantId, [row.consultation_id]);
  return { ...mapForm(row), consultationName: briefs.get(row.consultation_id)?.name ?? null };
}

/* ---------- ② 시범 회차 (trial_sessions · trial_results · T-02~T-04) ---------- */

/** 시범 확정(scheduled)까지 남은 조건. 무료 시범에는 payment 게이트가 애초에 걸리지 않는다(T-02). */
export type TrialGate = "schedule" | "payment";

export const TRIAL_GATE_LABEL: Record<TrialGate, string> = {
  schedule: "일정 확정",
  payment: "결제 확인",
};

interface TrialSessionRow {
  id: string;
  consultation_id: string;
  form_id: string | null;
  scheduled_at: string | null;
  is_paid: boolean;
  payment_id: string | null;
  schedule_confirmed: boolean;
  payment_confirmed: boolean;
  status: TrialStatus;
  attended_at: string | null;
  canceled_reason: string | null;
  created_at: string;
}

export interface TrialSession {
  id: string;
  consultationId: string;
  /** 이 회차를 만든 시범 신청폼 — 폼 없이 운영자가 직접 만든 회차면 null. */
  formId: string | null;
  scheduledAt: string | null;
  /** 유료 시범 여부 — false면 결제 불필요(결제 통과 처리와 구분되는 근거, T-02). */
  isPaid: boolean;
  paymentId: string | null;
  scheduleConfirmed: boolean;
  paymentConfirmed: boolean;
  status: TrialStatus;
  attendedAt: string | null;
  canceledReason: string | null;
  createdAt: string;
  /** 확정까지 남은 게이트 — 비어 있으면 확정 가능(검수 8·9). 확정 자체는 액션이 수행한다. */
  pendingGates: TrialGate[];
  /** 결제 확인이 필요한 회차인가 — is_paid의 표시용 별칭(무료면 false = 결제 불필요). */
  paymentRequired: boolean;
}

/**
 * 남은 확정 조건 계산.
 *  · 일정: 일시가 있고 확정 표시까지 돼야 통과 — 폼 제출·일시 입력만으로는 확정이 아니다(검수 8).
 *  · 결제: 유료일 때만 본다. 무료 시범에서 payment_confirmed가 true여도 그건 '결제 불필요'라는 뜻이라
 *    게이트로 세지 않는다(T-02 — 결제 단계를 통과 처리하지 않는다).
 */
function trialPendingGates(row: TrialSessionRow): TrialGate[] {
  const gates: TrialGate[] = [];
  if (!row.scheduled_at || !row.schedule_confirmed) gates.push("schedule");
  if (row.is_paid && !row.payment_confirmed) gates.push("payment");
  return gates;
}

function mapTrialSession(row: TrialSessionRow): TrialSession {
  return {
    id: row.id,
    consultationId: row.consultation_id,
    formId: row.form_id,
    scheduledAt: row.scheduled_at,
    isPaid: row.is_paid,
    paymentId: row.payment_id,
    scheduleConfirmed: row.schedule_confirmed,
    paymentConfirmed: row.payment_confirmed,
    status: row.status,
    attendedAt: row.attended_at,
    canceledReason: row.canceled_reason,
    createdAt: row.created_at,
    pendingGates: trialPendingGates(row),
    paymentRequired: row.is_paid,
  };
}

interface TrialResultRow {
  id: string;
  trial_session_id: string;
  result: TrialResult;
  note: string | null;
  decided_by: string | null;
  decided_at: string;
}

/** 시범 결과 한 건 — 이력의 한 줄이다. 결과가 바뀌면 이 행을 고치지 않고 새 행이 쌓인다(T-04). */
export interface TrialResultRecord {
  id: string;
  trialSessionId: string;
  result: TrialResult;
  note: string | null;
  decidedBy: string | null;
  decidedAt: string;
}

function mapTrialResult(row: TrialResultRow): TrialResultRecord {
  return {
    id: row.id,
    trialSessionId: row.trial_session_id,
    result: row.result,
    note: row.note,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
  };
}

export interface TrialSessionFilters {
  consultationId?: string;
  status?: TrialStatus;
}

export interface TrialSessionListItem extends TrialSession {
  consultationName: string | null;
  consultationPhone: string | null;
  /** 가장 최근 결정 = 현재 결과(없으면 null). 정규 폼 발급 가능 판정의 근거다(검수 11). */
  latestResult: TrialResultRecord | null;
}

/** 시범 회차 목록(운영자) — 생성 최신순. 현재 결과(최근 결정 1건)를 함께 붙인다. */
export async function listTrialSessions(
  tenantId: string,
  filters: TrialSessionFilters = {},
): Promise<TrialSessionListItem[]> {
  const db = createServiceClient();
  if (!db) return [];
  let query = db
    .from("trial_sessions")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (filters.consultationId) query = query.eq("consultation_id", filters.consultationId);
  if (filters.status) query = query.eq("status", filters.status);
  const { data } = await query;
  const rows = (data ?? []) as TrialSessionRow[];
  if (rows.length === 0) return [];

  const briefs = await consultationBriefs(
    db,
    tenantId,
    rows.map((r) => r.consultation_id),
  );
  // 현재 결과 — decided_at 오름차순으로 훑어 마지막 결정만 남긴다(append-only라 최신이 현재 결과).
  const { data: resultRows } = await db
    .from("trial_results")
    .select("*")
    .eq("tenant_id", tenantId)
    .in(
      "trial_session_id",
      rows.map((r) => r.id),
    )
    .order("decided_at", { ascending: true });
  const latest = new Map<string, TrialResultRecord>();
  for (const r of (resultRows ?? []) as TrialResultRow[]) {
    latest.set(r.trial_session_id, mapTrialResult(r));
  }

  return rows.map((row) => {
    const brief = briefs.get(row.consultation_id);
    return {
      ...mapTrialSession(row),
      consultationName: brief?.name ?? null,
      consultationPhone: brief?.phone ?? null,
      latestResult: latest.get(row.id) ?? null,
    };
  });
}

/** 시범 회차에 연결된 결제 요약 — 결제 확인 게이트의 근거 표시용. */
export interface TrialPaymentBrief {
  id: string;
  amount: number;
  status: PaymentStatus;
  paidAt: string | null;
}

export interface TrialSessionDetail extends TrialSession {
  consultationName: string | null;
  consultationPhone: string | null;
  /** 결과 이력 전체 — 결정 시각 오름차순(이전 결정도 남는다, T-04). */
  results: TrialResultRecord[];
  /** 현재 결과 = 이력의 마지막 결정. 없으면 null(아직 결과 미결정). */
  latestResult: TrialResultRecord | null;
  /** 연결된 결제(유료 시범) — 없거나 조회 실패면 null. 결제 확인은 이 값이 아니라 payment_confirmed가 정본이다. */
  payment: TrialPaymentBrief | null;
}

/** 시범 회차 상세 — 결과 이력 포함(T-04). */
export async function getTrialSession(
  tenantId: string,
  id: string,
): Promise<TrialSessionDetail | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("trial_sessions")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as TrialSessionRow;

  const { data: resultRows } = await db
    .from("trial_results")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("trial_session_id", id)
    .order("decided_at", { ascending: true });
  const results = ((resultRows ?? []) as TrialResultRow[]).map(mapTrialResult);

  let payment: TrialPaymentBrief | null = null;
  if (row.payment_id) {
    const { data: pay } = await db
      .from("payments")
      .select("id,amount,status,paid_at")
      .eq("tenant_id", tenantId)
      .eq("id", row.payment_id)
      .maybeSingle();
    if (pay) {
      const p = pay as { id: string; amount: number; status: PaymentStatus; paid_at: string | null };
      payment = { id: p.id, amount: p.amount, status: p.status, paidAt: p.paid_at };
    }
  }

  const briefs = await consultationBriefs(db, tenantId, [row.consultation_id]);
  const brief = briefs.get(row.consultation_id);
  return {
    ...mapTrialSession(row),
    consultationName: brief?.name ?? null,
    consultationPhone: brief?.phone ?? null,
    results,
    latestResult: results.length > 0 ? results[results.length - 1] : null,
    payment,
  };
}

/* ---------- ③ 정규 등록·계약 (enrollments · contracts · R-02~R-06) ---------- */

/**
 * 활성화 게이트 넷(R-04·검수 12).
 * 정본 R-04의 네 조건은 계약·결제·일정·정원인데, 정원은 등록 행의 플래그가 아니라
 * recruit_status 대비 활성 등록 수로 산정한다(getSeatAvailability, O-04).
 * 등록 행에는 대신 관계 확인(R-02 — 미성년 보호자·계약자·납부자 관계)이 게이트로 들어간다.
 */
export type EnrollmentGate = "relation" | "contract" | "payment" | "schedule";

export const ENROLLMENT_GATE_LABEL: Record<EnrollmentGate, string> = {
  relation: "관계 확인",
  contract: "계약 수락",
  payment: "결제 확인",
  schedule: "일정 확정",
};

interface EnrollmentRow {
  id: string;
  student_id: string;
  consultation_id: string | null;
  form_id: string | null;
  status: EnrollmentStatus;
  relation_ok: boolean;
  contract_ok: boolean;
  payment_ok: boolean;
  schedule_ok: boolean;
  activated_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  created_at: string;
}

export interface Enrollment {
  id: string;
  studentId: string;
  consultationId: string | null;
  /** 이 등록을 만든 정규 신청폼 — 운영자 직접 등록이면 null. */
  formId: string | null;
  status: EnrollmentStatus;
  relationOk: boolean;
  contractOk: boolean;
  paymentOk: boolean;
  scheduleOk: boolean;
  activatedAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  createdAt: string;
  /**
   * 남은 게이트 — 비어 있으면 활성화를 시도할 수 있다는 표시일 뿐이다(검수 13·14의 '등록 준비 중' 근거).
   * 실제 활성 판정은 RPC activate_enrollment가 같은 네 조건을 UPDATE의 WHERE에 넣어 원자적으로 한다.
   */
  pendingGates: EnrollmentGate[];
  /**
   * 확정 수업으로 안내해도 되는가 — 일정과 결제가 모두 확인된 경우에만 true.
   * 일정만 잡힌 상태를 확정 안내로 내보내지 않기 위한 판정이다(검수 14).
   */
  canAnnounceSchedule: boolean;
}

function enrollmentPendingGates(row: EnrollmentRow): EnrollmentGate[] {
  const gates: EnrollmentGate[] = [];
  if (!row.relation_ok) gates.push("relation");
  if (!row.contract_ok) gates.push("contract");
  if (!row.payment_ok) gates.push("payment");
  if (!row.schedule_ok) gates.push("schedule");
  return gates;
}

function mapEnrollment(row: EnrollmentRow): Enrollment {
  return {
    id: row.id,
    studentId: row.student_id,
    consultationId: row.consultation_id,
    formId: row.form_id,
    status: row.status,
    relationOk: row.relation_ok,
    contractOk: row.contract_ok,
    paymentOk: row.payment_ok,
    scheduleOk: row.schedule_ok,
    activatedAt: row.activated_at,
    endedAt: row.ended_at,
    endReason: row.end_reason,
    createdAt: row.created_at,
    pendingGates: enrollmentPendingGates(row),
    canAnnounceSchedule: row.schedule_ok && row.payment_ok,
  };
}

interface ContractRow {
  id: string;
  enrollment_id: string;
  terms: Record<string, unknown>;
  agreed_at: string | null;
  agreed_by_name: string | null;
  agreed_by_phone: string | null;
  created_at: string;
}

/** 계약 한 건(R-03) — 동의(agreed_at)가 곧 contract_ok의 근거다. 조건이 바뀌면 새 계약본을 만든다. */
export interface Contract {
  id: string;
  enrollmentId: string;
  /** 수업 조건 스냅샷 — 계약 시점의 조건을 그대로 굳혀 둔다(이후 단가·일정 변경과 무관). */
  terms: Record<string, unknown>;
  agreedAt: string | null;
  agreedByName: string | null;
  agreedByPhone: string | null;
  createdAt: string;
}

function mapContract(row: ContractRow): Contract {
  return {
    id: row.id,
    enrollmentId: row.enrollment_id,
    terms: row.terms ?? {},
    agreedAt: row.agreed_at,
    agreedByName: row.agreed_by_name,
    agreedByPhone: row.agreed_by_phone,
    createdAt: row.created_at,
  };
}

export interface EnrollmentFilters {
  status?: EnrollmentStatus;
  studentId?: string;
  consultationId?: string;
}

export interface EnrollmentListItem extends Enrollment {
  studentName: string | null;
}

/** 등록 목록(운영자) — 생성 최신순. 남은 게이트가 '등록 준비 중' 배지 근거다(검수 13·14). */
export async function listEnrollments(
  tenantId: string,
  filters: EnrollmentFilters = {},
): Promise<EnrollmentListItem[]> {
  const db = createServiceClient();
  if (!db) return [];
  let query = db
    .from("enrollments")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.studentId) query = query.eq("student_id", filters.studentId);
  if (filters.consultationId) query = query.eq("consultation_id", filters.consultationId);
  const { data } = await query;
  const rows = (data ?? []) as EnrollmentRow[];
  if (rows.length === 0) return [];
  const names = await studentNames(
    db,
    tenantId,
    rows.map((r) => r.student_id),
  );
  return rows.map((row) => ({
    ...mapEnrollment(row),
    studentName: names.get(row.student_id) ?? null,
  }));
}

export interface EnrollmentDetail extends Enrollment {
  studentName: string | null;
  consultationName: string | null;
  /** 계약 이력 — 최신순. 조건이 바뀌면 이전 계약을 고치지 않고 새 계약본이 쌓인다(R-03). */
  contracts: Contract[];
  /** 최신 계약본 — 없으면 null. 동의 전이면 agreedAt이 null이다. */
  latestContract: Contract | null;
}

/**
 * 등록 상세 — 네 게이트 상태·남은 조건·계약 이력 포함.
 * 활성화 직후 포털 초대는 학생 상세 화면의 '포털 초대 보내기'로 이어 간다(R-06 최소 연결) —
 * students/actions.ts의 invitePortalRelation은 이 범위의 소유 파일이 아니라 재사용하지 않는다.
 */
export async function getEnrollment(
  tenantId: string,
  id: string,
): Promise<EnrollmentDetail | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("enrollments")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as EnrollmentRow;

  const { data: contractRows } = await db
    .from("contracts")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("enrollment_id", id)
    .order("created_at", { ascending: false });
  const contracts = ((contractRows ?? []) as ContractRow[]).map(mapContract);

  const names = await studentNames(db, tenantId, [row.student_id]);
  const briefs = row.consultation_id
    ? await consultationBriefs(db, tenantId, [row.consultation_id])
    : null;

  return {
    ...mapEnrollment(row),
    studentName: names.get(row.student_id) ?? null,
    consultationName: row.consultation_id
      ? (briefs?.get(row.consultation_id)?.name ?? null)
      : null,
    contracts,
    latestContract: contracts[0] ?? null,
  };
}

/* ---------- ④ 대기 자리 제안·정원 (waitlist_offers · recruit_status · C-06·O-04) ---------- */

interface WaitlistOfferRow {
  id: string;
  consultation_id: string;
  seat_no: number | null;
  offered_at: string | null;
  expires_at: string;
  status: WaitlistOfferStatus;
  responded_at: string | null;
}

export interface WaitlistOffer {
  id: string;
  consultationId: string;
  /** 자리 번호 — 열린 제안(offered)끼리는 같은 번호를 쓸 수 없다(부분 유니크, 검수 61). null이면 번호 미지정. */
  seatNo: number | null;
  offeredAt: string | null;
  /** 회신 기한 — 필수. 기한이 지나면 만료 확정 후 자리를 반환한다(검수 62). */
  expiresAt: string;
  status: WaitlistOfferStatus;
  respondedAt: string | null;
  /** 기한이 지났는데 아직 offered — 만료 확정(자리 반환) 대상. 조회가 자동으로 만료시키지는 않는다. */
  isOverdue: boolean;
}

function mapWaitlistOffer(row: WaitlistOfferRow): WaitlistOffer {
  return {
    id: row.id,
    consultationId: row.consultation_id,
    seatNo: row.seat_no,
    offeredAt: row.offered_at,
    expiresAt: row.expires_at,
    status: row.status,
    respondedAt: row.responded_at,
    isOverdue: row.status === "offered" && isPast(row.expires_at),
  };
}

export interface WaitlistOfferFilters {
  consultationId?: string;
  status?: WaitlistOfferStatus;
}

export interface WaitlistOfferListItem extends WaitlistOffer {
  consultationName: string | null;
  consultationPhone: string | null;
}

/** 대기 자리 제안 목록 — 제안 시각 최신순. 기한 경과분은 isOverdue로 구분한다(검수 62). */
export async function listWaitlistOffers(
  tenantId: string,
  filters: WaitlistOfferFilters = {},
): Promise<WaitlistOfferListItem[]> {
  const db = createServiceClient();
  if (!db) return [];
  let query = db
    .from("waitlist_offers")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("offered_at", { ascending: false });
  if (filters.consultationId) query = query.eq("consultation_id", filters.consultationId);
  if (filters.status) query = query.eq("status", filters.status);
  const { data } = await query;
  const rows = (data ?? []) as WaitlistOfferRow[];
  if (rows.length === 0) return [];
  const briefs = await consultationBriefs(
    db,
    tenantId,
    rows.map((r) => r.consultation_id),
  );
  return rows.map((row) => {
    const brief = briefs.get(row.consultation_id);
    return {
      ...mapWaitlistOffer(row),
      consultationName: brief?.name ?? null,
      consultationPhone: brief?.phone ?? null,
    };
  });
}

/** 정원 산정 결과(O-04) — 공개 모집 상태와 실제 수용 가능 인원을 함께 본다. */
export interface SeatAvailability {
  /** 공개 모집 상태(recruit_status). 미설정이면 null — 배너 문구용 상태이며 정원 자체는 아니다. */
  recruitState: RecruitState | null;
  /** 운영자가 정한 정원. null이면 정원 미설정 — 남은 자리를 0으로 위장하지 않는다. */
  seatCount: number | null;
  /** 활성 등록 수(enrollments.status='active') — 이미 자리를 쓰고 있는 사람. */
  activeEnrollments: number;
  /**
   * 열린 자리 제안 수(status='offered'). 기한이 지난 제안도 만료 확정 전까지는 자리를 점유한 것으로 센다
   * — 조회가 자리를 자동 반환하지 않는다(검수 62: 반환은 만료·거절 처리 이후).
   */
  openOffers: number;
  /** 그중 기한이 지난 제안 수 — 만료 확정 후 자리를 되찾을 수 있다는 운영 신호. */
  overdueOffers: number;
  /** 남은 자리 = 정원 − 활성 등록 − 열린 제안(음수는 0으로 표시하고 overbooked로 사실을 남긴다). 정원 미설정이면 null. */
  remainingSeats: number | null;
  /** 열린 제안이 점유한 자리 번호 — 같은 번호로 새 제안을 만들지 않기 위한 근거(검수 61). */
  offeredSeatNos: number[];
  /**
   * 정원보다 활성 등록 + 열린 제안이 많은 상태(정원을 줄인 뒤 흔히 생긴다).
   * 기존 등록·유효한 제안을 자동 취소하지 않고 새 제안만 멈추는 판단의 근거다(검수 63).
   */
  overbooked: boolean;
}

/**
 * 남은 자리 산정 — recruit_status.seat_count 대비 활성 등록 + 열린 자리 제안(O-04).
 * 실제 제안 여부는 운영자가 대기순서·현재 조건을 다시 확인하고 결정한다(검수 61 — 자동 확정 금지).
 */
export async function getSeatAvailability(tenantId: string): Promise<SeatAvailability> {
  const empty: SeatAvailability = {
    recruitState: null,
    seatCount: null,
    activeEnrollments: 0,
    openOffers: 0,
    overdueOffers: 0,
    remainingSeats: null,
    offeredSeatNos: [],
    overbooked: false,
  };
  const db = createServiceClient();
  if (!db) return empty;

  const recruit = await getRecruitStatus(tenantId);

  // 자리를 쓰고 있는 것 = ① 활성 등록 ② 준비 중(pending) 등록 ③ 아직 살아 있는 제안.
  // ②를 빼면 네 게이트를 세우는 동안 자리가 빈 것으로 보여 다른 사람에게 제안되고,
  // ③에서 accepted를 빼면 수락된 자리가 즉시 반환된다(검수 61·63이 통째로 무력화).
  const { data: enrollRows } = await db
    .from("enrollments")
    .select("status,consultation_id")
    .eq("tenant_id", tenantId)
    .in("status", ["pending", "active"]);
  const enrollments = (enrollRows ?? []) as {
    status: string;
    consultation_id: string | null;
  }[];

  // 제안은 offered·accepted가 자리를 묶는다 — 반환되는 것은 거절·만료뿐이다(검수 62).
  const { data: offerRows } = await db
    .from("waitlist_offers")
    .select("seat_no,expires_at,status,consultation_id")
    .eq("tenant_id", tenantId)
    .in("status", ["offered", "accepted"]);
  const offers = (offerRows ?? []) as {
    seat_no: number | null;
    expires_at: string;
    status: string;
    consultation_id: string | null;
  }[];

  const activeEnrollments = enrollments.filter((e) => e.status === "active").length;
  const pendingEnrollments = enrollments.filter((e) => e.status === "pending").length;

  // 기한이 지난 offered는 아직 expired로 정리되지 않았어도 자리를 묶지 않는다(만료는 시간이 정한다).
  const liveOffers = offers.filter(
    (o) => o.status === "accepted" || !isPast(o.expires_at),
  );
  // 이중 계상 방지: 이미 등록(pending·active)으로 이어진 상담의 제안은 등록 쪽에서 세었다.
  const enrolledConsultations = new Set(
    enrollments.map((e) => e.consultation_id).filter((v): v is string => Boolean(v)),
  );
  const seatHoldingOffers = liveOffers.filter(
    (o) => !o.consultation_id || !enrolledConsultations.has(o.consultation_id),
  );

  const openOffers = offers.filter((o) => o.status === "offered").length;
  const seatCount = recruit?.seatCount ?? null;
  const used = activeEnrollments + pendingEnrollments + seatHoldingOffers.length;

  return {
    recruitState: recruit?.status ?? null,
    seatCount,
    activeEnrollments,
    openOffers,
    overdueOffers: offers.filter((o) => o.status === "offered" && isPast(o.expires_at))
      .length,
    remainingSeats: seatCount === null ? null : Math.max(0, seatCount - used),
    // 점유 중인 자리 번호 — 살아 있는 제안(offered 미만료 + accepted)만.
    offeredSeatNos: liveOffers
      .map((o) => o.seat_no)
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b),
    overbooked: seatCount !== null && used > seatCount,
  };
}

/* ---------- ⑤ 상담 단위 유입 현황 (검수 6 — 다음 단계는 하나만 활성) ---------- */

/**
 * 한 상담에 지금 열려 있는 다음 단계 모음.
 * 새 상담 결과를 정할 때 '먼저 닫아야 할 것'을 한 번에 보여주고(검수 6·7),
 * 상담 종결 시 열린 폼·제안이 남지 않았는지 확인하는 데도 쓴다(C-07).
 */
export interface ConsultationIntakeState {
  /** 아직 닫히지 않은 폼(status='sent') — 기한 경과분은 isExpired로 구분된다. */
  openForms: IntakeForm[];
  /** 진행 중인 시범 회차(proposed·scheduled). */
  activeTrials: TrialSession[];
  /** 준비 중·활성 등록(pending·active). */
  openEnrollments: Enrollment[];
  /** 열린 자리 제안(offered). */
  openOffers: WaitlistOffer[];
  /** 활성인 다음 단계 갈래 수 — 2 이상이면 '하나만 활성'(검수 6)이 깨진 상태라는 표시다. */
  activeBranchCount: number;
}

export async function getConsultationIntakeState(
  tenantId: string,
  consultationId: string,
): Promise<ConsultationIntakeState> {
  const empty: ConsultationIntakeState = {
    openForms: [],
    activeTrials: [],
    openEnrollments: [],
    openOffers: [],
    activeBranchCount: 0,
  };
  const db = createServiceClient();
  if (!db) return empty;

  const { data: formRows } = await db
    .from("intake_forms")
    .select(FORM_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("consultation_id", consultationId)
    .eq("status", "sent")
    .order("sent_at", { ascending: false });

  const { data: trialRows } = await db
    .from("trial_sessions")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("consultation_id", consultationId)
    .in("status", ["proposed", "scheduled"])
    .order("created_at", { ascending: false });

  const { data: enrollmentRows } = await db
    .from("enrollments")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("consultation_id", consultationId)
    .in("status", ["pending", "active"])
    .order("created_at", { ascending: false });

  const { data: offerRows } = await db
    .from("waitlist_offers")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("consultation_id", consultationId)
    .eq("status", "offered")
    .order("offered_at", { ascending: false });

  const openForms = ((formRows ?? []) as unknown as IntakeFormRow[]).map(mapForm);
  const activeTrials = ((trialRows ?? []) as TrialSessionRow[]).map(mapTrialSession);
  const openEnrollments = ((enrollmentRows ?? []) as EnrollmentRow[]).map(mapEnrollment);
  const openOffers = ((offerRows ?? []) as WaitlistOfferRow[]).map(mapWaitlistOffer);

  // 갈래 수는 '종류'로 센다 — 같은 갈래 안의 여러 행(예: 재시범 회차 2건)은 하나의 다음 단계다.
  const activeBranchCount =
    (openForms.length > 0 ? 1 : 0) +
    (activeTrials.length > 0 ? 1 : 0) +
    (openEnrollments.length > 0 ? 1 : 0) +
    (openOffers.length > 0 ? 1 : 0);

  return { openForms, activeTrials, openEnrollments, openOffers, activeBranchCount };
}
