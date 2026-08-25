// 과제·제출·피드백·질의응답 데이터 계층 (H-01~H-07) — lib/data/crm.ts와 동일 스타일(snake_case DB ↔ camelCase 앱).
// 스키마 정본: supabase/migrations/00015_homework.sql
//   (homework_assignments · homework_submissions · homework_questions — 컬럼·상태값은 그쪽 주석 참조).
//
// 정본 규칙(docs/flow-canon/01_atlas_03_learning.md):
//   - H-01: draft는 학생·보호자 비노출. 게시 후 내용 변경은 새 과제본(updateDraft는 draft만 수정).
//   - 검수 27: 재제출은 append-only — 이전 제출을 덮어쓰지 않고 attempt_no를 올린 새 행이 최신 검토 대상
//     (원문 불변·직접 삭제 거부는 00015 트리거가 DB에서 강제).
//   - 검수 28: 미승인 피드백·답변은 알림·포털 비노출 — 포털 매핑이 approved만 노출한다(존재도 감춤).
//   - 검수 29: 질문은 원 수업·과제·리포트와 연결되고 답변 게시(answer_status=approved) 또는
//     해결 완료(status=resolved)로 닫힌다.
//   - 검수 126: 미검토 제출(review_status=pending·비철회)이 남은 과제는 전체 종료로 표시하지 않는다
//     — unreviewedCount가 그 판정 근거.
//   - H-04·H-06: 다른 학생의 파일·질문은 존재 자체 비노출 — 과제·질문이 학생 단위 행이라 포털 조회는
//     student_id 스코프로 거른다.
//   - H-07: 대상 취소(canceled)가 제출물·피드백을 자동 삭제하지 않는다 — 이 파일에는 delete 경로가 없다.
// 상태 전환(게시·배부, 피드백 승인, 종료·취소)은 성적 범주의 중요 전환이므로 서버 액션이
// runCritical(lib/data/activity.ts, category "grade")로 감싸 수행한다 — 이 파일은 조회·초안만 담당.

import { createServiceClient } from "@/lib/supabase/server";
import type {
  HomeworkAnswerStatus,
  HomeworkFeedbackStatus,
  HomeworkQuestionStatus,
  HomeworkReviewResult,
  HomeworkReviewStatus,
  HomeworkStatus,
} from "@/lib/types";

/* ---------- 도메인 타입 (camelCase) ---------- */

export interface HomeworkAssignment {
  id: string;
  studentId: string;
  lessonId: string | null; // 원 수업 근거(H-01: 수업기록에서 과제 초안)
  title: string;
  description: string;
  dueDate: string | null; // YYYY-MM-DD — 마감 경과는 제출 차단 사유가 아니다(H-02: late로 지연 연결)
  status: HomeworkStatus;
  assignedAt: string | null; // 게시·배부 시각
  closedAt: string | null; // 종료·취소 시각
  closeNote: string | null; // 종료·취소 사유(미검토 제출 잔존 시 별도 검토 경로 기록 등)
  archivedAt: string | null; // 보관 시각(H-07) — 파기가 아니며 이력 접근 유지
  createdAt: string;
  updatedAt: string;
}

export interface HomeworkSubmission {
  id: string;
  assignmentId: string;
  attemptNo: number; // 1부터 — 재제출은 새 행(append-only, 검수 27)
  content: string;
  fileUrl: string | null; // file_path(비공개 homework 버킷)의 만료 서명 URL — 발급 실패 시 null
  fileName: string | null;
  submittedAt: string; // 실제 제출 시각 — 지연 판정의 근거(H-02)
  late: boolean; // 마감 후 제출 — 차단 대신 지연 사실 연결(H-02)
  withdrawnAt: string | null; // 검토 전 철회 시각 — 행 삭제가 아니라 이력 보존(H-02)
  reviewStatus: HomeworkReviewStatus; // pending=미검토(검수 126 판정 대상)
  feedback: string | null;
  feedbackStatus: HomeworkFeedbackStatus | null; // null=피드백 없음, draft=미승인(비노출), approved=게시 가능
  feedbackApprovedAt: string | null;
  reviewResult: HomeworkReviewResult | null; // complete=완료 / resubmit=보완 필요(H-03 분기), null=판정 전
}

