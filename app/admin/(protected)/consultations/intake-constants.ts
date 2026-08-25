import type { IntakeFormKind, IntakeFormStatus } from "@/lib/types";

// 신청폼(시범·정규) 화면 라벨 — 상담 목록·상담 상세 카드·서버 액션이 함께 쓴다.
// 정본: docs/flow-canon/01_atlas_01_intake.md T-01(시범 신청폼)·R-01(정규 신청폼)
//      · 03_scenarios_133.md 검수 5(중복 판단 전 발송 금지)·6(다음 단계 하나만 활성)·7(새 폼 발급 시 이전 폼 닫힘)
//
// 이 파일에 지시어("use client"/"use server")를 두지 않는 이유: 서버 컴포넌트(page.tsx)와
// 클라이언트 카드가 같은 라벨을 봐야 하는데, "use client" 모듈의 상수를 서버 컴포넌트가
// 직접 읽으면 클라이언트 참조 프록시라 서버에서 값을 꺼낼 수 없고, "use server" 모듈은
// 비동기 함수 외의 export를 허용하지 않는다. 그래서 지시어 없는 평범한 모듈로 둔다.

type BadgeTone = "brand" | "soft" | "success" | "warning" | "danger";

export const INTAKE_KIND_LABEL: Record<IntakeFormKind, string> = {
  trial: "시범수업 신청폼",
  regular: "정규수업 신청폼",
};

/** 버튼·배지처럼 자리가 좁은 곳에 쓰는 짧은 라벨. */
export const INTAKE_KIND_SHORT_LABEL: Record<IntakeFormKind, string> = {
  trial: "시범",
  regular: "정규",
};

export const INTAKE_FORM_STATUS_LABEL: Record<IntakeFormStatus, string> = {
  sent: "발송됨",
  submitted: "제출됨",
  closed: "닫힘",
  expired: "만료",
};

const STATUS_TONE: Record<IntakeFormStatus, BadgeTone> = {
  sent: "brand",
  submitted: "success",
  closed: "soft",
  expired: "warning",
};

export function intakeFormStatusLabel(status: IntakeFormStatus): string {
  return INTAKE_FORM_STATUS_LABEL[status] ?? status;
}

export function intakeFormStatusTone(status: IntakeFormStatus): BadgeTone {
  return STATUS_TONE[status] ?? "soft";
}

/**
 * 발급 게이트 문구(검수 5) — "중복·기존 관계 확인(C-02) 전에는 시범·정규 폼을 발송할 수 없다".
 *
 * ⚠️ 한계: consultations에 '중복 확인 완료'를 저장하는 컬럼이 없다. 이번 범위에서 스키마를
 * 늘리지 않기로 했으므로, 확인 사실은 운영자가 발급 직전에 체크박스로 선언하고 그 선언이
 * 감사 기록(activity_log.reason)에만 남는다. 즉 이 게이트는 "확인했는가"를 데이터로 증명하지
 * 못하고 "확인했다고 선언했는가"만 증명한다. 확인 결과 자체(기존 학생 연결·형제자매·별도 건)를
 * 남기려면 별도 컬럼·엔티티가 필요하며 그건 C-02 구현 과제로 남는다.
 */
export const DUPLICATE_CHECK_LABEL =
  "중복·기존 관계 확인을 완료했습니다 (동일 연락처·기존 학생·열린 상담 대조)";

export const DUPLICATE_CHECK_HINT =
  "확인 전에는 신청폼을 발송하지 않습니다. 체크는 저장되지 않고 이번 발급에만 적용되며, 발급 감사 기록에 확인 선언으로 남습니다.";
