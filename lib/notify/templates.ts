// 알림 템플릿 — 기획서 6-5. sendNotification 호출 전 renderTemplate로 메시지를 만든다.
// 알림톡 승인 템플릿(카카오 비즈니스 채널 심사)은 테넌트·문구별로 별도 등록되므로, 템플릿ID는
// SOLAPI_TEMPLATE_IDS(JSON 문자열, {"타입": "템플릿ID"}) 환경변수로 주입한다.
// 미등록 타입은 알림톡을 시도하지 않고 바로 SMS 폴백으로 넘어간다(lib/notify/send.ts).
//
// 이 유니온이 notifications.type의 단일 진실 원천이다. SQL(마이그레이션)과 Deno 엣지 함수도
// 이 테이블에 알림을 적재하므로, 여기에 없는 타입을 넣으면 app/api/cron/flush가 발송하지 못한다.
// 정합은 `pnpm audit:notify`가 강제한다 (SQL·엣지 함수의 type 문자열 ↔ 이 유니온 대조).
//
// ⚠️ 현재 14종 — 계약 문구는 "알림 12종"이다. 차이는 다음 둘이며 검수 전 원문 대조가 필요하다.
//   · exam_report        : AI 리포트 발송 대상은 4종(수업·주간·월간·시험)인데 초기 12종에 시험이
//                          빠져 있어, 시험 리포트가 알림톡에 매핑되지 못하고 항상 SMS로만 나갔다.
//   · schedule_unresolved: 자동화 job 8(automation_schedule_autoclean)이 적재하는 선생님 내부 알림.
//                          고객 대상 알림이 아니라 계약의 "12종"과 다른 범주일 수 있다.

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
  // 선생님 내부 알림. 실제 문구는 automation_schedule_autoclean(00002)이 미처리 건수를 넣어
  // 완성된 message로 적재하므로 renderTemplate를 거치지 않는다. 이 항목은 isNotifyType 통과용.
  schedule_unresolved: "어제 이전 미처리 일정이 있습니다. 관리자 페이지에서 확인해 주세요.",
};

/**
 * DB에서 읽은 문자열이 알려진 알림 종류인지 판별한다.
 * notifications.type에는 CHECK 제약이 없어 임의 문자열이 저장될 수 있으므로,
 * 큐를 다시 읽어 발송하는 경로(app/api/cron/flush)는 반드시 이 가드를 통과시켜야 한다.
 */
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
