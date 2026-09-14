import type { ScheduleListItem } from "@/lib/data/crm";
import { addKstDays, kstDateOnly, kstDayStartUtc, kstMondayOf, kstTime, parseKstWallClock } from "@/lib/kst";
import { isUuid } from "@/lib/uuid";

export type CalendarView = "week" | "month";

export function validCalendarDate(value?: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const start = kstDayStartUtc(value);
  return !!start && Number.isFinite(start.getTime()) && kstDateOnly(start) === value;
}

export function validCalendarMonth(value?: string | null): value is string {
  return !!value && /^\d{4}-\d{2}$/.test(value) && validCalendarDate(`${value}-01`);
}

export function validCalendarTime(value?: string | null): value is string {
  return !!value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function calendarHref({ view, date, studentId, day }: { view: CalendarView; date: string; studentId?: string; day?: string }) {
  const params = new URLSearchParams({ view });
  params.set("date", date);
  params.set(view === "month" ? "month" : "week", view === "month" ? date.slice(0, 7) : kstMondayOf(date));
  if (isUuid(studentId)) params.set("student", studentId);
  if (validCalendarDate(day)) params.set("day", day);
  return `/admin/schedules?${params}`;
}

export function calendarReturnHref(value: string | undefined, fallback: string): string {
  if (!value?.startsWith("/admin/schedules?")) return fallback;
  const params = new URLSearchParams(value.slice(value.indexOf("?") + 1));
  const view = params.get("view") === "month" ? "month" : "week";
  const date = view === "month" ? `${params.get("month")}-01` : params.get("week");
  if (!validCalendarDate(date)) return fallback;
  const focus = params.get("date");
  const focusedDate = validCalendarDate(focus) && (view === "month" ? focus.slice(0, 7) === date.slice(0, 7) : kstMondayOf(focus) === kstMondayOf(date)) ? focus : date;
  return calendarHref({ view, date: focusedDate, studentId: params.get("student") ?? undefined, day: params.get("day") ?? undefined });
}

export function studentColorIndex(id: string): number {
  let hash = 0;
  for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return (hash >>> 0) % 8;
}

/** Same one-hour fallback as the database's schedule_span function. */
export function scheduleEnd(item: Pick<ScheduleListItem, "scheduledAt" | "endsAt">): number {
  const start = Date.parse(item.scheduledAt);
  const end = item.endsAt ? Date.parse(item.endsAt) : NaN;
  return Number.isFinite(end) && end > start ? end : start + 60 * 60_000;
}

export function schedulesOnDay(schedules: ScheduleListItem[], date: string): ScheduleListItem[] {
  const start = kstDayStartUtc(date)!.getTime();
  const end = start + 86_400_000;
  return schedules.filter((item) => Date.parse(item.scheduledAt) < end && scheduleEnd(item) > start);
}

export function scheduleTimeLabel(item: Pick<ScheduleListItem, "scheduledAt" | "endsAt">): string {
  if (!item.endsAt) return `${kstTime(item.scheduledAt)} · 종료 미정`;
  const nextDay = kstDateOnly(item.endsAt) !== kstDateOnly(item.scheduledAt);
  return `${kstTime(item.scheduledAt)}–${nextDay ? "다음 날 " : ""}${kstTime(item.endsAt)}`;
}

export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours ? `${hours}시간` : ""}${hours && rest ? " " : ""}${rest ? `${rest}분` : ""}`;
}

export function calendarStart(date: string, time: string): Date | null {
  return validCalendarDate(date) && validCalendarTime(time) ? parseKstWallClock(`${date}T${time}`) : null;
}

export type PlacedSchedule = { item: ScheduleListItem; startMin: number; endMin: number; column: number; columnCount: number };

/** Split overnight sessions at the KST day boundary; only overlapping clusters share columns. */
export function placeSchedulesOnDay(schedules: ScheduleListItem[], date: string): PlacedSchedule[] {
  const dayStart = kstDayStartUtc(date)!.getTime();
  const timed = schedulesOnDay(schedules, date).map((item) => ({
    item,
    startMin: Math.max(0, (Date.parse(item.scheduledAt) - dayStart) / 60_000),
    endMin: Math.min(1440, (scheduleEnd(item) - dayStart) / 60_000),
  })).sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const placed: PlacedSchedule[] = [];
  let cluster: PlacedSchedule[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -1;
  function flush() {
    for (const item of cluster) item.columnCount = Math.max(1, columnEnds.length);
    placed.push(...cluster);
    cluster = [];
    columnEnds = [];
    clusterEnd = -1;
  }
  for (const item of timed) {
    if (cluster.length && item.startMin >= clusterEnd) flush();
    let column = columnEnds.findIndex((end) => end <= item.startMin);
    if (column < 0) { column = columnEnds.length; columnEnds.push(item.endMin); }
    else columnEnds[column] = item.endMin;
    cluster.push({ ...item, column, columnCount: 1 });
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  if (cluster.length) flush();
  return placed;
}

export function calendarDates(date: string, count: number) {
  return Array.from({ length: count }, (_, index) => addKstDays(date, index));
}
