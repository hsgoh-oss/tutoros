// CRM 조회 헬퍼 — 상담·학생·수업·일정·성적·결제·자료 공용. snake_case DB ↔ camelCase 앱(lib/types.ts).
// DB 미연결 시 전부 빈 배열/null 반환. lesson_materials는 타입 미정의라 이 파일에서 자체 정의한다.

import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { kstMonthStartUtc } from "@/lib/kst";
import type {
  ClassType,
  Consent,
  ConsentItem,
  Consultation,
  ConsultationStatus,
  Dday,
  Faq,
  GradeRecord,
  Lesson,
  NotificationLog,
  Payment,
  PaymentMethod,
  PaymentStatus,
  RecruitStatus,
  ReportType,
  Review,
  Attendance,
  DeductionState,
  ScheduleItem,
  Student,
} from "@/lib/types";

export { hasDb };

/* ---------- 포맷 헬퍼 ---------- */

// 날짜·시각 표기는 lib/kst.ts가 유일한 기준이다 — 서버가 UTC라 Date의 "로컬" API를 쓰면
// 화면이 9시간 빨라진다(같은 회차가 화면 19:01 / 내보낸 캘린더 04:01로 갈렸던 원인).
// 기존 호출부를 그대로 두려고 여기서 다시 내보낸다.
export { formatKDate, formatKDateTime } from "@/lib/kst";

export function formatWon(amount: number | null | undefined): string {
  return `${(amount ?? 0).toLocaleString("ko-KR")}원`;
}

/* ---------- 학생 select 공용 옵션 ---------- */

export interface StudentOption {
  id: string;
  name: string;
}

export async function listStudentOptions(
  tenantId: string,
): Promise<StudentOption[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("students")
    .select("id,name")
    .eq("tenant_id", tenantId)
    .order("name");
  return (data ?? []) as StudentOption[];
}

/* ---------- 학생 ---------- */

interface StudentRow {
  id: string;
  name: string;
  parent_phone: string;
  student_phone: string | null;
  school: string | null;
  grade: string | null;
  class_type: ClassType;
  subject_type: string | null;
  status: Student["status"];
  notion_page_id: string | null;
  portal_token: string | null;
  created_at: string;
}

function mapStudent(row: StudentRow): Student {
  return {
    id: row.id,
    name: row.name,
    parentPhone: row.parent_phone,
    studentPhone: row.student_phone,
    school: row.school,
    grade: row.grade,
    classType: row.class_type,
    subjectType: row.subject_type,
    status: row.status,
    notionPageId: row.notion_page_id,
    portalToken: row.portal_token,
    createdAt: row.created_at,
  };
}

export interface StudentFilters {
  status?: Student["status"];
  q?: string;
}

export async function listStudents(
  tenantId: string,
  filters: StudentFilters = {},
): Promise<Student[]> {
  const db = createServiceClient();
  if (!db) return [];
  let query = db
    .from("students")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.q) query = query.ilike("name", `%${filters.q}%`);
  const { data } = await query;
  return (data ?? []).map((r) => mapStudent(r as StudentRow));
}

export async function getStudent(
  tenantId: string,
  id: string,
): Promise<Student | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("students")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  return data ? mapStudent(data as StudentRow) : null;
}

/* ---------- 학생/학부모 리포트 포털 (Notion 대체) ---------- */

export interface PortalStudent {
  id: string;
  tenantId: string;
  name: string;
}

/** 포털 토큰으로 학생을 조회한다(코드 없는 비공개 링크 방식). */
export async function getStudentByPortalToken(
  token: string,
): Promise<PortalStudent | null> {
  const db = createServiceClient();
  if (!db) return null;
  // tenant-scope-ok: portal_token은 추측 불가한 단일 학생 식별자(플랫폼 경로 — 열람 링크에 테넌트 컨텍스트 없음).
  // 조회된 tenant_id를 이후 리포트 조회 스코프에 사용한다.
  const { data } = await db
    .from("students")
    .select("id, tenant_id, name, status")
    .eq("portal_token", token)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    id: string;
    tenant_id: string;
    name: string;
    status: Student["status"];
  };
  // E-04 등록 종료 — 「계약·등록 종료 → 포털 관계·접근 회수」(01_atlas_04 §17).
  // 종료(ended) 학생은 토큰이 유효해도 포털을 열지 않는다: 리포트 열람·과제 제출·질문 등
  // 토큰 기반 경로 전체가 이 함수를 지나므로, 여기 한 곳이 접근 회수 지점이다.
  // 재등록(E-05 — 새 등록 절차)으로 다시 활성되기 전까지 기존 링크는 무효로 취급한다.
  if (row.status === "ended") return null;
  return { id: row.id, tenantId: row.tenant_id, name: row.name };
}

