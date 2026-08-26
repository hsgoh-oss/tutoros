// TUTOR OS 도메인 타입 — DB 스키마(supabase/migrations)와 1:1 정합.
// 컬럼은 snake_case, 앱 레이어는 camelCase(매핑은 lib/data/*에서 수행).

export type PlanTier = "starter" | "standard" | "pro" | "pro_plus";

export interface Tenant {
  id: string;
  brandName: string;
  email: string;
  plan: PlanTier;
  planStatus: "trial" | "active" | "suspended";
  customDomain: string | null;
  subdomain: string | null;
  domainVerified: boolean;
  tutorReportNo: string | null;
  // 결제선생 하위사업장 매핑(00019) — 파트너(apiKey) → 사용자(member) → 하위사업장(merchant) 3층.
  // 단일 테넌트에서는 환경변수만으로 충분하므로 두 값은 없어도 된다(선택 필드) — 없거나 null이면
  // lib/payssam/client.ts가 PAYSSAM_MEMBER_ID·PAYSSAM_MERCHANT_ID로 폴백한다.
  // SaaS 확장(학원 2곳 이상)에서는 테넌트 값이 우선해야 청구서가 각자 사업장으로 나간다.
  payssamMemberId?: string | null;
  payssamMerchantId?: string | null;
}

/* ---------- 공개 사이트 콘텐츠 ---------- */

export interface SiteSettings {
  brandName: string;
  tagline: string;
  bizName: string;
  ceoName: string;
  bizNo: string;
  email: string;
  address: string;
  phone: string | null;
  kakaoUrl: string;
  instagramUrl: string;
  kimProfileUrl: string;
  kimReviewUrl: string;
  tutorReportNo: string | null; // 개인과외교습자 신고번호 — 입력 시에만 푸터 노출
  commerceNo: string | null; // 통신판매업신고번호 — 입력 시에만 푸터 노출(공정위 조회 링크 포함)
  gaId: string | null;
  bankAccount: string | null; // 계좌이체 안내 문구 (예: "국민은행 123-45-6789 고현서") — 청구 안내에 노출
  seoDescription: string;
}

export interface Rates {
  inperson: number; // 시간당 대면 단가(원)
  video: number; // 시간당 화상 단가(원)
  trial: number; // 시범수업 1회(1시간) 가격(원)
}

export interface Dday {
  id: string;
  name: string;
  examDate: string; // YYYY-MM-DD
  isVisible: boolean;
  sortOrder: number;
}

export type RecruitState = "open" | "closing" | "waitlist" | "closed";

export interface RecruitStatus {
  status: RecruitState;
  message: string;
  seatCount: number | null;
  isBannerVisible: boolean;
}

/**
 * 후기·성적사례 상태(00016 — S-01·S-03 정본 해소).
 * draft(등록·제출 — 비공개) → approved(검토 승인 — 아직 비공개) → published(공개용 최소 본 게시)
 * → retracted(철회 — 즉시 공개 중단, 행·이력은 보존).
 * 공개 콘텐츠는 published만 노출하며, 철회 후 재공개는 이전 본을 되돌리지 않고
 * 새 제출본을 다시 검토·승인·게시한다(재활성 금지 — 정정·철회는 adjustments 이력으로 남긴다).
 */
export type ReviewStatus = "draft" | "approved" | "published" | "retracted";

export interface Review {
  id: string;
  reviewerType: "student" | "parent";
  content: string;
  rating: number; // 1~5
  beforeGrade: string | null;
  afterGrade: string | null;
  region: string | null;
  grade: string | null; // 고1·고2·고3·재수
  track: string | null; // 문과·이과
  source: string | null; // 김과외 등
  reviewedAt: string | null; // YYYY-MM-DD
  screenshots: string[];
  aiTags: string[];
  isPinned: boolean;
}

export interface Faq {
  id: string;
  category: string;
  question: string;
  answer: string;
  sortOrder: number;
}

export interface CaseItem {
  name: string; // 예: 여OO 학생
  beforeLabel: string;
  beforeGrade: string;
  afterLabel: string;
  afterGrade: string;
}

export interface SubjectCard {
  key: string;
  title: string;
  target: string;
  summary: string;
  points: string[];
}

