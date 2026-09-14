"use client";

import type { ScheduleListItem } from "@/lib/data/crm";
import { calendarDates, placeSchedulesOnDay } from "@/lib/admin-calendar";
import { kstDateOnly, kstTime } from "@/lib/kst";
import { scheduleStatusLabel } from "@/app/admin/(protected)/schedules/constants";
import { attendanceLabel } from "@/app/admin/(protected)/packages/constants";
import { studentCalendarStyle, type CalendarOpen } from "./schedule-calendar";

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];
const HOUR_PX = 60;

export function ScheduleWeekCalendar({ schedules, monday, today, onOpen }: {
  schedules: ScheduleListItem[]; monday: string; today: string; onOpen: CalendarOpen;
}) {
  const days = calendarDates(monday, 7);
  const placed = days.map((day) => placeSchedulesOnDay(schedules, day));
  const all = placed.flat();
  const startHour = Math.floor(Math.min(9 * 60, ...all.map((item) => item.startMin)) / 60);
  const endHour = Math.ceil(Math.max(22 * 60, ...all.map((item) => item.endMin)) / 60);
  const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
  return <div className="calendar-week-wrap">
    <p className="calendar-scroll-hint">옆으로 밀어 다른 요일을 확인할 수 있습니다.</p>
    <div className="calendar-week" aria-label="주간 수업 캘린더">
      <div className="calendar-week-header"><span aria-hidden="true" />{days.map((day, index) => <button type="button" key={day}
        onClick={() => onOpen(day)} data-today={day === today || undefined} aria-label={`${day} 수업 보기 · 일정 추가`}>
        <span data-weekend={index === 6 ? "sun" : index === 5 ? "sat" : undefined}>{WEEKDAYS[index]}</span><strong>{Number(day.slice(8))}</strong>
      </button>)}</div>
      <div className="calendar-week-body">
        <div className="calendar-time-axis">{hours.map((hour) => <div key={hour} style={{ height: HOUR_PX }}><span>{hour}시</span></div>)}</div>
        {days.map((day, index) => <div key={day} className="calendar-week-day" data-today={day === today || undefined} style={{ height: hours.length * HOUR_PX }}>
          {hours.map((hour) => <button type="button" key={hour} tabIndex={-1} className="calendar-time-slot" style={{ height: HOUR_PX }}
            aria-label={`${day} ${String(hour).padStart(2, "0")}:00 일정 추가`} onClick={() => onOpen(day, `${String(hour).padStart(2, "0")}:00`)}><span>+ {hour}:00</span></button>)}
          {placed[index].map(({ item, startMin, endMin, column, columnCount }) => <button type="button" key={item.id}
            onClick={() => onOpen(day, undefined, item.id)} className="calendar-week-event" data-status={item.status}
            style={{ ...studentCalendarStyle(item.studentId), top: (startMin / 60 - startHour) * HOUR_PX, height: Math.max(24, (endMin - startMin) / 60 * HOUR_PX - 2), left: `calc(${column / columnCount * 100}% + 3px)`, width: `calc(${100 / columnCount}% - 6px)` }}
            aria-label={`${kstTime(item.scheduledAt)} ${item.studentName} ${item.attendance ? attendanceLabel(item.attendance) : scheduleStatusLabel(item.status)} 수업 보기`}>
            <span className="calendar-week-event-name">{item.studentName}</span>
            <span>{kstDateOnly(item.scheduledAt) !== day ? "전날부터" : kstTime(item.scheduledAt)}{item.endsAt && `–${kstDateOnly(item.endsAt) !== day ? "24:00" : kstTime(item.endsAt)}`}</span>
            <small>{item.attendance ? attendanceLabel(item.attendance) : scheduleStatusLabel(item.status)}{item.classType === "video" ? " · 화상" : ""}</small>
          </button>)}
        </div>)}
      </div>
    </div>
  </div>;
}