export interface PortalReport {
  id: string;
  type: ReportType;
  content: string;
  createdAt: string;
}

/**
 * 포털에 노출할 리포트 — 승인/발송된 학부모·학생용만(내부용·초안·실패 제외).
 * G-03 철회·대체: status 화이트리스트(approved·sent)라 retracted(철회·이전 본 대체 포함)는
 * 자동 제외된다 — 철회 즉시 공유 경로(포털 토큰 열람)의 새 열람이 차단되는 지점이 여기다.
 * 정정된 최신본은 재승인(approved) 후에야 이 목록에 다시 나타난다.
 */
export async function listPortalReports(
  tenantId: string,
  studentId: string,
): Promise<PortalReport[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("ai_reports")
    .select("id, type, content, created_at")
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId)
    .in("status", ["approved", "sent"])
    .in("audience", ["parent", "student"])
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => {
    const row = r as {
      id: string;
      type: ReportType;
      content: string;
      created_at: string;
    };
    return {
      id: row.id,
      type: row.type,
      content: row.content,
      createdAt: row.created_at,
    };
  });
}

/* ---------- 수업 기록 ---------- */

interface LessonRow {
  id: string;
  student_id: string;
  lesson_date: string;
  session_number: number;
  content: string;
  homework: string | null;
  concentration: number | null;
  attitude: number | null;
  absent: boolean;
}

interface LessonJoinRow extends LessonRow {
  students: { name: string } | null;
}

function mapLesson(row: LessonRow): Lesson {
  return {
    id: row.id,
    studentId: row.student_id,
    lessonDate: row.lesson_date,
    sessionNumber: row.session_number,
    content: row.content,
    homework: row.homework,
    concentration: row.concentration,
    attitude: row.attitude,
    absent: row.absent,
  };
}

export interface LessonListItem extends Lesson {
  studentName: string;
}

export async function listLessons(
  tenantId: string,
  studentId?: string,
): Promise<LessonListItem[]> {
  const db = createServiceClient();
  if (!db) return [];
  let query = db
    .from("lessons")
    .select("*, students(name)")
    .eq("tenant_id", tenantId)
    .order("lesson_date", { ascending: false })
    .order("session_number", { ascending: false });
  if (studentId) query = query.eq("student_id", studentId);
  const { data } = await query;
  return (data ?? []).map((r) => {
    const row = r as LessonJoinRow;
    return { ...mapLesson(row), studentName: row.students?.name ?? "알 수 없음" };
  });
}

export async function getLesson(
  tenantId: string,
  id: string,
): Promise<Lesson | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("lessons")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  return data ? mapLesson(data as LessonRow) : null;
}

/** 다음 회차 번호 — 해당 학생의 기존 기록 수 + 1 (기획: 회차 자동 계산). */
export async function nextSessionNumber(
  tenantId: string,
  studentId: string,
): Promise<number> {
  const db = createServiceClient();
  if (!db) return 1;
  const { count } = await db
    .from("lessons")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId);
  return (count ?? 0) + 1;
}

/* ---------- 일정 ---------- */

interface ScheduleRow {
  id: string;
  student_id: string;
  scheduled_at: string;
  ends_at: string | null;
  class_type: ClassType;
  status: ScheduleItem["status"];
  reminder_sent: boolean;
  lesson_id: string | null;
  package_id: string | null;
  contract_id: string | null;
  attendance: Attendance | null;
  deduction_state: DeductionState;
  correction_count: number;
  origin_schedule_id: string | null;
  conflict_reason: string | null;
}

interface ScheduleJoinRow extends ScheduleRow {
  students: { name: string } | null;
}

