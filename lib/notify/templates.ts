// 알림 템플릿 + NotifyType — notifications.type의 단일 진실 원천. SQL 마이그레이션과 Deno 엣지 함수도
// 이 테이블에 적재하므로, 새 타입은 여기 먼저 추가해야 flush가 발송할 수 있다(`pnpm audit:notify`가 강제).
// 알림톡 승인 템플릿ID는 SOLAPI_TEMPLATE_IDS(JSON) 환경변수로 주입하고, 미등록 타입은 SMS로 폴백한다.
//
// 계약(기획서 7-14) 12종 ↔ 코드 타입 대응:
//   ① 상담 접수(→관리자) = consult_admin_alert   ② 상담 접수 확인(→고객) = consult_received
//   ③ 시범수업 확정 = trial_scheduled            ④ 수업 전날 리마인더 = lesson_reminder
//   ⑤ 수업 리포트 = lesson_report                ⑥ 주간·월간·시험 리포트 = weekly_report·monthly_report·exam_report
//   ⑦ 결제 예정 D-3 = payment_d3                 ⑧ 미납 안내 = payment_overdue
//   ⑨ 보강 안내 = schedule_changed               ⑩ 후기 요청 = review_request
//   ⑪ 재등록 안내(광고성) = re_enrollment         ⑫ 개별 메시지 = custom_message
// 그 외 payment_request(청구서 발행)·payment_paid(완납 확인)·consult_confirmed(일정 확정)·
// schedule_unresolved(선생님 내부 알림)·homework_assigned(과제 배부, 00015)·
// portal_invite(역할별 포털 초대, P-01)·intake_form_sent(시범·정규 신청폼 링크, T-01·R-01)·
// trial_confirmed(시범 확정, T-02)·waitlist_offer(대기 자리 제안, C-06)는 운영 편의용 부가 타입이다.

export type NotifyType =
  | "consult_received"
  | "consult_confirmed"
  | "consult_admin_alert"
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
  | "re_enrollment"
  | "custom_message"
  | "schedule_unresolved"
  | "homework_assigned"
  | "portal_invite"
  | "intake_form_sent"
  | "trial_confirmed"
  | "waitlist_offer"
  | "enrollment_activated"
  | "review_invite"
  | "review_revision_request"
  | "review_rejected"
  | "review_published";

