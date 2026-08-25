import type { ClassType, ScheduleItem } from "@/lib/types";

type BadgeTone = "brand" | "soft" | "success" | "warning" | "danger";

// 표시·필터용 전체 목록. 'conflict'는 후보 생성이 붙이는 판정 결과라 여기엔 있지만
// 아래 수동 변경 목록에는 없다.
export const SCHEDULE_STATUS_OPTIONS: { value: ScheduleItem["status"]; label: string }[] = [
  { value: "planned", label: "예정" },
  { value: "done", label: "완료" },
  { value: "canceled", label: "취소" },
  { value: "makeup", label: "보강" },
  { value: "conflict", label: "충돌" },
];

// 운영자가 드롭다운에서 직접 지정할 수 있는 값. 서버 액션의 검증 목록과 같아야 한다 —
// 고를 수 있는데 항상 거부되는 값이 있으면 화면이 거짓말을 한다.
export const MANUAL_SCHEDULE_STATUS_OPTIONS = SCHEDULE_STATUS_OPTIONS.filter(
  (o) => o.value !== "conflict",
);

const STATUS_TONE: Record<ScheduleItem["status"], BadgeTone> = {
  planned: "brand",
  done: "success",
  canceled: "danger",
  makeup: "warning",
  conflict: "warning",
};

export function scheduleStatusLabel(status: ScheduleItem["status"]): string {
  return SCHEDULE_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
}

export function scheduleStatusTone(status: ScheduleItem["status"]): BadgeTone {
  return STATUS_TONE[status];
}

export const CLASS_TYPE_OPTIONS: { value: ClassType; label: string }[] = [
  { value: "inperson", label: "대면" },
  { value: "video", label: "화상" },
];

export function classTypeLabel(classType: ClassType): string {
  return classType === "video" ? "화상" : "대면";
}