// 00020 이전 코드가 select한 행에는 신규 컬럼이 없을 수 있다 — 매핑은 방어적으로 기본값을 준다.
export function mapSchedule(row: ScheduleRow): ScheduleItem {
  return {
    id: row.id,
    studentId: row.student_id,
    scheduledAt: row.scheduled_at,
    endsAt: row.ends_at ?? null,
    classType: row.class_type,
    status: row.status,
    reminderSent: row.reminder_sent,
    lessonId: row.lesson_id,
    packageId: row.package_id ?? null,
    contractId: row.contract_id ?? null,
    attendance: row.attendance ?? null,
    deductionState: row.deduction_state ?? "none",
    correctionCount: row.correction_count ?? 0,
    originScheduleId: row.origin_schedule_id ?? null,
    conflictReason: row.conflict_reason ?? null,
  };
}

export interface ScheduleListItem extends ScheduleItem {
  studentName: string;
}

export async function listSchedules(
  tenantId: string,
  range: { from: string; to: string },
): Promise<ScheduleListItem[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("schedules")
    .select("*, students(name)")
    .eq("tenant_id", tenantId)
    .gte("scheduled_at", range.from)
    .lt("scheduled_at", range.to)
    .order("scheduled_at");
  return (data ?? []).map((r) => {
    const row = r as ScheduleJoinRow;
    return { ...mapSchedule(row), studentName: row.students?.name ?? "알 수 없음" };
  });
}

export async function getSchedule(
  tenantId: string,
  id: string,
): Promise<ScheduleItem | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("schedules")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  return data ? mapSchedule(data as ScheduleRow) : null;
}

/* ---------- 성적 ---------- */

interface GradeRow {
  id: string;
  student_id: string;
  exam_name: string;
  raw_score: number | null;
  percentile: number | null;
  grade: string | null;
  exam_date: string | null;
}

interface GradeJoinRow extends GradeRow {
  students: { name: string } | null;
}

function mapGrade(row: GradeRow): GradeRecord {
  return {
    id: row.id,
    studentId: row.student_id,
    examName: row.exam_name,
    rawScore: row.raw_score,
    percentile: row.percentile,
    grade: row.grade,
    examDate: row.exam_date,
  };
}

export interface GradeListItem extends GradeRecord {
  studentName: string;
}

export async function listGrades(
  tenantId: string,
  studentId?: string,
): Promise<GradeListItem[]> {
  const db = createServiceClient();
  if (!db) return [];
  let query = db
    .from("grade_records")
    .select("*, students(name)")
    .eq("tenant_id", tenantId)
    // 철회(소프트 삭제)된 결과는 조회에서 제외한다 — A-06 물리 삭제 금지(00016 deleted_at).
    .is("deleted_at", null)
    .order("exam_date", { ascending: true });
  if (studentId) query = query.eq("student_id", studentId);
  const { data } = await query;
  return (data ?? []).map((r) => {
    const row = r as GradeJoinRow;
    return { ...mapGrade(row), studentName: row.students?.name ?? "알 수 없음" };
  });
}

export async function getGrade(
  tenantId: string,
  id: string,
): Promise<GradeRecord | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("grade_records")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    // 철회(소프트 삭제)된 결과는 단건 조회에서도 제외 — 철회본 정정·재사용 차단(A-06 재활성 금지).
    .is("deleted_at", null)
    .maybeSingle();
  return data ? mapGrade(data as GradeRow) : null;
}

/* ---------- 결제 ---------- */

interface PaymentRow {
  id: string;
  student_id: string;
  period_start: string;
  period_end: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  due_date: string | null;
  pay_url: string | null;
  toss_payment_key: string | null;
  paid_at: string | null;
}

interface PaymentJoinRow extends PaymentRow {
  students: { name: string } | null;
}

function mapPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    studentId: row.student_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    amount: row.amount,
    method: row.method,
    status: row.status,
    dueDate: row.due_date,
    payUrl: row.pay_url,
    tossPaymentKey: row.toss_payment_key,
    paidAt: row.paid_at,
  };
}

export interface PaymentListItem extends Payment {
  studentName: string;
}

export interface PaymentFilters {
  status?: PaymentStatus;
}

export async function listPayments(
  tenantId: string,
  filters: PaymentFilters = {},
): Promise<PaymentListItem[]> {
  const db = createServiceClient();
  if (!db) return [];
  let query = db
    .from("payments")
    .select("*, students(name)")
    .eq("tenant_id", tenantId)
    .order("due_date", { ascending: true });
  if (filters.status) query = query.eq("status", filters.status);
  const { data } = await query;
  return (data ?? []).map((r) => {
    const row = r as PaymentJoinRow;
    return { ...mapPayment(row), studentName: row.students?.name ?? "알 수 없음" };
  });
}

