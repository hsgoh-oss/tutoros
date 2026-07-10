import type { ClassType, Student } from "@/lib/types";

// components/ui/badge.tsx가 BadgeTone을 export하지 않아 동일한 값 집합을 로컬로 정의.
type BadgeTone = "brand" | "soft" | "success" | "warning" | "danger";

export const STUDENT_STATUS_OPTIONS: { value: Student["status"]; label: string }[] = [
  { value: "trial", label: "시범" },
  { value: "active", label: "재원" },
  { value: "paused", label: "휴원" },
  { value: "ended", label: "종료" },
];

const STATUS_TONE: Record<Student["status"], BadgeTone> = {
  trial: "warning",
  active: "success",
  paused: "soft",
  ended: "danger",
};

export function studentStatusLabel(status: Student["status"]): string {
  return STUDENT_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
}

export function studentStatusTone(status: Student["status"]): BadgeTone {
  return STATUS_TONE[status];
}

export const CLASS_TYPE_OPTIONS: { value: ClassType; label: string }[] = [
  { value: "inperson", label: "대면" },
  { value: "video", label: "화상" },
];

export function classTypeLabel(type: ClassType | null): string {
  if (!type) return "-";
  return type === "video" ? "화상" : "대면";
}
