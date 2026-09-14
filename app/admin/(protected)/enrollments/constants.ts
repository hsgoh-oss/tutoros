import type { ActivityCategory } from "@/lib/data/activity";
import type { EnrollmentGate } from "@/lib/data/intake";
import type { EnrollmentStatus } from "@/lib/types";

// 정규 등록 화면 공용 상수 — 정본: docs/flow-canon/01_atlas_01_intake.md R-02·R-03·R-04·R-05·R-06,
// 03_scenarios_133.md 검수 12(네 조건)·13(결제됐지만 일정 없음)·14(일정 있지만 결제 불명확)·15(반쪽 등록 금지).
// 라벨·판정 문구·감사 카테고리만 둔다 — 조회는 lib/data/intake.ts, 전환은 actions.ts.

type BadgeTone = "brand" | "soft" | "success" | "warning" | "danger";

/* ---------- 등록 상태 (enrollments.status) ----------
   pending은 화면에서 '등록 준비 중'이라고 부른다 — 정본 R-04가 쓰는 말 그대로이며,
   검수 13·14가 요구하는 "확정 수업이 아니다"라는 사실을 상태 이름이 먼저 말하게 한다. */

export const ENROLLMENT_STATUS_OPTIONS: { value: EnrollmentStatus; label: string }[] = [
  { value: "pending", label: "등록 준비 중" },
  { value: "active", label: "활성" },
  { value: "ended", label: "종료" },
  { value: "canceled", label: "활성화 전 취소" },
];

const STATUS_TONE: Record<EnrollmentStatus, BadgeTone> = {
  pending: "warning",
  active: "success",
  ended: "soft",
  canceled: "danger",
};

export function enrollmentStatusLabel(status: EnrollmentStatus): string {
  return ENROLLMENT_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
}

export function enrollmentStatusTone(status: EnrollmentStatus): BadgeTone {
  return STATUS_TONE[status] ?? "soft";
}

export function isEnrollmentStatus(value: string | undefined): value is EnrollmentStatus {
  return ENROLLMENT_STATUS_OPTIONS.some((o) => o.value === value);
}

/* ---------- 네 게이트 (R-04 "상태 수렴") ----------
   화면에 뜨는 순서 = 정본이 세는 순서(관계 → 계약 → 결제 → 일정). 관계가 먼저인 이유는
   R-01 예외 "미성년자에게 필요한 성인 관계가 확인되지 않으면 계약 단계 차단" 때문이다. */

export const GATE_ORDER: EnrollmentGate[] = ["relation", "contract", "payment", "schedule"];

/** lib/data/intake.ts의 ENROLLMENT_GATE_LABEL과 같은 말 — 그 모듈은 서버 전용(service client)이라
    클라이언트 번들에 들어갈 수 없어 화면 문구는 여기에 둔다(students/portal-relations-card.tsx 선례). */
export const GATE_LABEL: Record<EnrollmentGate, string> = {
  relation: "관계 확인",
  contract: "계약 수락",
  payment: "결제 확인",
  schedule: "일정 확정",
};

/** 미완 상태의 어법 — 목록 배지는 "무엇이 아직 안 됐는가"를 부른다. */
export const GATE_PENDING_LABEL: Record<EnrollmentGate, string> = {
  relation: "관계 미확인",
  contract: "계약 미동의",
  payment: "결제 미확인",
  schedule: "일정 미확정",
};

/** 완료된 확인 작업의 감사 요약. 입력 전 안내와 구분한다. */
export const GATE_EVIDENCE: Record<EnrollmentGate, string> = {
  relation: "학생·보호자·계약자·납부자 관계와 학습 공유·청구 권한을 확인했습니다.",
  contract: "수업 조건에 맞는 계약서를 작성하고 성인 계약자의 동의를 확인했습니다.",
  payment: "이 학생의 완납 청구를 근거로 결제를 확인했습니다.",
  schedule: "일정 관리에서 확정된 수업 회차를 확인했습니다.",
};

