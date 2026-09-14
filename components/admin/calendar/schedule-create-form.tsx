"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field, Input, Select } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button";
import { createSchedule } from "@/app/admin/(protected)/schedules/actions";
import { calendarHref, calendarStart, durationLabel, scheduleEnd, validCalendarDate, type CalendarView } from "@/lib/admin-calendar";
import { kstDateOnly, kstTime } from "@/lib/kst";
import type { ClassType } from "@/lib/types";
import type { ScheduleListItem } from "@/lib/data/crm";

export type CalendarStudent = { id: string; name: string; classType?: ClassType };

export function ScheduleCreateForm({ students, initialStudentId = "", initialDate, initialTime = "", lockDate = false,
  schedules = [], view = "week", returnHref, onCreated, onCancel, onPendingChange }: {
  students: CalendarStudent[]; initialStudentId?: string; initialDate: string; initialTime?: string;
  lockDate?: boolean; schedules?: ScheduleListItem[]; view?: CalendarView; returnHref?: string;
  onCreated?: (studentId: string) => void; onCancel?: () => void; onPendingChange?: (pending: boolean) => void;
}) {
  const router = useRouter();
  const [studentId, setStudentId] = useState(initialStudentId);
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const [duration, setDuration] = useState("60");
  const [classType, setClassType] = useState<ClassType>(students.find((student) => student.id === initialStudentId)?.classType ?? "inperson");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = calendarStart(date, time);
  const end = start ? new Date(start.getTime() + Number(duration) * 60_000) : null;
  const overlaps = start && end ? schedules.filter((item) => ["planned", "makeup"].includes(item.status) && Date.parse(item.scheduledAt) < end.getTime() && scheduleEnd(item) > start.getTime()) : [];
  const sameStudentOverlap = overlaps.some((item) => item.studentId === studentId);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true); onPendingChange?.(true); setError(null);
    const formData = new FormData(event.currentTarget);
    formData.set("scheduledAt", `${date}T${time}`);
    try {
      const result = await createSchedule(formData);
      if (!result.ok) setError(result.error ?? "일정을 등록하지 못했습니다.");
      else if (onCreated) onCreated(studentId);
      else {
        router.push(calendarHref({ view, date, studentId, day: date }));
        router.refresh();
      }
    } catch {
      setError("요청을 완료하지 못했습니다. 입력 내용은 유지됩니다. 다시 시도해 주세요.");
    } finally { setPending(false); onPendingChange?.(false); }
  }

  return <form onSubmit={submit} className="calendar-create-form">
    <fieldset disabled={pending} className="grid min-w-0 gap-4 sm:grid-cols-2">
      <Field label="학생" required className="sm:col-span-2">
        <Select name="studentId" required value={studentId} onChange={(event) => {
          setStudentId(event.target.value);
          setClassType(students.find((student) => student.id === event.target.value)?.classType ?? "inperson");
        }}>
          <option value="" disabled>학생을 선택하세요</option>
          {students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
        </Select>
      </Field>
      {!lockDate && <Field label="날짜" required className="sm:col-span-2"><Input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></Field>}
      <Field label="시작 시간" required><Input name="startTime" type="time" required step={900} value={time} onChange={(event) => setTime(event.target.value)} /></Field>
      <Field label="수업 시간" required>
        <Select name="durationMinutes" value={duration} onChange={(event) => setDuration(event.target.value)}>
          {[30, 45, 60, 90, 120, 150, 180, 240].map((minutes) => <option key={minutes} value={minutes}>{durationLabel(minutes)}</option>)}
        </Select>
      </Field>
      <Field label="수업 방식" className="sm:col-span-2">
        <Select name="classType" value={classType} onChange={(event) => setClassType(event.target.value as ClassType)}><option value="inperson">대면</option><option value="video">화상</option></Select>
      </Field>
    </fieldset>
    {start && end && <p className="calendar-form-hint">{time} 시작 · {kstDateOnly(end) !== date && "다음 날 "}{kstTime(end)} 종료</p>}
    {overlaps.length > 0 && <div className="calendar-overlap" role="status">
      <p>{sameStudentOverlap ? "이 학생의 기존 수업과 시간이 겹칩니다." : "같은 시간에 다른 학생의 수업이 있습니다."}</p>
      <ul>{overlaps.map((item) => <li key={item.id}>{kstTime(item.scheduledAt)} {item.studentName}</li>)}</ul>
      <p>{sameStudentOverlap ? "시작 시간이나 수업 시간을 조정해 주세요." : "함께 진행할 수 있는 수업인지 확인해 주세요."}</p>
    </div>}
    {students.length === 0 && <p className="calendar-form-hint">먼저 <Link className="text-brand-700 underline" href="/admin/students/new">학생을 등록</Link>해 주세요.</p>}
    {error && <p className="mt-4 text-sm text-rose-600" role="alert">{error}</p>}
    <div className="calendar-form-actions">
      {onCancel ? <button type="button" className={buttonClass("outline", "sm")} disabled={pending} onClick={onCancel}>돌아가기</button>
        : returnHref && <Link className={buttonClass("outline", "sm")} href={returnHref}>취소</Link>}
      <button type="submit" disabled={pending || !studentId || !time || !validCalendarDate(date) || sameStudentOverlap} className={buttonClass("primary", "sm")}>{pending ? "등록 중…" : "일정 등록"}</button>
    </div>
  </form>;
}