export async function getPayment(
  tenantId: string,
  id: string,
): Promise<Payment | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("payments")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  return data ? mapPayment(data as PaymentRow) : null;
}

export interface PaymentSummary {
  paidThisMonth: number;
  overdueTotal: number;
  pendingTotal: number;
}

export async function getPaymentSummary(
  tenantId: string,
): Promise<PaymentSummary> {
  const db = createServiceClient();
  if (!db) return { paidThisMonth: 0, overdueTotal: 0, pendingTotal: 0 };

  // 당월 경계는 KST 기준으로 잡는다. 서버는 UTC라 now.getMonth()·bare date로 비교하면
  // KST 월초 0~9시에 완납된 건이 전월로 새거나 누락된다.
  const monthStart = kstMonthStartUtc();

  const [paidRes, overdueRes, pendingRes] = await Promise.all([
    db
      .from("payments")
      .select("amount")
      .eq("tenant_id", tenantId)
      .eq("status", "paid")
      .gte("paid_at", monthStart),
    db.from("payments").select("amount").eq("tenant_id", tenantId).eq("status", "overdue"),
    db.from("payments").select("amount").eq("tenant_id", tenantId).eq("status", "pending"),
  ]);

  const sum = (rows: { amount: number }[] | null) =>
    (rows ?? []).reduce((acc, r) => acc + r.amount, 0);

  return {
    paidThisMonth: sum(paidRes.data as { amount: number }[] | null),
    overdueTotal: sum(overdueRes.data as { amount: number }[] | null),
    pendingTotal: sum(pendingRes.data as { amount: number }[] | null),
  };
}

/* ---------- 자료 (lib/types.ts 미정의 — 이 파일에서 자체 타입 관리) ---------- */

export interface LessonMaterial {
  id: string;
  studentId: string | null;
  lessonId: string | null;
  name: string;
  fileUrl: string;
  isShared: boolean;
  createdAt: string;
}

interface MaterialRow {
  id: string;
  student_id: string | null;
  lesson_id: string | null;
  name: string;
  file_url: string;
  is_shared: boolean;
  created_at: string;
}

interface MaterialJoinRow extends MaterialRow {
  students: { name: string } | null;
}

function mapMaterial(row: MaterialRow): LessonMaterial {
  return {
    id: row.id,
    studentId: row.student_id,
    lessonId: row.lesson_id,
    name: row.name,
    fileUrl: row.file_url,
    isShared: row.is_shared,
    createdAt: row.created_at,
  };
}

export interface MaterialListItem extends LessonMaterial {
  studentName: string | null;
}

const MATERIALS_BUCKET = "materials";
const MATERIAL_URL_TTL_S = 60 * 60; // 서명 URL 1시간 만료

/** 저장된 file_url(비공개 버킷 오브젝트 경로)로 만료 서명 URL을 발급한다. 레거시 public URL은 그대로 반환. */
async function materialSignedUrl(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  fileUrl: string,
): Promise<string> {
  if (/^https?:\/\//.test(fileUrl)) return fileUrl; // 레거시 public URL 호환
  const { data } = await db.storage
    .from(MATERIALS_BUCKET)
    .createSignedUrl(fileUrl, MATERIAL_URL_TTL_S);
  return data?.signedUrl ?? "";
}

export async function listMaterials(
  tenantId: string,
  studentId?: string,
): Promise<MaterialListItem[]> {
  const db = createServiceClient();
  if (!db) return [];
  let query = db
    .from("lesson_materials")
    .select("*, students(name)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (studentId) query = query.eq("student_id", studentId);
  const { data } = await query;
  const rows = (data ?? []) as MaterialJoinRow[];
  // materials는 비공개 버킷 — 조회 시점에 만료 서명 URL을 발급한다(URL만 알면 열리던 PII 노출 차단).
  return Promise.all(
    rows.map(async (row) => ({
      ...mapMaterial(row),
      fileUrl: await materialSignedUrl(db, row.file_url),
      studentName: row.students?.name ?? null,
    })),
  );
}

/* ---------- 상담 ---------- */

interface ConsultationRow {
  id: string;
  name: string;
  phone: string;
  subject: string | null;
  class_type: ClassType | null;
  message: string | null;
  status: ConsultationStatus;
  is_student_self: boolean;
  birth_year: number | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  checklist_items: string[];
  prefill: { mode?: string; hours?: number; freq?: number } | null;
  memo: string | null;
  student_id: string | null;
  created_at: string;
}

/** lib/types.ts의 Consultation은 학생 전환 연결 필드(studentId)를 포함하지 않아 관리자 전용으로 확장. */
export interface ConsultationDetail extends Consultation {
  studentId: string | null;
}

function mapConsultation(row: ConsultationRow): ConsultationDetail {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    subject: row.subject,
    classType: row.class_type,
    message: row.message,
    status: row.status,
    isStudentSelf: row.is_student_self,
    birthYear: row.birth_year,
    guardianName: row.guardian_name,
    guardianPhone: row.guardian_phone,
    checklistItems: row.checklist_items ?? [],
    prefill: row.prefill,
    memo: row.memo,
    studentId: row.student_id,
    createdAt: row.created_at,
  };
}

export interface ConsultationFilters {
  status?: ConsultationStatus;
}

export async function listConsultations(
  tenantId: string,
  filters: ConsultationFilters = {},
): Promise<ConsultationDetail[]> {
  const db = createServiceClient();
  if (!db) return [];
  let query = db
    .from("consultations")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);
  const { data } = await query;
  return (data ?? []).map((r) => mapConsultation(r as ConsultationRow));
}