export interface HomeworkQuestion {
  id: string;
  studentId: string;
  assignmentId: string | null; // 원본 연결(검수 29) — 셋 중 하나 이상(접수 코드가 보장)
  lessonId: string | null;
  reportId: string | null;
  question: string;
  askedAt: string;
  answer: string | null;
  answerStatus: HomeworkAnswerStatus | null; // null=답변 없음, draft=미승인(비노출), approved=게시
  answeredAt: string | null;
  status: HomeworkQuestionStatus; // open / resolved — 닫힘은 답변 게시 또는 resolved(검수 29)
  createdAt: string;
}

/* ---------- Row ↔ 앱 매핑 ---------- */

interface AssignmentRow {
  id: string;
  student_id: string;
  lesson_id: string | null;
  title: string;
  description: string;
  due_date: string | null;
  status: HomeworkStatus;
  assigned_at: string | null;
  closed_at: string | null;
  close_note: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AssignmentJoinRow extends AssignmentRow {
  students: { name: string } | null;
}

function mapAssignment(row: AssignmentRow): HomeworkAssignment {
  return {
    id: row.id,
    studentId: row.student_id,
    lessonId: row.lesson_id,
    title: row.title,
    description: row.description,
    dueDate: row.due_date,
    status: row.status,
    assignedAt: row.assigned_at,
    closedAt: row.closed_at,
    closeNote: row.close_note,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface SubmissionRow {
  id: string;
  assignment_id: string;
  attempt_no: number;
  content: string;
  file_path: string | null;
  file_name: string | null;
  submitted_at: string;
  late: boolean;
  withdrawn_at: string | null;
  review_status: HomeworkReviewStatus;
  feedback: string | null;
  feedback_status: HomeworkFeedbackStatus | null;
  feedback_approved_at: string | null;
  review_result: HomeworkReviewResult | null;
}

function mapSubmission(row: SubmissionRow, fileUrl: string | null): HomeworkSubmission {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    attemptNo: row.attempt_no,
    content: row.content,
    fileUrl,
    fileName: row.file_name,
    submittedAt: row.submitted_at,
    late: row.late,
    withdrawnAt: row.withdrawn_at,
    reviewStatus: row.review_status,
    feedback: row.feedback,
    feedbackStatus: row.feedback_status,
    feedbackApprovedAt: row.feedback_approved_at,
    reviewResult: row.review_result,
  };
}

interface QuestionRow {
  id: string;
  student_id: string;
  assignment_id: string | null;
  lesson_id: string | null;
  report_id: string | null;
  question: string;
  asked_at: string;
  answer: string | null;
  answer_status: HomeworkAnswerStatus | null;
  answered_at: string | null;
  status: HomeworkQuestionStatus;
  created_at: string;
}

interface QuestionJoinRow extends QuestionRow {
  students: { name: string } | null;
}

function mapQuestion(row: QuestionRow): HomeworkQuestion {
  return {
    id: row.id,
    studentId: row.student_id,
    assignmentId: row.assignment_id,
    lessonId: row.lesson_id,
    reportId: row.report_id,
    question: row.question,
    askedAt: row.asked_at,
    answer: row.answer,
    answerStatus: row.answer_status,
    answeredAt: row.answered_at,
    status: row.status,
    createdAt: row.created_at,
  };
}

/* ---------- 제출 파일 서명 URL (비공개 homework 버킷 — materials 패턴 복제) ---------- */

const HOMEWORK_BUCKET = "homework"; // scripts/setup-supabase.sh가 비공개로 생성
const HOMEWORK_URL_TTL_S = 60 * 60; // 서명 URL 1시간 만료

/** file_path(비공개 버킷 오브젝트 경로)로 만료 서명 URL을 발급한다. 발급 실패 시 null(원 경로 비노출). */
async function submissionSignedUrl(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  filePath: string | null,
): Promise<string | null> {
  if (!filePath) return null;
  const { data } = await db.storage
    .from(HOMEWORK_BUCKET)
    .createSignedUrl(filePath, HOMEWORK_URL_TTL_S);
  return data?.signedUrl ?? null;
}

/** 제출 행 배열을 서명 URL 포함 앱 타입으로 변환(attempt_no 정렬은 호출부 쿼리에서 보장). */
async function mapSubmissionsWithUrl(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  rows: SubmissionRow[],
): Promise<HomeworkSubmission[]> {
  return Promise.all(
    rows.map(async (row) =>
      mapSubmission(row, await submissionSignedUrl(db, row.file_path)),
    ),
  );
}

/** 최신 검토 대상 제출 = 철회되지 않은 것 중 최대 attempt_no(검수 27). 없으면 null. */
function latestActiveSubmission(
  submissions: HomeworkSubmission[], // attempt_no 오름차순 전제
): HomeworkSubmission | null {
  for (let i = submissions.length - 1; i >= 0; i--) {
    if (!submissions[i].withdrawnAt) return submissions[i];
  }
  return null;
}

/* ---------- 운영자 조회 ---------- */

export interface HomeworkAssignmentFilters {
  status?: HomeworkStatus | "archived"; // archived는 상태가 아니라 보관 마커 필터(H-07)
  studentId?: string;
}

export interface HomeworkAssignmentListItem extends HomeworkAssignment {
  studentName: string | null;
  /**
   * 미검토 제출 수(목록 배지용) — review_status=pending이고 철회되지 않은 제출 건수.
   * 이 값이 0이 아닌 과제는 전체 종료로 표시하지 않는다(검수 126 — 종료 액션이 확인).
   */
  unreviewedCount: number;
}

/** 운영자 과제 목록 — 미검토 제출 수 포함. draft 포함 전체 상태를 보여준다(관리자 전용). */
export async function listAssignments(
  tenantId: string,
  filters: HomeworkAssignmentFilters = {},
): Promise<HomeworkAssignmentListItem[]> {
  const db = createServiceClient();
  if (!db) return [];
  let query = db
    .from("homework_assignments")
    .select("*, students(name)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  // 보관(H-07)은 상태가 아니라 archived_at 마커 — 기본 목록에서 접고, 'archived' 필터로만 펼친다.
  if (filters.status === "archived") {
    query = query.not("archived_at", "is", null);
  } else {
    query = query.is("archived_at", null);
    if (filters.status) query = query.eq("status", filters.status);
  }
  if (filters.studentId) query = query.eq("student_id", filters.studentId);
  const { data } = await query;
  const rows = (data ?? []) as AssignmentJoinRow[];
  if (rows.length === 0) return [];

  // 미검토 제출 배지 — 철회된 제출은 검토 대상이 아니다(H-02: 검토 전 철회).
  const { data: subs } = await db
    .from("homework_submissions")
    .select("assignment_id")
    .eq("tenant_id", tenantId)
    .eq("review_status", "pending")
    .is("withdrawn_at", null)
    .in(
      "assignment_id",
      rows.map((r) => r.id),
    );
  const pendingCount = new Map<string, number>();
  for (const s of (subs ?? []) as Pick<SubmissionRow, "assignment_id">[]) {
    pendingCount.set(s.assignment_id, (pendingCount.get(s.assignment_id) ?? 0) + 1);
  }
  return rows.map((row) => ({
    ...mapAssignment(row),
    studentName: row.students?.name ?? null,
    unreviewedCount: pendingCount.get(row.id) ?? 0,
  }));
}

export interface HomeworkAssignmentDetail extends HomeworkAssignment {
  studentName: string | null;
  /** 제출 이력 — attempt_no 오름차순 전체 보존분(append-only, 검수 27). 파일은 만료 서명 URL. */
  submissions: HomeworkSubmission[];
  /** 최신 검토 대상 = 철회되지 않은 것 중 최대 attempt_no. 없으면 null(미제출). */
  latestSubmission: HomeworkSubmission | null;
}

/** 운영자 과제 상세 — 제출 이력 attempt_no 순 포함(관리자 전용, draft도 조회 가능). */
export async function getAssignment(
  tenantId: string,
  id: string,
): Promise<HomeworkAssignmentDetail | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("homework_assignments")
    .select("*, students(name)")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as AssignmentJoinRow;
  const { data: subs } = await db
    .from("homework_submissions")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("assignment_id", id)
    .order("attempt_no", { ascending: true });
  const submissions = await mapSubmissionsWithUrl(db, (subs ?? []) as SubmissionRow[]);
  return {
    ...mapAssignment(row),
    studentName: row.students?.name ?? null,
    submissions,
    latestSubmission: latestActiveSubmission(submissions),
  };
}

/* ---------- 과제 초안 생성·수정 (H-01) ---------- */

export interface CreateAssignmentInput {
  studentId: string;
  lessonId?: string | null;
  title: string;
  description: string;
  dueDate?: string | null; // YYYY-MM-DD
}

/** 과제 초안 생성 — 항상 status=draft(H-01: 초안은 학생·보호자 비노출). 게시·배부는 검토 액션이 수행. */
export async function createAssignment(
  tenantId: string,
  input: CreateAssignmentInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const db = createServiceClient();
  if (!db) {
    return { ok: false, error: "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다." };
  }
  const { data, error } = await db
    .from("homework_assignments")
    .insert({
      tenant_id: tenantId,
      student_id: input.studentId,
      lesson_id: input.lessonId ?? null,
      title: input.title,
      description: input.description,
      due_date: input.dueDate ?? null,
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[homework] assignment insert failed", error);
    return { ok: false, error: "과제 저장 중 오류가 발생했습니다." };
  }
  return { ok: true, id: (data as { id: string }).id };
}

export interface UpdateDraftInput {
  studentId?: string;
  lessonId?: string | null;
  title?: string;
  description?: string;
  dueDate?: string | null;
}

/**
 * 과제 초안 수정 — status=draft인 행만 갱신된다.
 * 게시(assigned) 후 내용 변경은 기존 행을 고치지 않고 새 과제본 생성·재검토·재게시로 처리한다(H-01·H-07).
 */
export async function updateDraft(
  tenantId: string,
  id: string,
  patch: UpdateDraftInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = createServiceClient();
  if (!db) {
    return { ok: false, error: "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다." };
  }
  const update: Record<string, unknown> = {};
  if (patch.studentId !== undefined) update.student_id = patch.studentId;
  if (patch.lessonId !== undefined) update.lesson_id = patch.lessonId;
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.dueDate !== undefined) update.due_date = patch.dueDate;
  if (Object.keys(update).length === 0) return { ok: true }; // 변경 없음
  const { data, error } = await db
    .from("homework_assignments")
    .update(update)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .eq("status", "draft") // 초안만 — 게시 후 내용 변경은 새 과제본(H-01)
    .select("id");
  if (error) {
    console.error("[homework] draft update failed", error);
    return { ok: false, error: "과제 초안 수정 중 오류가 발생했습니다." };
  }
  if ((data ?? []).length === 0) {
    return {
      ok: false,
      error: "초안 상태의 과제만 수정할 수 있습니다. 게시된 과제는 새 과제본으로 만들어 주세요.",
    };
  }
  return { ok: true };
}

/* ---------- 학생 포털 조회 (토큰 인증 후 — H-04·H-06 존재 비노출) ---------- */

export interface PortalHomeworkSubmission {
  id: string;
  attemptNo: number;
  content: string;
  fileUrl: string | null; // 본인 제출 파일 — 만료 서명 URL
  fileName: string | null;
  submittedAt: string;
  late: boolean;
  withdrawnAt: string | null;
  /** 승인된 피드백만(feedback_status=approved). 미승인 피드백은 내용·존재 모두 비노출(검수 28). */
  feedback: string | null;
  feedbackApprovedAt: string | null;
  /** 판정(완료/보완 필요·재제출 요청)도 피드백 게시와 함께만 노출(H-03). */
  reviewResult: HomeworkReviewResult | null;
}

export interface PortalHomework {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
  status: Extract<HomeworkStatus, "assigned" | "closed">;
  assignedAt: string | null;
  /** 본인 제출 이력 — attempt_no 오름차순(철회분 포함, 이력 보존). */
  submissions: PortalHomeworkSubmission[];
  /** 최신 제출본 — 철회되지 않은 것 중 최대 attempt_no. 없으면 null(미제출). */
  latestSubmission: PortalHomeworkSubmission | null;
}

/** 미승인 피드백을 존재째 감춘 포털용 제출 매핑(검수 28). reviewStatus(검토 진행 여부)도 노출하지 않는다. */
function toPortalSubmission(s: HomeworkSubmission): PortalHomeworkSubmission {
  const approved = s.feedbackStatus === "approved";
  return {
    id: s.id,
    attemptNo: s.attemptNo,
    content: s.content,
    fileUrl: s.fileUrl,
    fileName: s.fileName,
    submittedAt: s.submittedAt,
    late: s.late,
    withdrawnAt: s.withdrawnAt,
    feedback: approved ? s.feedback : null,
    feedbackApprovedAt: approved ? s.feedbackApprovedAt : null,
    reviewResult: approved ? s.reviewResult : null,
  };
}

/**
 * 포털 과제 목록 — assigned·closed만(draft·canceled 비노출: H-01·H-07).
 * 과제가 학생 단위 행이므로 student_id 스코프가 곧 본인 것만 조회(H-04·H-06)이고,
 * 제출·피드백은 feedback_status=approved만 노출 필드로 매핑한다.
 */
export async function listPortalAssignments(
  tenantId: string,
  studentId: string,
): Promise<PortalHomework[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("homework_assignments")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId)
    .in("status", ["assigned", "closed"])
    .is("archived_at", null) // 보관분은 현재 목록에서 접는다(H-07 — 파기 아님, 운영자 이력은 유지)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as AssignmentRow[];
  if (rows.length === 0) return [];

  // 제출은 본인 과제(위에서 student_id로 스코프된 id)에 딸린 것만 조회한다.
  const { data: subs } = await db
    .from("homework_submissions")
    .select("*")
    .eq("tenant_id", tenantId)
    .in(
      "assignment_id",
      rows.map((r) => r.id),
    )
    .order("attempt_no", { ascending: true });
  const submissions = await mapSubmissionsWithUrl(db, (subs ?? []) as SubmissionRow[]);
  const byAssignment = new Map<string, HomeworkSubmission[]>();
  for (const s of submissions) {
    const list = byAssignment.get(s.assignmentId) ?? [];
    list.push(s);
    byAssignment.set(s.assignmentId, list);
  }
  return rows.map((row) => {
    const own = byAssignment.get(row.id) ?? [];
    const latest = latestActiveSubmission(own);
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      dueDate: row.due_date,
      status: row.status as Extract<HomeworkStatus, "assigned" | "closed">,
      assignedAt: row.assigned_at,
      submissions: own.map(toPortalSubmission),
      latestSubmission: latest ? toPortalSubmission(latest) : null,
    };
  });
}

