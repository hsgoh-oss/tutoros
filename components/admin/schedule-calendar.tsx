"use client";

import { Plus } from "lucide-react";
import type { CSSProperties } from "react";
import type { ScheduleListItem } from "@/lib/data/crm";
import { kstTime } from "@/lib/kst";
import { schedulesOnDay, studentColorIndex } from "@/lib/admin-calendar";
import { scheduleStatusLabel } from "@/app/admin/(protected)/schedules/constants";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
export type CalendarOpen = (date: string, time?: string, eventId?: string) => void;
export function studentCalendarStyle(studentId: string): CSSProperties {
  return { "--student-color": `var(--calendar-student-${studentColorIndex(studentId)})` } as CSSProperties;
}

export function ScheduleCalendar({ schedules, month, today, onOpen }: {
  schedules: ScheduleListItem[]; month: string; today: string; onOpen: CalendarOpen;
}) {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const cells = Array.from({ length: Math.ceil((first + days) / 7) * 7 }, (_, index) => index >= first && index < first + days ? index - first + 1 : null);
  return <div className="calendar-month" aria-label={`${year}년 ${monthNumber}월 수업 캘린더`}>
    <div className="calendar-month-weekdays">{WEEKDAYS.map((day, index) => <span key={day} data-weekend={index === 0 ? "sun" : index === 6 ? "sat" : undefined}>{day}</span>)}</div>
    <div className="calendar-month-grid">{cells.map((day, index) => {
      if (day === null) return <div key={`blank-${index}`} className="calendar-month-blank" aria-hidden="true" />;
      const date = `${month}-${String(day).padStart(2, "0")}`;
      const items = schedulesOnDay(schedules, date);
      return <div key={date} className="calendar-month-day" data-today={date === today || undefined}
        onClick={(event) => { if (event.target === event.currentTarget) onOpen(date); }}>
        <button type="button" className="calendar-day-trigger" onClick={() => onOpen(date)} aria-label={`${date} 수업 ${items.length}건 보기 · 일정 추가`}>
          <span className="calendar-day-number" data-weekend={index % 7 === 0 ? "sun" : index % 7 === 6 ? "sat" : undefined}>{day}</span>
          <Plus size={13} className="calendar-day-plus" aria-hidden="true" />
        </button>
        <div className="calendar-month-events">
          {items.slice(0, 3).map((item) => <button type="button" key={item.id} onClick={() => onOpen(date, undefined, item.id)}
            className="calendar-month-event" style={studentCalendarStyle(item.studentId)} data-status={item.status}
            aria-label={`${kstTime(item.scheduledAt)} ${item.studentName} ${scheduleStatusLabel(item.status)} 수업 보기`}>
            <span className="calendar-student-dot" /><span className="calendar-event-time">{kstTime(item.scheduledAt)}</span><span className="truncate">{item.studentName}</span>
            {item.status !== "planned" && <span className="calendar-event-status">{scheduleStatusLabel(item.status)}</span>}
          </button>)}
          {items.length > 3 && <button type="button" className="calendar-more" onClick={() => onOpen(date)}>+{items.length - 3}건 더 보기</button>}
        </div>
      </div>;
    })}</div>
  </div>;
}
