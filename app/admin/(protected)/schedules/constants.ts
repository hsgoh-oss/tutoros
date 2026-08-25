import type { ClassType, ScheduleItem } from "@/lib/types";

type BadgeTone = "brand" | "soft" | "success" | "warning" | "danger";

export const SCHEDULE_STATUS_OPTIONS: { value: ScheduleItem["status"]; label: string }[] = [
  { value: "planned", label: "예정" },
  { value: "done", label: "완료" },
  { value: "canceled", label: "취소" },
  { value: "makeup", label: "보강" },
  { value: "conflict", label: "충돌" },
];

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