/* ---------- 질의응답 (H-04) ---------- */

export interface HomeworkQuestionListItem extends HomeworkQuestion {
  studentName: string | null;
}

/**
 * 운영자 답변 대기 질문 — 아직 닫히지 않은 것(status=open이고 답변 미게시)만,
 * 오래된 질문 먼저(열린 상태는 오늘 업무로 수렴).
 */
export async function listOpenQuestions(
  tenantId: string,
): Promise<HomeworkQuestionListItem[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("homework_questions")
    .select("*, students(name)")
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .order("created_at", { ascending: true });
  return ((data ?? []) as QuestionJoinRow[])
    // 답변 게시(approved)로 이미 닫힌 질문은 답변 대기가 아니다(검수 29 — 닫힘은 게시 또는 resolved).
    .filter((row) => row.answer_status !== "approved")
    .map((row) => ({
      ...mapQuestion(row),
      studentName: row.students?.name ?? null,
    }));
}

export interface PortalHomeworkQuestion {
  id: string;
  assignmentId: string | null;
  lessonId: string | null;
  reportId: string | null;
  question: string;
  askedAt: string;
  /** 승인된 답변만(answer_status=approved). 미승인 답변 초안은 내용·존재 모두 비노출(검수 28·H-04). */
  answer: string | null;
  answeredAt: string | null;
  status: HomeworkQuestionStatus;
  /** 닫힘 = 답변 게시 또는 해결 완료(검수 29) — 포털 UI가 재구현하지 않도록 여기서 판정. */
  closed: boolean;
  createdAt: string;
}

/**
 * 포털 질문 목록 — 해당 학생 본인 질문만(다른 학생·무관계 보호자에게 존재 자체 비노출: H-04),
 * answer는 approved만 노출한다.
 */
export async function listPortalQuestions(
  tenantId: string,
  studentId: string,
): Promise<PortalHomeworkQuestion[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("homework_questions")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId)
    .order("created_at", { ascending: false });
  return ((data ?? []) as QuestionRow[]).map((row) => {
    const approved = row.answer_status === "approved";
    return {
      id: row.id,
      assignmentId: row.assignment_id,
      lessonId: row.lesson_id,
      reportId: row.report_id,
      question: row.question,
      askedAt: row.asked_at,
      answer: approved ? row.answer : null,
      answeredAt: approved ? row.answered_at : null,
      status: row.status,
      closed: row.status === "resolved" || approved,
      createdAt: row.created_at,
    };
  });
}
