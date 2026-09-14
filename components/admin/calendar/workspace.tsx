"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Clock3, Plus, Users, Video, X } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ScheduleCalendar, studentCalendarStyle, type CalendarOpen } from "@/components/admin/schedule-calendar";
import { ScheduleWeekCalendar } from "@/components/admin/schedule-week-calendar";
import { ScheduleCreateForm, type CalendarStudent } from "./schedule-create-form";
import { buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/form";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { SessionControls, type SessionMode } from "./session-controls";
import { calendarHref, durationLabel, schedulesOnDay, scheduleTimeLabel, type CalendarView } from "@/lib/admin-calendar";
import { addKstDays, addKstMonths, formatKDate, formatKDateTime, kstDateOnly } from "@/lib/kst";
import type { ScheduleListItem } from "@/lib/data/crm";
import { classTypeLabel, scheduleStatusLabel, scheduleStatusTone } from "@/app/admin/(protected)/schedules/constants";
import { attendanceLabel, attendanceTone, deductionLabel } from "@/app/admin/(protected)/packages/constants";

type Selection = { date: string; time?: string; eventId?: string; creating: boolean; mode?: SessionMode };
export function CalendarWorkspace({ schedules, students, studentId, view, focusDate, from, to, today, initialDay, connected }: {
  schedules: ScheduleListItem[]; students: CalendarStudent[]; studentId: string; view: CalendarView;
  focusDate: string; from: string; to: string; today: string; initialDay?: string; connected: boolean;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [selection, setSelection] = useState<Selection | null>(initialDay ? { date: initialDay, creating: false } : null);
  const [saving, setSaving] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [notice, setNotice] = useState("");
  const [followDate, setFollowDate] = useState<string>();
  const filtered = studentId ? schedules.filter((item) => item.studentId === studentId) : schedules;
  const selectedStudent = students.find((student) => student.id === studentId);
  const activeDay = selection?.date ?? focusDate;
  const dayItems = schedulesOnDay(filtered, activeDay);
  const calendarUrl = calendarHref({ view, date: focusDate, studentId });
  const returnUrl = calendarHref({ view, date: focusDate, studentId, day: activeDay });
  const detailHref = (item: ScheduleListItem) => `/admin/schedules/${item.id}?from=${encodeURIComponent(returnUrl)}`;
  const previous = view === "month" ? `${addKstMonths(from.slice(0, 7), -1)}-01` : addKstDays(from, -7);
  const next = view === "month" ? to : addKstDays(from, 7);
  const unit = view === "month" ? "달" : "주";
  const defaultDate = today >= from && today < to ? today : focusDate;
  const legend = students.filter((student) => schedules.some((item) => item.studentId === student.id));

  useEffect(() => {
    if (selection) {
      if (!dialog.current?.open) dialog.current?.showModal();
      dialog.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: "nearest" });
    }
    else dialog.current?.close();
  }, [selection]);

  const open: CalendarOpen = (date, time, eventId) => {
    setNotice("");
    setFollowDate(undefined);
    setSelection({ date, time, eventId, creating: time !== undefined });
  };
  function manage(item: ScheduleListItem, mode: SessionMode) {
    setNotice(""); setFollowDate(undefined);
    setSelection({ date: selection?.date ?? (kstDateOnly(item.scheduledAt) < from ? from : kstDateOnly(item.scheduledAt)), eventId: item.id, creating: false, mode });
  }
  function saved(message: string, date?: string) {
    setSelection((current) => current && { ...current, mode: undefined });
    setNotice(message); setFollowDate(date);
    closeButton.current?.focus();
    startTransition(() => router.refresh());
  }
  function close() { if (!saving) setSelection(null); }
  function filterStudent(id: string) {
    startTransition(() => router.push(calendarHref({ view, date: focusDate, studentId: id }), { scroll: false }));
  }
  function created(id: string) {
    setSelection((current) => current && { ...current, creating: false, eventId: undefined });
    setNotice("일정을 등록했습니다.");
    closeButton.current?.focus();
    startTransition(() => {
      if (studentId && id !== studentId) router.push(calendarHref({ view, date: focusDate, studentId: id, day: activeDay }), { scroll: false });
      router.refresh();
    });
  }

  return <div className="dash-page calendar-workspace">
    <AdminPageHeader>
      <h1>수업 캘린더</h1>
      <div className="flex items-center gap-2">
        <Link href={`/admin/schedules/export?${new URLSearchParams({ student: studentId, from, to: addKstDays(to, -1), back: calendarUrl })}`} className={buttonClass("outline", "sm")}>내보내기</Link>
        <button type="button" className={buttonClass("primary", "sm")} onClick={() => open(defaultDate, "") }><Plus size={15} aria-hidden="true" />일정 추가</button>
      </div>
    </AdminPageHeader>
    {!connected && <DbBanner />}
    <div className="calendar-toolbar">
      <div className="calendar-period-controls">
        <Link className="dash-icon-button" href={calendarHref({ view, date: previous, studentId })} aria-label={`이전 ${unit}`}><ChevronLeft size={18} /></Link>
        <h2>{view === "month" ? `${Number(from.slice(0, 4))}년 ${Number(from.slice(5, 7))}월` : `${formatKDate(from)} – ${formatKDate(addKstDays(to, -1))}`}</h2>
        <Link className="dash-icon-button" href={calendarHref({ view, date: next, studentId })} aria-label={`다음 ${unit}`}><ChevronRight size={18} /></Link>
        <Link className={buttonClass("ghost", "sm")} href={calendarHref({ view, date: today, studentId })}>오늘</Link>
      </div>
      <div className="calendar-view-tools">
        <div className="calendar-student-filter"><Users size={15} aria-hidden="true" /><Select aria-label="학생별 일정" value={studentId} onChange={(event) => filterStudent(event.target.value)}>
          <option value="">전체 학생</option>{students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
        </Select></div>
        <nav className="calendar-view-tabs" aria-label="캘린더 보기">{(["week", "month"] as const).map((mode) => <Link key={mode} href={calendarHref({ view: mode, date: focusDate, studentId })} aria-current={view === mode ? "page" : undefined}>{mode === "week" ? "주간" : "월간"}</Link>)}</nav>
      </div>
    </div>
    <div className="calendar-context">
      <p>{selectedStudent ? `${selectedStudent.name} · ` : ""}{view === "month" ? "이번 달" : "이번 주"} 수업 <strong>{filtered.length}건</strong><span>날짜를 눌러 확인하거나 추가하세요.</span></p>
      {selectedStudent && <Link className="calendar-student-profile" href={`/admin/students/${studentId}`}>학생 상세<ArrowUpRight size={13} /></Link>}
    </div>
    {legend.length > 0 && <div className="calendar-legend" aria-label="학생별 색상">
      <button type="button" aria-pressed={!studentId} onClick={() => filterStudent("")}>전체</button>
      {legend.map((student) => <button type="button" key={student.id} aria-pressed={studentId === student.id} style={studentCalendarStyle(student.id)} onClick={() => filterStudent(studentId === student.id ? "" : student.id)}>
        <span className="calendar-student-dot" />{student.name}<small>{schedules.filter((item) => item.studentId === student.id).length}</small>
      </button>)}
    </div>}
    <div aria-busy={refreshing} className={refreshing && !selection ? "calendar-refreshing" : undefined}>
      {view === "month" ? <ScheduleCalendar schedules={filtered} month={from.slice(0, 7)} today={today} onOpen={open} />
        : <ScheduleWeekCalendar schedules={filtered} monday={from} today={today} onOpen={open} />}
    </div>
    <div className="calendar-list-heading"><h2>{view === "month" ? "이번 달" : "이번 주"} 회차 목록 <span>{filtered.length}</span></h2><span>색상은 학생, 상태는 수업 진행 상황을 나타냅니다.</span></div>
    {filtered.length === 0 ? <div className="calendar-empty-list"><CalendarDays size={23} aria-hidden="true" /><p>{selectedStudent ? `${selectedStudent.name} 학생의` : "이 기간에"} 등록된 수업이 없습니다.</p><button type="button" className={buttonClass("outline", "sm")} onClick={() => open(defaultDate, "")}>일정 추가</button></div> : <TableWrap><Table>
      <thead><tr><Th>수업 일시</Th><Th>학생</Th><Th>방식</Th><Th>상태</Th><Th>알림</Th><Th>관리</Th></tr></thead>
      <tbody>{filtered.map((item) => <tr key={item.id}>
        <Td><button type="button" className="calendar-table-date" onClick={() => open(kstDateOnly(item.scheduledAt) < from ? from : kstDateOnly(item.scheduledAt), undefined, item.id)}>{formatKDateTime(item.scheduledAt)}</button><p className="mt-1 text-xs text-muted">{item.endsAt ? `${durationLabel(Math.round((Date.parse(item.endsAt) - Date.parse(item.scheduledAt)) / 60_000))}` : "종료 시간 미정"}</p></Td>
        <Td><Link className="calendar-table-student" style={studentCalendarStyle(item.studentId)} href={`/admin/students/${item.studentId}`}><span className="calendar-student-dot" />{item.studentName}</Link></Td>
        <Td>{classTypeLabel(item.classType)}</Td>
        <Td><Badge tone={item.attendance ? attendanceTone(item.attendance) : scheduleStatusTone(item.status)}>{item.attendance ? attendanceLabel(item.attendance) : scheduleStatusLabel(item.status)}</Badge></Td>
        <Td><Badge tone={item.reminderSent ? "success" : "soft"}>{item.reminderSent ? "발송" : "미발송"}</Badge></Td>
        <Td><button type="button" className="calendar-text-action" onClick={() => open(kstDateOnly(item.scheduledAt) < from ? from : kstDateOnly(item.scheduledAt), undefined, item.id)}>수업 관리<ArrowUpRight size={13} /></button></Td>
      </tr>)}</tbody>
    </Table></TableWrap>}

    <dialog ref={dialog} className="calendar-dialog" aria-labelledby="calendar-dialog-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <div className="calendar-dialog-header">
        <div><p>{selection?.creating ? "새 수업" : selection?.mode ? "수업 관리" : "하루 일정"}</p><h2 id="calendar-dialog-title">{formatKDate(activeDay)} <span>{new Intl.DateTimeFormat("ko-KR", { weekday: "long", timeZone: "Asia/Seoul" }).format(new Date(`${activeDay}T12:00:00+09:00`))}</span></h2></div>
        <button ref={closeButton} type="button" className="dash-icon-button" aria-label="일정 팝업 닫기" disabled={saving} onClick={close}><X size={20} /></button>
      </div>
      {selection && <div className="calendar-dialog-body" aria-busy={refreshing}>
        {selection.mode && selection.eventId ? <SessionControls key={`${selection.eventId}-${selection.mode}`} id={selection.eventId} initialMode={selection.mode} schedules={schedules}
          detailHref={`/admin/schedules/${selection.eventId}?from=${encodeURIComponent(returnUrl)}`} onBack={() => setSelection({ ...selection, mode: undefined })} onSaved={saved} onPendingChange={setSaving} /> : selection.creating ? <>
          <ScheduleCreateForm key={`${selection.date}-${selection.time}`} students={students} initialStudentId={studentId || schedules.find((item) => item.id === selection.eventId)?.studentId}
            initialDate={selection.date} initialTime={selection.time} lockDate schedules={schedules}
            onCreated={created} onPendingChange={setSaving} onCancel={() => setSelection({ ...selection, creating: false })} />
        </> : <>
          {notice && <div className="calendar-saved" role="status">{notice}{refreshing ? " 캘린더를 갱신하고 있습니다…" : ""}{followDate && <Link href={calendarHref({ view, date: followDate, studentId, day: followDate })} onClick={() => { setSelection({ date: followDate, creating: false }); setNotice(""); }}>변경된 수업 보기<ArrowUpRight size={13} /></Link>}</div>}
          <div className="calendar-agenda-toolbar"><p>{selectedStudent?.name ?? "전체 학생"} · {dayItems.length}건</p><button type="button" className={buttonClass("primary", "sm")} onClick={() => setSelection({ ...selection, time: "", creating: true })}><Plus size={15} />수업 추가</button></div>
          {dayItems.length === 0 && <div className="calendar-day-empty"><CalendarDays size={28} aria-hidden="true" /><h3>등록된 수업이 없습니다</h3><p>위의 수업 추가 버튼으로 이날 일정을 잡아보세요.</p></div>}
          <div className="calendar-agenda">{dayItems.map((item) => <article key={item.id} className="calendar-agenda-item" data-selected={selection.eventId === item.id || undefined} style={studentCalendarStyle(item.studentId)}>
            <div className="calendar-agenda-title"><h3><span className="calendar-student-dot" />{item.studentName}</h3><Badge tone={item.attendance ? attendanceTone(item.attendance) : scheduleStatusTone(item.status)}>{item.attendance ? attendanceLabel(item.attendance) : scheduleStatusLabel(item.status)}</Badge></div>
            <p className="calendar-agenda-time"><Clock3 size={14} />{scheduleTimeLabel(item)}<span>{item.classType === "video" && <Video size={13} />}{classTypeLabel(item.classType)}</span></p>
            {item.conflictReason && <p className="calendar-overlap">{item.conflictReason}</p>}
            <p className="calendar-agenda-meta">알림 {item.reminderSent ? "발송 완료" : "미발송"}{item.deductionState !== "none" && ` · ${deductionLabel(item.deductionState)}`}{item.packageId ? " · 수업 묶음 연결" : ""}</p>
            <div className="calendar-session-actions">
              {!item.attendance && ["planned", "makeup"].includes(item.status) && <><button type="button" className={buttonClass("outline", "sm", "calendar-primary-action")} onClick={() => manage(item, "attendance")}>출결 처리</button><button type="button" className={buttonClass("outline", "sm")} onClick={() => manage(item, "absence")}>결석</button></>}
              {item.attendance && <button type="button" className={buttonClass("outline", "sm")} onClick={() => manage(item, "correction")}>출결 정정</button>}
              {!item.attendance && item.deductionState === "none" && ["planned", "makeup", "conflict"].includes(item.status) && <><button type="button" className="calendar-text-action" onClick={() => manage(item, "change")}>일정 변경·보강</button><button type="button" className="calendar-text-action calendar-danger-text" onClick={() => manage(item, "cancel")}>수업 취소</button></>}
              {item.status === "makeup" && <button type="button" className="calendar-text-action" onClick={() => manage(item, "notify")}>보강 안내</button>}
            </div>
            <div className="calendar-agenda-actions calendar-secondary-actions">
              <Link href={detailHref(item)} onClick={close}>수업 상세<ArrowUpRight size={12} /></Link>
              {item.lessonId && <Link href={`/admin/lessons/${item.lessonId}`} onClick={close}>수업 기록</Link>}
              <Link href={`/admin/students/${item.studentId}`} onClick={close}>학생 정보</Link>
            </div>
          </article>)}</div>
        </>}
      </div>}
      {selection?.creating && <div className="calendar-dialog-footnote"><ArrowLeft size={13} />등록하면 이 날짜의 일정 목록으로 돌아옵니다.</div>}
    </dialog>
  </div>;
}