export async function getConsultation(
  tenantId: string,
  id: string,
): Promise<ConsultationDetail | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("consultations")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  return data ? mapConsultation(data as ConsultationRow) : null;
}

/* ---------- 동의 내역 ---------- */

interface ConsentRow {
  id: string;
  subject_type: Consent["subjectType"];
  subject_id: string;
  item: ConsentItem;
  policy_version: string;
  consented_at: string;
  via: string;
}

function mapConsent(row: ConsentRow): Consent {
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    item: row.item,
    policyVersion: row.policy_version,
    consentedAt: row.consented_at,
    via: row.via,
  };
}

export async function listConsents(
  tenantId: string,
  subjectType: Consent["subjectType"],
  subjectId: string,
): Promise<Consent[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("consents")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("subject_type", subjectType)
    .eq("subject_id", subjectId)
    .order("consented_at", { ascending: false });
  return (data ?? []).map((r) => mapConsent(r as ConsentRow));
}

/* ---------- 학생 상세 요약 (수업·성적·결제 최근 5건) ---------- */

export interface StudentSummary {
  lessons: Lesson[];
  grades: GradeRecord[];
  payments: Payment[];
}

export async function getStudentSummary(
  tenantId: string,
  studentId: string,
): Promise<StudentSummary> {
  const db = createServiceClient();
  if (!db) return { lessons: [], grades: [], payments: [] };

  const [lessonsRes, gradesRes, paymentsRes] = await Promise.all([
    db
      .from("lessons")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("student_id", studentId)
      .order("lesson_date", { ascending: false })
      .limit(5),
    db
      .from("grade_records")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("student_id", studentId)
      .is("deleted_at", null) // 철회(소프트 삭제)된 성적 제외 — A-06(00016)
      .order("exam_date", { ascending: false })
      .limit(5),
    db
      .from("payments")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("student_id", studentId)
      .order("due_date", { ascending: false })
      .limit(5),
  ]);

  return {
    lessons: (lessonsRes.data ?? []).map((r) => mapLesson(r as LessonRow)),
    grades: (gradesRes.data ?? []).map((r) => mapGrade(r as GradeRow)),
    payments: (paymentsRes.data ?? []).map((r) => mapPayment(r as PaymentRow)),
  };
}

/* ---------- 후기 (lib/data/content.ts의 공개 로더와 컬럼 매핑 동일 — 관리자 CRUD 조회 전용) ---------- */

interface ReviewMeta {
  region?: string;
  grade?: string;
  track?: string;
  source?: string;
  reviewed_at?: string;
}

interface ReviewRow {
  id: string;
  reviewer_type: Review["reviewerType"];
  content: string;
  rating: number;
  before_grade: string | null;
  after_grade: string | null;
  meta: ReviewMeta | null;
  screenshots: string[] | null;
  ai_tags: string[] | null;
  is_pinned: boolean;
}

