import type {
  Attendance,
  DeductionState,
  LedgerKind,
  LessonPackageStatus,
} from "@/lib/types";

type BadgeTone = "brand" | "soft" | "success" | "warning" | "danger";

export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

export const PACKAGE_STATUS_OPTIONS: { value: LessonPackageStatus; label: string }[] = [
  { value: "draft", label: "준비" },
  { value: "active", label: "진행" },
  { value: "ended", label: "종료" },
];

const PACKAGE_TONE: Record<LessonPackageStatus, BadgeTone> = {
  draft: "soft",
  active: "success",
  ended: "warning",
};

export function packageStatusLabel(s: LessonPackageStatus): string {
  return PACKAGE_STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;
}

export function packageStatusTone(s: LessonPackageStatus): BadgeTone {
  return PACKAGE_TONE[s];
}

export function isPackageStatus(v: string | undefined): v is LessonPackageStatus {
  return v === "draft" || v === "active" || v === "ended";
}

// 출결(L-04). 정본이 나누는 여섯 갈래를 그대로 쓴다 — 결석 하나로 뭉치면 차감·보강 정책 판정이
// 무엇을 근거로 갈렸는지 남지 않는다.
export const ATTENDANCE_OPTIONS: { value: Attendance; label: string; hint: string }[] = [
  { value: "present", label: "출석", hint: "정상 진행" },
  { value: "late", label: "지각", hint: "실제 시작 시각을 함께 남깁니다" },
  { value: "early_leave", label: "조퇴", hint: "실제 종료 시각을 함께 남깁니다" },
  { value: "excused_absence", label: "사유 인정 결석", hint: "차감·보강 정책 판정 대상" },
  { value: "absent", label: "일반 결석", hint: "차감·보강 정책 판정 대상" },
  { value: "noshow", label: "노쇼", hint: "10·20·30분 연락이 모두 무응답이어야 확정됩니다" },
];

const ATTENDANCE_TONE: Record<Attendance, BadgeTone> = {
  present: "success",
  late: "warning",
  early_leave: "warning",
  excused_absence: "soft",
  absent: "danger",
  noshow: "danger",
};

export function attendanceLabel(a: Attendance | null): string {
  if (!a) return "미확정";
  return ATTENDANCE_OPTIONS.find((o) => o.value === a)?.label ?? a;
}

export function attendanceTone(a: Attendance | null): BadgeTone {
  return a ? ATTENDANCE_TONE[a] : "soft";
}

const DEDUCTION_LABEL: Record<DeductionState, string> = {
  none: "미판정",
  deducted: "차감",
  waived: "무차감",
};

export function deductionLabel(d: DeductionState): string {
  return DEDUCTION_LABEL[d] ?? d;
}

const LEDGER_LABEL: Record<LedgerKind, string> = {
  deduct: "차감",
  restore: "복원",
  grant: "회차 부여",
  adjust: "조정",
};

export function ledgerKindLabel(k: LedgerKind): string {
  return LEDGER_LABEL[k] ?? k;
}

export const CONTACT_CHANNEL_OPTIONS = [
  { value: "call", label: "전화" },
  { value: "sms", label: "문자" },
  { value: "kakao", label: "알림톡" },
  { value: "other", label: "기타" },
] as const;

export const CONTACT_RESULT_OPTIONS = [
  { value: "no_answer", label: "무응답" },
  { value: "reached", label: "연락됨" },
  { value: "entered", label: "입장함" },
] as const;

export const REQUESTER_ROLE_OPTIONS = [
  { value: "operator", label: "운영자" },
  { value: "teacher", label: "강사" },
  { value: "parent", label: "학부모" },
  { value: "student", label: "학생" },
] as const;

/** 반복 조건을 사람이 읽는 문장으로. */
export function patternSummary(weekdays: number[], time: string, durationMin: number): string {
  if (weekdays.length === 0 || !time) return "반복 조건 없음";
  const days = weekdays.map((d) => WEEKDAY_LABELS[d] ?? "?").join("·");
  return `매주 ${days} ${time} · ${durationMin}분`;
}
