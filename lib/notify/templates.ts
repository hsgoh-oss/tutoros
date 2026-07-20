// 알림 템플릿 + NotifyType — notifications.type의 단일 진실 원천. SQL 마이그레이션과 Deno 엣지 함수도
// 이 테이블에 적재하므로, 새 타입은 여기 먼저 추가해야 flush가 발송할 수 있다(`pnpm audit:notify`가 강제).
// 알림톡 승인 템플릿ID는 SOLAPI_TEMPLATE_IDS(JSON) 환경변수로 주입하고, 미등록 타입은 SMS로 폴백한다.
// ⚠️ 현재 14종 vs 계약 "12종": exam_report(시험 리포트)·schedule_unresolved(선생님 내부 알림) 차이 — 검수 전 원문 대조 필요.

export type NotifyType =
  | "consult_received"
  | "consult_confirmed"
  | "trial_scheduled"
  | "lesson_reminder"
  | "lesson_report"
  | "payment_request"
  | "payment_d3"
  | "payment_paid"
  | "payment_overdue"
  | "schedule_changed"
  | "weekly_report"
  | "monthly_report"
  | "exam_report"
  | "review_request"
  | "schedule_unresolved";

export const NOTIFY_TEMPLATES: Record<NotifyType, string> = {
  consult_received: "{name}님, 상담 신청이 접수되었습니다. 빠르게 연락드리겠습니다.",
  consult_confirmed: "{name}님, 상담 일정이 확정되었습니다. ({date})",
  trial_scheduled: "{name}님, 시범수업이 {date}로 예약되었습니다.",
  lesson_reminder: "{name}님, {date} 수업 예정입니다. 준비물을 확인해 주세요.",
  lesson_report: "{name}님, 오늘 수업 리포트가 도착했습니다.",
  payment_request: "{name}님, {amount} 수강료 청구서가 발행되었습니다. 안내드린 방법(계좌이체 또는 결제선생)으로 결제 부탁드립니다.",
  payment_d3: "{name}님, 결제 마감일이 3일 남았습니다. ({amount})",
  payment_paid: "{name}님, 결제가 완료되었습니다. 감사합니다.",
  payment_overdue: "{name}님, 결제 기한이 지났습니다. 확인 부탁드립니다. ({amount})",
  schedule_changed: "{name}님, 수업 일정이 변경되었습니다. ({date})",
  weekly_report: "{name}님, 주간 학습 리포트가 도착했습니다.",
  monthly_report: "{name}님, 월간 학습 리포트가 도착했습니다.",
  exam_report: "{name}님, 시험 분석 리포트가 도착했습니다.",
  review_request: "{name}님, 그동안의 수업은 어떠셨나요? 짧은 후기를 남겨 주시면 큰 힘이 됩니다.",
  // 선생님 내부 알림 — 실제 문구는 automation_schedule_autoclean(00002)이 완성해 적재한다. 이 항목은 isNotifyType 통과용.
  schedule_unresolved: "어제 이전 미처리 일정이 있습니다. 관리자 페이지에서 확인해 주세요.",
};

/** DB 문자열이 알려진 알림 종류인지 판별. notifications.type엔 CHECK가 없어, flush 경로는 이 가드를 반드시 통과시킨다. */
export function isNotifyType(value: string): value is NotifyType {
  return Object.hasOwn(NOTIFY_TEMPLATES, value);
}

export interface TemplateVars {
  name?: string;
  date?: string;
  amount?: string;
}

export function renderTemplate(type: NotifyType, vars: TemplateVars = {}): string {
  return NOTIFY_TEMPLATES[type]
    .replaceAll("{name}", vars.name ?? "고객")
    .replaceAll("{date}", vars.date ?? "")
    .replaceAll("{amount}", vars.amount ?? "");
}

/** 알림톡 템플릿ID 조회 — 미설정·미등록 타입이면 null(호출부가 SMS로 폴백). */
export function getNotifyTemplateId(type: string): string | null {
  const raw = process.env.SOLAPI_TEMPLATE_IDS;
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as Record<string, string>;
    return map[type] ?? null;
  } catch {
    console.error("[notify] SOLAPI_TEMPLATE_IDS JSON 파싱 실패");
    return null;
  }
}
