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

export interface ScheduleItem {
  id: string;
  studentId: string;
  scheduledAt: string; // ISO
  classType: ClassType;
  status: "planned" | "done" | "canceled" | "makeup";
  reminderSent: boolean;
  lessonId: string | null; // 완료 시 자동 생성·연결된 수업 기록
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
  /** 업무 상태 — 초안→승인→발송완료. 'failed'는 업무 상태가 아니다(전달 실패는 deliveryStatus 담당). */
  status: "draft" | "approved" | "sent";
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