function mapReview(row: ReviewRow): Review {
  return {
    id: row.id,
    reviewerType: row.reviewer_type,
    content: row.content,
    rating: row.rating,
    beforeGrade: row.before_grade,
    afterGrade: row.after_grade,
    region: row.meta?.region ?? null,
    grade: row.meta?.grade ?? null,
    track: row.meta?.track ?? null,
    source: row.meta?.source ?? null,
    reviewedAt: row.meta?.reviewed_at ?? null,
    screenshots: row.screenshots ?? [],
    aiTags: row.ai_tags ?? [],
    isPinned: row.is_pinned,
  };
}

export async function listReviews(tenantId: string): Promise<Review[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("reviews")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("is_pinned", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => mapReview(r as ReviewRow));
}

export async function getReview(
  tenantId: string,
  id: string,
): Promise<Review | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("reviews")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  return data ? mapReview(data as ReviewRow) : null;
}

/* ---------- 관리자 대시보드 보조 ---------- */

/** 관리자용 D-day 전체(숨김 포함) — 공개 getSiteContent와 달리 is_visible 필터 없음. */
export async function listTenantDdays(tenantId: string): Promise<Dday[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("ddays")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("sort_order");
  return (data ?? []).map((r) => {
    const row = r as {
      id: string;
      name: string;
      exam_date: string;
      is_visible: boolean;
      sort_order: number;
    };
    return {
      id: row.id,
      name: row.name,
      examDate: row.exam_date,
      isVisible: row.is_visible,
      sortOrder: row.sort_order,
    };
  });
}

export async function getRecruitStatus(
  tenantId: string,
): Promise<RecruitStatus | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("recruit_status")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    status: RecruitStatus["status"];
    message: string;
    seat_count: number | null;
    is_banner_visible: boolean;
  };
  return {
    status: row.status,
    message: row.message,
    seatCount: row.seat_count,
    isBannerVisible: row.is_banner_visible,
  };
}

export interface DueSoonPayment {
  id: string;
  studentName: string;
  amount: number;
  dueDate: string | null;
}

/** 청구 필요 목록 — pending이고 due_date가 오늘~오늘+days 사이(D-3 안내 대상). */
export async function listPaymentsDueSoon(
  tenantId: string,
  days = 3,
): Promise<DueSoonPayment[]> {
  const db = createServiceClient();
  if (!db) return [];
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + days * 24 * 3600 * 1000);
  const { data } = await db
    .from("payments")
    .select("id, amount, due_date, students(name)")
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .gte("due_date", fmt(now))
    .lte("due_date", fmt(to))
    .order("due_date", { ascending: true });
  return (data ?? []).map((r) => {
    const row = r as unknown as {
      id: string;
      amount: number;
      due_date: string | null;
      students: { name: string } | null;
    };
    return {
      id: row.id,
      studentName: row.students?.name ?? "알 수 없음",
      amount: row.amount,
      dueDate: row.due_date,
    };
  });
}

export async function listStudentNotifications(
  tenantId: string,
  studentId: string,
  limit = 10,
): Promise<NotificationLog[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("notifications")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => {
    const row = r as {
      id: string;
      student_id: string | null;
      type: string;
      channel: "alimtalk" | "sms";
      phone: string;
      message: string;
      status: "queued" | "sent" | "failed";
      is_ad: boolean;
      retry_count: number;
      sent_at: string | null;
    };
    return {
      id: row.id,
      studentId: row.student_id,
      type: row.type,
      channel: row.channel,
      phone: row.phone,
      message: row.message,
      status: row.status,
      isAd: row.is_ad,
      retryCount: row.retry_count,
      sentAt: row.sent_at,
    };
  });
}

/* ---------- FAQ ---------- */

interface FaqRow {
  id: string;
  category: string;
  question: string;
  answer: string;
  sort_order: number;
}

function mapFaq(row: FaqRow): Faq {
  return {
    id: row.id,
    category: row.category,
    question: row.question,
    answer: row.answer,
    sortOrder: row.sort_order,
  };
}

export async function listFaqs(tenantId: string): Promise<Faq[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("faqs")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("sort_order");
  return (data ?? []).map((r) => mapFaq(r as FaqRow));
}

export async function getFaq(
  tenantId: string,
  id: string,
): Promise<Faq | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("faqs")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  return data ? mapFaq(data as FaqRow) : null;
}