export interface ChecklistItem {
  id: string;
  text: string;
}

/** 공개 사이트 렌더에 필요한 콘텐츠 묶음 (DB 병합 결과) */
export interface SiteContent {
  settings: SiteSettings;
  rates: Rates;
  badges: string[];
  ddays: Dday[];
  recruit: RecruitStatus;
  reviews: Review[];
  cases: CaseItem[];
  faqs: Faq[];
  subjects: SubjectCard[];
  checklist: ChecklistItem[];
}

/* ---------- CRM ---------- */

export type ClassType = "inperson" | "video";

export interface Student {
  id: string;
  name: string;
  parentPhone: string;
  studentPhone: string | null; // 선택·동의 기반
  school: string | null;
  grade: string | null;
  classType: ClassType;
  subjectType: string | null;
  status: "trial" | "active" | "paused" | "ended";
  notionPageId: string | null;
  portalToken: string | null; // 네이티브 학생/학부모 리포트 포털 링크 토큰
  createdAt: string;
}

export interface Lesson {
  id: string;
  studentId: string;
  lessonDate: string;
  sessionNumber: number; // 회차 자동
  content: string;
  homework: string | null;
  concentration: number | null; // 1~5
  attitude: number | null; // 1~5
  absent: boolean;
}

// 출결(L-04). 회차당 하나만 확정되고 바꾸려면 정정 흐름(attendance_corrections)을 거친다.
// 정본은 schedules.attendance이고 lessons.absent는 기존 화면 호환 미러다.
export type Attendance =
  | "present"
  | "late"
  | "early_leave"
  | "excused_absence"
  | "absent"
  | "noshow";

// 회차 차감 판정(L-05). none=미판정 / deducted=잔액 차감됨 / waived=무차감 확정.
export type DeductionState = "none" | "deducted" | "waived";

export interface ScheduleItem {
  id: string;
  studentId: string;
  scheduledAt: string; // ISO
  endsAt: string | null;
  classType: ClassType;
  status: "planned" | "done" | "canceled" | "makeup" | "conflict";
  reminderSent: boolean;
  lessonId: string | null; // 완료 시 자동 생성·연결된 수업 기록
  packageId: string | null;
  contractId: string | null; // null = 계약 귀속 미확정 — 잔액·환불 계산에 쓰지 않는다(L-10)
  attendance: Attendance | null;
  deductionState: DeductionState;
  correctionCount: number;
  originScheduleId: string | null; // 보강의 원 회차
  conflictReason: string | null;
}

// 수업 묶음(L-01). 계약 하나에 살아 있는 묶음은 하나다.
export type LessonPackageStatus = "draft" | "active" | "ended";

export interface LessonPackage {
  id: string;
  enrollmentId: string;
  contractId: string;
  studentId: string;
  studentName: string | null;
  title: string;
  totalSessions: number;
  unitPrice: number;
  pattern: SessionPattern;
  startsOn: string; // YYYY-MM-DD
  status: LessonPackageStatus;
  activatedAt: string | null;
  endedAt: string | null;
  balance: PackageBalance | null;
}

/** 반복 조건 스냅샷. weekdays는 0=일 ~ 6=토(KST 기준). */
export interface SessionPattern {
  weekdays: number[];
  time: string; // "HH:MM" KST
  durationMin: number;
}

export interface PackageBalance {
  totalSessions: number;
  consumed: number;
  remaining: number;
  confirmedSessions: number;
  conflictedSessions: number;
  unresolvedSessions: number;
}

export type LedgerKind = "deduct" | "restore" | "grant" | "adjust";

export interface LedgerEntry {
  id: string;
  scheduleId: string | null;
  kind: LedgerKind;
  delta: number;
  correctionNo: number;
  reason: string;
  actorEmail: string | null;
  reversesId: string | null;
  createdAt: string;
}

export type ContactResult = "no_answer" | "reached" | "entered";

export interface AttendanceContact {
  id: string;
  scheduleId: string;
  minuteMark: 10 | 20 | 30;
  channel: "call" | "sms" | "kakao" | "other";
  result: ContactResult;
  contactedAt: string;
}

