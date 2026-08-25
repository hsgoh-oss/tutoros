import type { ActivityCategory } from "@/lib/data/activity";
import type { TrialGate } from "@/lib/data/intake";
import type { TrialResult, TrialStatus } from "@/lib/types";

// 시범수업 관리 화면 공용 상수 — 정본: docs/flow-canon/01_atlas_01_intake.md T-02·T-03·T-04,
// 03_scenarios_133.md 검수 8·9·10·11. 라벨·톤·판정 상수만 두고 조회·전환은 두지 않는다.

type BadgeTone = "brand" | "soft" | "success" | "warning" | "danger";

/* ---------- 회차 상태 (trial_sessions.status) ---------- */

export const TRIAL_STATUS_OPTIONS: { value: TrialStatus; label: string }[] = [
  { value: "proposed", label: "제안" },
  { value: "scheduled", label: "확정" },
  { value: "done", label: "완료" },
  { value: "noshow", label: "노쇼" },
  { value: "canceled", label: "취소" },
];

const STATUS_TONE: Record<TrialStatus, BadgeTone> = {
  proposed: "brand",
  scheduled: "success",
  done: "soft",
  noshow: "danger",
  canceled: "danger",
};

export function trialStatusLabel(status: TrialStatus): string {
  return TRIAL_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
}

export function trialStatusTone(status: TrialStatus): BadgeTone {
  return STATUS_TONE[status];
}

export function isTrialStatus(value: string | undefined): value is TrialStatus {
  return TRIAL_STATUS_OPTIONS.some((o) => o.value === value);
}

/* ---------- 확정까지 남은 조건 (검수 8·9) ----------
   lib/data/intake.ts의 TRIAL_GATE_LABEL은 "무엇을 해야 하는가"(일정 확정·결제 확인)를 부르는
   이름이고, 목록 배지는 "무엇이 아직 안 됐는가"를 부른다 — 같은 게이트의 다른 어법이라
   화면 문구를 여기서 따로 든다. */
export const TRIAL_GATE_PENDING_LABEL: Record<TrialGate, string> = {
  schedule: "일정 미정",
  payment: "결제 미확인",
};

/* ---------- 시범 결과 (trial_results.result · T-04 다섯 분기) ---------- */

export const TRIAL_RESULT_OPTIONS: { value: TrialResult; label: string; hint: string }[] = [
  {
    value: "regular_offer",
    label: "정규 제안",
    hint: "상담 상세에서 정규수업 신청폼을 발급할 수 있게 됩니다(검수 11).",
  },
  { value: "retrial", label: "재시범", hint: "새 시범 회차를 다시 만들어 일정을 잡습니다." },
  { value: "followup", label: "후속 상담", hint: "추가 확인이 필요해 상담으로 되돌립니다." },
  { value: "declined", label: "신청자 거절", hint: "신청자가 진행하지 않기로 했습니다 — 상담 종결로 이어집니다." },
  { value: "none", label: "미진행", hint: "시범이 진행되지 않은 채 종료됐습니다 — 상담 종결로 이어집니다." },
];

const RESULT_TONE: Record<TrialResult, BadgeTone> = {
  regular_offer: "success",
  retrial: "warning",
  followup: "brand",
  declined: "danger",
  none: "soft",
};

export function trialResultLabel(result: TrialResult): string {
  return TRIAL_RESULT_OPTIONS.find((o) => o.value === result)?.label ?? result;
}

export function trialResultTone(result: TrialResult): BadgeTone {
  return RESULT_TONE[result];
}

export function isTrialResult(value: string): value is TrialResult {
  return TRIAL_RESULT_OPTIONS.some((o) => o.value === value);
}

/* ---------- 취소 귀책 (T-03: 요청 주체·시각·귀책 확인) ---------- */

export type TrialCancelFault = "operator" | "applicant";

export const TRIAL_CANCEL_FAULT_OPTIONS: {
  value: TrialCancelFault;
  label: string;
  hint: string;
}[] = [
  {
    value: "operator",
    label: "운영자 귀책",
    hint: "무상 재예약 또는 전액 환불 대상입니다(T-03).",
  },
  {
    value: "applicant",
    label: "신청자 요청",
    hint: "승인된 환불·차감 정책에 따라 정산합니다(T-03).",
  },
];

export function trialCancelFaultLabel(value: string): string {
  return TRIAL_CANCEL_FAULT_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function isTrialCancelFault(value: string): value is TrialCancelFault {
  return TRIAL_CANCEL_FAULT_OPTIONS.some((o) => o.value === value);
}

/* ---------- 노쇼 연락 기록 (검수 10) ----------
   정본 T-03: "10분·20분·30분 연락 → 모두 무응답이고 30분 경과 → 운영자 노쇼 확정".
   자동 판정 금지라 연락 3건은 사람이 그 시점에 하나씩 남기고, 노쇼 확정은 3건이 모두
   남은 뒤에만 열린다. 기록 저장소는 activity_log다 — 회차 행에 컬럼을 더하지 않고
   append-only 감사 이력에 남겨 "언제·누가 연락했는지"가 그대로 대조된다(00013 P-11).
   활동 종류(action)에 분(minute)을 실어 세 기록을 구분한다. */

export const NOSHOW_CONTACT_MINUTES = [10, 20, 30] as const;
export type NoshowContactMinute = (typeof NOSHOW_CONTACT_MINUTES)[number];

/** 노쇼 연락 기록의 activity_log.action 값 — 조회·판정이 같은 규칙을 쓰도록 한 곳에서 만든다. */
export function noshowContactAction(minute: NoshowContactMinute): string {
  return `trial_noshow_contact_${minute}`;
}

export function isNoshowContactMinute(value: number): value is NoshowContactMinute {
  return (NOSHOW_CONTACT_MINUTES as readonly number[]).includes(value);
}

/** 노쇼 확정 가능 시점 = 시작 30분 경과. 연락 3건과 함께 서버가 다시 확인한다. */
export const NOSHOW_CONFIRM_AFTER_MINUTES = 30;

/* ---------- 감사 카테고리 ----------
   activity_log.category CHECK는 money·permission·grade·privacy·other를 허용하지만(00013),
   lib/data/activity.ts의 ActivityCategory 타입은 중요 4종만 열거한다. 시범 일정 합의·확정·
   완료·결과 기록은 금전 계열이 아니라 정본대로 'other'로 남겨야 하는데, 그 파일은 이번
   작업의 소유 밖이라 타입을 넓히지 않고 여기서 한 번만 단언한다(값은 DB 허용 범위 안이다).
   반대로 노쇼 확정·취소·유료 여부·결제 확인은 금전 판단에 직접 연결되므로 'money'를 쓴다. */
export const AUDIT_OTHER = "other" as unknown as ActivityCategory;
export const AUDIT_MONEY: ActivityCategory = "money";

/** 일정 충돌 확인 폭 — 같은 시각 ±1시간(T-02 "충돌 확인"). 경고이지 금지는 아니다. */
export const SCHEDULE_CONFLICT_WINDOW_MINUTES = 60;