/** 아직 확인하지 않은 조건에 대한 화면 안내. */
export const GATE_GUIDANCE: Record<EnrollmentGate, string> = {
  relation:
    "학생·보호자·계약자·납부자가 각각 누구인지 확인하고, 학습 공유와 청구 권한을 기록합니다.",
  contract:
    "수업 조건에 맞는 계약서를 작성하고 성인 계약자의 동의를 기록합니다. 신청폼 동의와 별도로 확인해 주세요.",
  payment:
    "이 학생의 완납 청구를 선택합니다. 결제 결과가 불명확하면 입금 내역부터 확인해 주세요.",
  schedule: "일정 관리에 예정 또는 완료 상태로 등록된 수업이 있는지 확인합니다.",
};

export function isEnrollmentGate(value: string): value is EnrollmentGate {
  return (GATE_ORDER as string[]).includes(value);
}

/** 게이트 → enrollments 컬럼. 조건부 UPDATE의 대상 컬럼을 문자열로 조립하지 않기 위한 표. */
export const GATE_COLUMN: Record<
  EnrollmentGate,
  "relation_ok" | "contract_ok" | "payment_ok" | "schedule_ok"
> = {
  relation: "relation_ok",
  contract: "contract_ok",
  payment: "payment_ok",
  schedule: "schedule_ok",
};

/* ---------- 검수 13·14 — 준비 중 화면의 한 줄 ----------
   13: "결제됐지만 일정이 없으면 등록 준비 중에 머문다".
   14: "일정이 있지만 결제가 불명확하면 확정 수업으로 안내하지 않는다".
   두 경우 모두 활성이 아니라는 사실은 같고, 운영자가 잘못 안내하기 쉬운 지점이 달라서
   문구를 나눈다 — 화면이 '거의 다 됐다'로 읽히지 않게 하는 것이 이 함수의 일이다. */

export function preparingNotice(gates: {
  relationOk: boolean;
  contractOk: boolean;
  paymentOk: boolean;
  scheduleOk: boolean;
}): string {
  if (gates.paymentOk && !gates.scheduleOk) {
    return "결제는 확인됐습니다. 일정을 확정해야 등록을 완료할 수 있습니다. 아직 확정 수업으로 안내하지 마세요.";
  }
  if (gates.scheduleOk && !gates.paymentOk) {
    return "일정은 잡혔지만 결제가 확인되지 않았습니다. 입금 내역을 확인하기 전에는 등록을 완료하거나 확정 수업으로 안내할 수 없습니다.";
  }
  return "관계·계약·결제·일정을 모두 확인해야 등록이 완료됩니다. 준비 중인 수업은 확정 수업으로 안내하지 마세요.";
}

/* ---------- 감사 카테고리 ----------
   activity_log.category CHECK는 money·permission·grade·privacy·other를 허용하지만(00013),
   lib/data/activity.ts의 ActivityCategory 타입은 fail-closed 4종만 열거한다. 등록 생성·관계
   확인·일정 확인·활성화·종료는 금전 계열이 아니라 정본대로 'other'로 남겨야 하는데, 그 파일은
   이번 작업의 소유 밖이라 타입을 넓히지 않고 여기서 한 번만 단언한다(값은 DB 허용 범위 안이고,
   경로 자체는 runCritical이라 fail-closed 계약은 그대로다). trials/constants.ts와 같은 규약.
   계약 동의·결제 확인은 금전 근거를 남기는 전환이라 'money'를 쓴다. */
export const AUDIT_OTHER = "other" as unknown as ActivityCategory;
export const AUDIT_MONEY: ActivityCategory = "money";

/* ---------- 종료·취소 사유 ---------- */

/** 등록 종료 사유 예시 — 자유 입력이지만 자주 쓰는 말을 먼저 보여 준다(E-04 정산·회수 인계). */
export const END_REASON_HINT =
  "예: 수강 종료(과정 완료) · 학생 사정으로 중단 · 이사 · 조건 재협의 결렬";

/** 활성화 전 취소 사유 예시 — R-06 활성화 전 포기·만료. */
export const CANCEL_REASON_HINT =
  "예: 신청자 철회 · 계약 미동의 · 미결제 · 일정 미합의 · 정원 상실";