export interface AttendanceCorrection {
  id: string;
  scheduleId: string;
  studentName: string | null;
  scheduledAt: string | null;
  requesterRole: "operator" | "teacher" | "parent" | "student";
  requestedBy: string;
  fromAttendance: Attendance | null;
  toAttendance: Attendance;
  toDeduct: boolean;
  reason: string;
  status: "pending" | "approved" | "rejected";
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  createdAt: string;
}

export interface BookingRestriction {
  id: string;
  studentId: string;
  studentName: string | null;
  status: "active" | "lifted";
  reason: string;
  reviewOn: string;
  decidedBy: string;
  decidedAt: string;
  liftedAt: string | null;
  liftReason: string | null;
}

export interface GradeRecord {
  id: string;
  studentId: string;
  examName: string;
  rawScore: number | null;
  percentile: number | null;
  grade: string | null; // 등급
  examDate: string | null;
}

export type PaymentMethod = "payssaem" | "bank"; // 토스 제거 — 무통장입금(bank)+결제선생(payssaem)
export type PaymentStatus = "draft" | "pending" | "paid" | "overdue" | "refunded"; // refunded: 00014 결제선생 전액환불

export interface Payment {
  id: string;
  studentId: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  dueDate: string | null;
  payUrl: string | null; // 토스 링크 전용
  tossPaymentKey: string | null;
  paidAt: string | null;
}

export type ConsultationStatus =
  | "new"
  | "contacted"
  | "trial"
  | "registered"
  | "hold";

export interface Consultation {
  id: string;
  name: string;
  phone: string;
  subject: string | null;
  classType: ClassType | null;
  message: string | null;
  status: ConsultationStatus;
  isStudentSelf: boolean; // "학생 본인 신청" 토글
  birthYear: number | null;
  guardianName: string | null;
  guardianPhone: string | null;
  checklistItems: string[]; // 메인 자기진단에서 선택한 항목
  prefill: { mode?: string; hours?: number; freq?: number } | null;
  memo: string | null;
  createdAt: string;
}

export type ConsentItem =
  | "privacy"
  | "overseas_ai"
  | "marketing"
  | "review"
  | "student_phone";

export interface Consent {
  id: string;
  subjectType: "consultation" | "student" | "guardian";
  subjectId: string;
  item: ConsentItem;
  policyVersion: string;
  consentedAt: string;
  via: string; // form | admin
}

/* ---------- AI 리포트 · 알림 ---------- */

export type ReportType =
  | "lesson"
  | "weekly"
  | "monthly"
  | "exam"
  | "consult_brief";
export type ReportAudience = "parent" | "student" | "internal";

/** 전달 상태 — 업무 상태(status)와 분리(N-02). 발송 실패는 여기에만 기록되고 게시 상태는 유지된다. */
export type ReportDeliveryStatus = "none" | "queued" | "sent" | "failed";

export interface AiReport {
  id: string;
  studentId: string | null;
  type: ReportType;
  audience: ReportAudience;
  depth: "basic" | "deep";
  content: string;
  modelUsed: string | null;
  tokenUsage: number | null;
  /**
   * 업무 상태 — 초안→승인→발송완료, 철회(G-03: 새 열람 차단·철회 이력 보존).
   * 'failed'는 업무 상태가 아니다(전달 실패는 deliveryStatus 담당).
   * retracted는 삭제가 아니다 — 행은 보존하고 포털·알림 노출만 차단하며,
   * 재공개는 이전 본을 되돌리지 않고 정정된 새 리포트를 검토·승인·게시한다.
   */
  status: "draft" | "approved" | "sent" | "retracted";
  deliveryStatus: ReportDeliveryStatus;
  sentAt: string | null;
  createdAt: string;
}

export interface NotificationLog {
  id: string;
  studentId: string | null;
  type: string; // 알림 12종 키
  channel: "alimtalk" | "sms";
  phone: string;
  message: string;
  /** sending = 발송 직전 클레임(이중 발송 방지). 장기 체류는 결과 불명 — 크론이 업무 큐로 수렴시킨다. */
  status: "queued" | "sending" | "sent" | "failed";
  isAd: boolean;
  retryCount: number;
  sentAt: string | null;
}

/* ---------- 과제·질의응답 (H-01~H-07 · 00015) ---------- */