export const NOTIFY_TEMPLATES: Record<NotifyType, string> = {
  consult_received: "{name}님, 상담 신청이 접수되었습니다. 빠르게 연락드리겠습니다.",
  consult_confirmed: "{name}님, 상담 일정이 확정되었습니다. ({date})",
  // 관리자(선생님) 대상 — 실제 문구는 호출부(lib/actions/consult.ts)가 신청자명을 넣어 완성한다.
  consult_admin_alert: "새 상담 신청이 접수되었습니다. 관리자 페이지에서 확인해 주세요.",
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
  // 광고성(정보통신망법) — 마케팅 수신동의가 있는 대상에게만 발송(send.ts가 강제). (광고) 표기·수신거부 문구 포함.
  re_enrollment:
    "(광고) {name}님, 다시 함께 공부할 수 있길 바랍니다. 재등록 문의는 편히 연락 주세요. 무료수신거부: 회신 '거부'",
  // 개별 메시지 — 실제 문구는 관리자가 직접 입력해 호출부가 message로 넘긴다. 이 항목은 isNotifyType 통과용.
  custom_message: "{name}님께 안내 말씀 드립니다.",
  // 선생님 내부 알림 — 실제 문구는 automation_schedule_autoclean(00002)이 완성해 적재한다. 이 항목은 isNotifyType 통과용.
  schedule_unresolved: "어제 이전 미처리 일정이 있습니다. 관리자 페이지에서 확인해 주세요.",
  // 과제 배부(H-01·00015) — 포털 링크는 호출부가 붙인다.
  homework_assigned: "{name}님, 새 과제가 등록되었습니다. 포털에서 확인해 주세요.",
  // 역할별 포털 초대(P-01) — 초대 링크는 호출부가 붙인다(lib/portal/auth.ts portalLinkPath).
  // 링크 자체가 로그인 수단이라 문구에 학생 실명·수업·금전 정보를 담지 않는다(오수신 대비).
  portal_invite:
    "{name}님의 학습 포털 초대장이 도착했습니다. 아래 링크로 접속하시면 바로 이용하실 수 있습니다. 링크는 본인만 사용해 주세요.",
  // 시범·정규 신청폼 발송(T-01·R-01·00018) — 작성 링크는 호출부가 붙인다.
  // 종류(시범/정규)와 기한을 문구에 넣지 않는다: 한 문장으로 두 폼을 함께 쓰고, 기한은 링크 화면이 안내한다.
  intake_form_sent:
    "{name}님, 신청서 작성 링크를 보내드립니다. 아래 링크에서 작성해 주세요. 링크는 본인만 사용해 주세요.",
  // 시범 확정 안내(T-02) — 일정 확정과 (유료면) 결제 확인을 모두 통과한 회차에만 보낸다(검수 9).
  // 기존 trial_scheduled는 상담 화면에서 일시를 직접 입력해 보내는 수동 안내라 그대로 남겨 둔다.
  trial_confirmed: "{name}님, 시범수업이 {date}로 확정되었습니다.",
  // 대기 자리 제안(C-06) — {date}는 회신 기한(expires_at). 기한이 지나면 자리가 반환된다(검수 62).
  // 자리 번호·다른 대기자 정보는 담지 않는다(한 자리에 한 사람에게만 제안 — 검수 61).
  waitlist_offer:
    "{name}님, 수업 자리가 생겨 안내드립니다. {date}까지 회신해 주시면 자리를 배정해 드립니다.",
  enrollment_activated:
    "{name}님, 정규 수업 등록이 완료되었습니다. 학습 포털 초대가 곧 전달됩니다.",
  // 후기·성적사례 작성 초대(S-01 · 00025) — 작성 링크는 호출부가 붙인다(lib/review/token.ts reviewFormPath).
  // 자동 발송이 아니라 운영자가 학생 상세·후기 관리에서 직접 발급할 때만 나간다(S-01 자동 요청 금지).
  review_invite:
    "{name}님, 후기·성적 향상 사례 작성 링크를 보내드립니다. 아래 링크에서 작성해 주세요. 공개 여부는 작성 화면에서 직접 선택하실 수 있습니다.",
  // 수정 요청(S-03 보완 요청 → 작성자에게 반환) — 새 작성 링크를 붙여 보낸다. 사유는 링크 화면이 보여 준다.
  review_revision_request:
    "{name}님, 남겨 주신 후기·사례에 보완이 필요해 다시 작성 링크를 보내드립니다. 아래 링크에서 수정 후 다시 제출해 주세요.",
  // 반려 안내(S-03 거절 → 사유 안내) — 사유는 호출부가 {date} 자리 대신 본문에 덧붙인다.
  review_rejected:
    "{name}님, 남겨 주신 후기·사례는 검토 결과 게시하지 않기로 했습니다. 문의는 편히 연락 주세요.",
  // 게시 안내 — 공개 페이지 주소는 호출부가 붙인다.
  review_published:
    "{name}님, 남겨 주신 후기·사례가 게시되었습니다. 공개를 원하지 않으시면 언제든 철회를 요청하실 수 있습니다.",
};

/**
 * 발송 현황 화면용 한글 이름. 운영자는 'payment_d3'가 아니라 '결제 예정 D-3'을 찾는다.
 *
 * 라벨은 여기에 둔다 — NotifyType의 단일 진실 원천이 이 파일이라, 타입을 추가하면
 * Record<NotifyType, string>이 컴파일 단계에서 라벨 누락을 잡는다.
 * DB의 type은 CHECK가 없어 미등록 문자열이 올 수 있으므로, 조회는 notifyTypeLabel로 한다.
 */
export const NOTIFY_TYPE_LABEL: Record<NotifyType, string> = {
  consult_received: "상담 접수 확인",
  consult_confirmed: "상담 일정 확정",
  consult_admin_alert: "상담 접수 알림(관리자)",
  trial_scheduled: "시범수업 예약 안내",
  lesson_reminder: "수업 전날 리마인더",
  lesson_report: "수업 리포트",
  payment_request: "청구서 발행",
  payment_d3: "결제 예정 D-3",
  payment_paid: "완납 확인",
  payment_overdue: "미납 안내",
  schedule_changed: "일정 변경·보강 안내",
  weekly_report: "주간 리포트",
  monthly_report: "월간 리포트",
  exam_report: "시험 분석 리포트",
  review_request: "후기 요청",
  re_enrollment: "재등록 안내(광고)",
  custom_message: "개별 메시지",
  schedule_unresolved: "미처리 일정 알림(내부)",
  homework_assigned: "과제 배부",
  portal_invite: "포털 초대 링크",
  intake_form_sent: "신청서 작성 링크",
  trial_confirmed: "시범수업 확정",
  waitlist_offer: "대기 자리 제안",
  enrollment_activated: "정규 등록 완료",
  review_invite: "후기·사례 작성 초대",
  review_revision_request: "후기·사례 수정 요청",
  review_rejected: "후기·사례 반려 안내",
  review_published: "후기·사례 게시 안내",
};

/** DB의 type 문자열 → 한글 이름. 미등록 키는 원문을 그대로 보여 준다(숨기지 않는다). */
export function notifyTypeLabel(value: string): string {
  return isNotifyType(value) ? NOTIFY_TYPE_LABEL[value] : value;
}

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