/** 과제 상태 — draft(초안: 학생·보호자 비노출, H-01) → assigned(게시·배부) → closed(전체 종료) / canceled(취소 — 제출물·피드백은 보존, H-07). */
export type HomeworkStatus = "draft" | "assigned" | "closed" | "canceled";

/** 제출 검토 상태 — pending(미검토)이 남은 과제는 전체 종료로 표시하지 않는다(검수 126). */
export type HomeworkReviewStatus = "pending" | "reviewed";

/** 검토 판정 — complete(과제 완료) / resubmit(보완 필요 → 재제출 요청, H-03 분기). 컬럼은 null 허용(판정 전). */
export type HomeworkReviewResult = "complete" | "resubmit";

/** 제출 피드백 상태 — approved만 알림·포털에 노출(검수 28). draft(미승인)는 존재 자체 비노출. 컬럼은 null 허용(피드백 없음). */
export type HomeworkFeedbackStatus = "draft" | "approved";

/** 질문 답변 상태 — approved만 포털 노출(H-04: 승인 전 비노출). 컬럼은 null 허용(답변 없음). */
export type HomeworkAnswerStatus = "draft" | "approved";

/** 질문 상태 — 답변 게시(answer_status=approved) 또는 해결 완료(resolved)로 닫힌다(검수 29). 열린 질문은 오늘 업무로 수렴. */
export type HomeworkQuestionStatus = "open" | "resolved";

/* ---------- 유입 퍼널 — 신청폼·시범·정규등록·대기 (T-01~T-04 · R-01~R-06 · O-04 · 00018) ---------- */

/** 신청폼 종류 — trial(시범수업 신청 T-01) / regular(정규수업 신청 R-01). 같은 상담·같은 종류의 활성 폼은 1개다(검수 7). */
export type IntakeFormKind = "trial" | "regular";

/**
 * 신청폼 상태 — sent(발급·발송 — 링크 유효) → submitted(제출 완료 — 최초 제출로 수렴)
 * / closed(새 폼 발급·상담 결과 변경·철회로 닫힘 — 검수 6·7) / expired(기한 경과).
 * 만료·종료된 링크는 되살리지 않는다 — 재발급은 새 행이다(T-01 링크 만료 예외).
 */
export type IntakeFormStatus = "sent" | "submitted" | "closed" | "expired";

/**
 * 시범 회차 상태 — proposed(제안·신청 접수 — 폼 제출만으로는 확정 아님, 검수 8)
 * → scheduled(확정 — 일정 확정 + (유료면) 결제 확인 둘 다 통과, T-02·검수 9)
 * → done(진행 완료) / noshow(노쇼 확정 — 10·20·30분 연락과 운영자 확인 후에만, 검수 10) / canceled.
 */
export type TrialStatus = "proposed" | "scheduled" | "done" | "noshow" | "canceled";

/**
 * 시범 결과(T-04) — regular_offer(정규수업 제안) / retrial(재시범) / followup(추가 확인·후속 상담)
 * / declined(신청자 거절) / none(미진행). 자동 합격·부적합 판정은 없고,
 * 결과가 바뀌면 이전 결과를 덮어쓰지 않고 새 결정 행을 남긴다(trial_results append-only).
 */
export type TrialResult =
  | "regular_offer"
  | "retrial"
  | "followup"
  | "declined"
  | "none";

/**
 * 정규 등록 상태 — pending(등록 준비 중 — 네 게이트 미충족, 검수 13·14) → active(활성 — 원자적 RPC
 * activate_enrollment로만 전환, 검수 12·15) → ended(등록 종료) / canceled(활성화 전 포기·만료, R-06).
 * 등록의 정본은 enrollments이고 students.status는 기존 화면 호환용 미러다.
 */
export type EnrollmentStatus = "pending" | "active" | "ended" | "canceled";

/**
 * 대기 자리 제안 상태(C-06·O-04) — offered(제안 중 — 같은 자리를 다른 사람에게 동시에 제안하지 않는다, 검수 61)
 * → accepted(수락 — 다음 단계 폼으로) / declined(거절) / expired(기한 만료).
 * 거절·만료는 자리를 반환하고 다음 대기자 검토로 잇되, 대기순서만으로 자동 확정하지 않는다(검수 62).
 */
export type WaitlistOfferStatus = "offered" | "accepted" | "declined" | "expired";
