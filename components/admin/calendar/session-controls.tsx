"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Check, Clock3, LoaderCircle, Phone, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button";
import { calendarStart, durationLabel, scheduleEnd, scheduleTimeLabel } from "@/lib/admin-calendar";
import { formatKDateTime, kstDateOnly, kstTime } from "@/lib/kst";
import type { Attendance } from "@/lib/types";
import type { ScheduleListItem } from "@/lib/data/crm";
import type { CrmActionResult } from "@/components/admin/crm/types";
import { getCalendarSchedule, type CalendarScheduleDetail } from "@/app/admin/(protected)/schedules/calendar-actions";
import { cancelSchedule, createMakeup, decideCorrection, logAttendanceContact, requestCorrection, resolveScheduleContract, settleAttendance } from "@/app/admin/(protected)/schedules/attendance-actions";
import { sendMakeupNotice } from "@/app/admin/(protected)/schedules/actions";
import { ATTENDANCE_OPTIONS, CONTACT_CHANNEL_OPTIONS, CONTACT_RESULT_OPTIONS, REQUESTER_ROLE_OPTIONS, attendanceLabel, attendanceTone, deductionLabel } from "@/app/admin/(protected)/packages/constants";
import { classTypeLabel } from "@/app/admin/(protected)/schedules/constants";
import { studentCalendarStyle } from "@/components/admin/schedule-calendar";

export type SessionMode = "attendance" | "absence" | "change" | "cancel" | "contact" | "correction" | "review" | "notify";
const TITLES: Record<SessionMode, string> = { attendance: "출결 처리", absence: "결석 처리", change: "일정 변경·보강", cancel: "수업 취소", contact: "미참석 연락 기록", correction: "출결 정정 요청", review: "정정 요청 검토", notify: "보강 안내 발송" };

export function SessionControls({ id, initialMode, schedules, detailHref, onBack, onSaved, onPendingChange }: {
  id: string; initialMode: SessionMode; schedules: ScheduleListItem[]; detailHref: string;
  onBack: () => void; onSaved: (message: string, followDate?: string) => void; onPendingChange: (pending: boolean) => void;
}) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  const [detail, setDetail] = useState<CalendarScheduleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [mode, setMode] = useState(initialMode);
  const [attendance, setAttendance] = useState<Attendance>(initialMode === "absence" ? "absent" : "present");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("60");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [minuteMark, setMinuteMark] = useState("10");
  const [now, setNow] = useState(() => Date.now());
  const [reviewDecision, setReviewDecision] = useState("approve");

  useEffect(() => {
    let active = true;
    getCalendarSchedule(id).then((result) => {
      if (!active) return;
      if (!result.ok) { setError(result.error); setLoading(false); return; }
      setDetail(result.detail);
      setDate(kstDateOnly(result.detail.schedule.scheduledAt));
      setTime(kstTime(result.detail.schedule.scheduledAt));
      setDuration(String(Math.round((scheduleEnd(result.detail.schedule) - Date.parse(result.detail.schedule.scheduledAt)) / 60_000)));
      setMinuteMark(String([10, 20, 30].find((mark) => !result.detail.contacts.some((contact) => contact.minuteMark === mark)) ?? 30));
      if (initialMode === "correction") {
        setAttendance(result.detail.schedule.attendance ?? "present");
        if (result.detail.corrections.some((correction) => correction.status === "pending")) setMode("review");
      }
      setLoading(false);
    }).catch(() => { if (active) { setError("수업 정보를 불러오지 못했습니다. 다시 시도해 주세요."); setLoading(false); } });
    return () => { active = false; };
  }, [id, reload, initialMode]);

  useEffect(() => { heading.current?.focus(); }, [loading, mode]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(timer); }, []);

  function switchMode(next: SessionMode) { setMode(next); setError(""); setNotice(""); }
  if (loading) return <div className="calendar-control-loading" role="status"><LoaderCircle size={18} className="animate-spin" />수업 정보를 불러오고 있습니다.</div>;
  if (!detail) return <div className="calendar-control-error"><p role="alert">{error}</p><button type="button" className={buttonClass("outline", "sm")} onClick={() => { setError(""); setLoading(true); setReload((value) => value + 1); }}>다시 불러오기</button><button type="button" className={buttonClass("ghost", "sm")} onClick={onBack}>하루 일정으로</button></div>;

  const { schedule, contacts, corrections } = detail;
  const open = ["planned", "makeup"].includes(schedule.status) && !schedule.attendance;
  const changeable = ["planned", "makeup", "conflict"].includes(schedule.status) && schedule.deductionState === "none" && !schedule.attendance;
  const canDeduct = !!schedule.packageId && !!schedule.contractId && detail.packageStatus === "active" && !detail.replacement;
  const started = now >= Date.parse(schedule.scheduledAt);
  const noShowReady = now >= Date.parse(schedule.scheduledAt) + 30 * 60_000 && [10, 20, 30].every((mark) => contacts.some((contact) => contact.minuteMark === mark && contact.result === "no_answer" && Date.parse(contact.contactedAt) >= Date.parse(schedule.scheduledAt) + mark * 60_000));
  const pendingCorrection = corrections.find((correction) => correction.status === "pending");
  const start = calendarStart(date, time);
  const durationMin = Number(duration);
  const validDuration = Number.isInteger(durationMin) && durationMin >= 10 && durationMin <= 480 && durationMin % 5 === 0;
  const end = start && validDuration ? new Date(start.getTime() + durationMin * 60_000) : null;
  const overlaps = start && end ? schedules.filter((item) => item.id !== id && ["planned", "done", "makeup"].includes(item.status) && Date.parse(item.scheduledAt) < end.getTime() && scheduleEnd(item) > start.getTime()) : [];
  const ownOverlap = overlaps.some((item) => item.studentId === schedule.studentId);
  const unchanged = start?.getTime() === Date.parse(schedule.scheduledAt) && (!!schedule.packageId || end?.getTime() === scheduleEnd(schedule));
  const attendanceMode = mode === "attendance" || mode === "absence";
  const contactAvailable = !contacts.some((contact) => contact.minuteMark === Number(minuteMark)) && now >= Date.parse(schedule.scheduledAt) + Number(minuteMark) * 60_000;

  const disabled = attendanceMode ? !open || !started || (attendance === "noshow" && !noShowReady)
    : mode === "cancel" ? !changeable
    : mode === "change" ? !changeable || !start || !end || ownOverlap || unchanged
    : mode === "contact" ? !open || !contactAvailable
    : mode === "correction" ? !schedule.attendance || !!pendingCorrection
    : mode === "review" ? !pendingCorrection
    : schedule.status !== "makeup";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || disabled) return;
    const form = new FormData(event.currentTarget);
    setPending(true); onPendingChange(true); setError(""); setNotice("");
    try {
      let result: CrmActionResult;
      if (attendanceMode) { form.set("attendance", attendance); result = await settleAttendance(id, form); }
      else if (mode === "cancel") result = await cancelSchedule(id, form);
      else if (mode === "change") { form.set("scheduledAt", `${date}T${time}`); result = await createMakeup(id, form); }
      else if (mode === "contact") result = await logAttendanceContact(id, form);
      else if (mode === "correction") { form.set("toAttendance", attendance); result = await requestCorrection(id, form); }
      else if (mode === "review" && pendingCorrection) result = await decideCorrection(pendingCorrection.id, form);
      else result = await sendMakeupNotice(id);
      if (!result.ok) { setError(result.error ?? "처리하지 못했습니다. 다시 시도해 주세요."); return; }
      if (mode === "contact") {
        setNotice("연락을 기록했습니다."); setReload((value) => value + 1); router.refresh();
      } else {
        onSaved(attendanceMode ? `${attendanceLabel(attendance)} 처리했습니다.` : mode === "cancel" ? "수업을 취소했습니다."
          : mode === "change" ? "일정을 변경하고 보강 수업을 등록했습니다." : mode === "correction" ? "출결 정정을 요청했습니다."
          : mode === "review" ? `정정 요청을 ${reviewDecision === "approve" ? "승인" : "거절"}했습니다.` : "보강 안내를 발송했습니다.", mode === "change" ? date : undefined);
      }
    } catch { setError("요청을 완료하지 못했습니다. 입력 내용은 유지됩니다. 다시 시도해 주세요."); }
    finally { setPending(false); onPendingChange(false); }
  }

  async function resolveContract() {
    if (pending || detail!.candidates.length !== 1) return;
    setPending(true); onPendingChange(true); setError("");
    try {
      const form = new FormData(); form.set("contractId", detail!.candidates[0].contractId);
      const result = await resolveScheduleContract(id, form);
      if (!result.ok) setError(result.error ?? "계약을 연결하지 못했습니다.");
      else { setReload((value) => value + 1); setNotice("계약을 연결했습니다."); router.refresh(); }
    } catch { setError("계약을 연결하지 못했습니다. 다시 시도해 주세요."); }
    finally { setPending(false); onPendingChange(false); }
  }

  return <section className="calendar-session-controls">
    <div className="calendar-control-back"><button type="button" disabled={pending} onClick={onBack}><ArrowLeft size={14} />하루 일정</button><Link href={detailHref} aria-disabled={pending} tabIndex={pending ? -1 : undefined} onClick={(event) => { if (pending) event.preventDefault(); }}>수업 상세<ArrowUpRight size={13} /></Link></div>
    <div className="calendar-control-summary" style={studentCalendarStyle(schedule.studentId)}>
      <div><h3><span className="calendar-student-dot" />{detail.studentName}</h3><p><Clock3 size={13} />{formatKDateTime(schedule.scheduledAt)} · {classTypeLabel(schedule.classType)}</p></div>
      <Badge tone={attendanceTone(schedule.attendance)}>{schedule.attendance ? attendanceLabel(schedule.attendance) : schedule.status === "canceled" ? "취소" : "출결 미확정"}</Badge>
    </div>
    <p className="calendar-control-package">{detail.packageTitle ?? "수업 묶음 미연결"}{detail.remaining !== null && ` · 잔여 ${detail.remaining}회`}{schedule.deductionState !== "none" && ` · ${deductionLabel(schedule.deductionState)}`}</p>
    <nav className="calendar-control-tabs" aria-label="수업 처리">
      {open && <button type="button" disabled={pending} aria-current={attendanceMode ? "page" : undefined} onClick={() => switchMode("attendance")}>출결</button>}
      {changeable && <><button type="button" disabled={pending} aria-current={mode === "change" ? "page" : undefined} onClick={() => switchMode("change")}>일정 변경·보강</button><button type="button" disabled={pending} aria-current={mode === "cancel" ? "page" : undefined} onClick={() => switchMode("cancel")}>취소</button></>}
      {(open || contacts.length > 0) && <button type="button" disabled={pending} aria-current={mode === "contact" ? "page" : undefined} onClick={() => switchMode("contact")}>연락 기록</button>}
      {schedule.attendance && <button type="button" disabled={pending} aria-current={mode === "correction" || mode === "review" ? "page" : undefined} onClick={() => switchMode(pendingCorrection ? "review" : "correction")}>출결 정정{pendingCorrection ? " · 대기" : ""}</button>}
      {schedule.status === "makeup" && <button type="button" disabled={pending} aria-current={mode === "notify" ? "page" : undefined} onClick={() => switchMode("notify")}>보강 안내</button>}
    </nav>
    <h4 ref={heading} tabIndex={-1} className="calendar-control-title">{TITLES[mode]}</h4>
    {notice && <p className="calendar-saved" role="status">{notice}</p>}
    {!schedule.contractId && detail.candidates.length > 0 && <div className="calendar-overlap"><p>계약을 연결해야 회차를 차감할 수 있습니다.</p>{detail.candidates.length === 1 ? <button type="button" className={buttonClass("outline", "sm")} disabled={pending} onClick={resolveContract}>유효 계약 연결</button> : <Link href={detailHref}>수업 상세에서 계약 확인</Link>}</div>}
    <form onSubmit={submit}>
      <fieldset disabled={pending} className="calendar-control-fields" key={mode}>
        {(attendanceMode || mode === "correction") && <>
          {attendanceMode && !started && <p className="calendar-control-note">수업 시작 후 출결을 확정할 수 있습니다. 사전 변경은 일정 변경·보강 또는 취소를 이용하세요.</p>}
          {attendanceMode && !open && <p className="calendar-control-note">이미 종료된 수업입니다.{schedule.attendance && " 출결 정정에서 변경을 요청할 수 있습니다."}</p>}
          <fieldset className="calendar-attendance-options"><legend>출결 선택</legend>{ATTENDANCE_OPTIONS.map((option) => <label key={option.value} data-checked={attendance === option.value || undefined}>
            <input type="radio" name="attendanceChoice" value={option.value} checked={attendance === option.value} onChange={() => setAttendance(option.value)} />
            <span>{option.value === "present" ? <Check size={15} /> : option.value === "absent" ? <X size={15} /> : null}{option.label}</span>
          </label>)}</fieldset>
          {attendanceMode && attendance === "late" && <Field label="실제 시작 시각" required><Input name="actualStartedAt" type="datetime-local" required defaultValue={`${kstDateOnly(schedule.scheduledAt)}T${kstTime(schedule.scheduledAt)}`} /></Field>}
          {attendanceMode && attendance === "early_leave" && <Field label="실제 종료 시각" required><Input name="actualEndedAt" type="datetime-local" required defaultValue={`${kstDateOnly(new Date(scheduleEnd(schedule)))}T${kstTime(new Date(scheduleEnd(schedule)))}`} /></Field>}
          {attendanceMode && attendance === "noshow" && <div className="calendar-control-note"><p>10·20·30분 연락이 모두 무응답이고, 수업 시작 30분이 지나야 확정할 수 있습니다.</p><button type="button" className="calendar-text-action" onClick={() => switchMode("contact")}><Phone size={13} />연락 기록 확인 ({contacts.length}/3)</button></div>}
          {mode === "correction" && <><p className="calendar-control-note">현재 {attendanceLabel(schedule.attendance)} · {deductionLabel(schedule.deductionState)}. 요청을 승인하면 출결과 차감이 반영됩니다.</p><div className="grid gap-4 sm:grid-cols-2"><Field label="요청 주체"><Select name="requesterRole" defaultValue="operator">{REQUESTER_ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field><Field label="요청자" hint="비우면 로그인 계정"><Input name="requestedBy" maxLength={80} /></Field></div></>}
          <Field label={mode === "correction" ? "정정 사유" : "출결 메모"} required={mode === "correction"}><Textarea name="reason" rows={2} maxLength={mode === "correction" ? 500 : 200} required={mode === "correction"} placeholder={mode === "correction" ? "변경이 필요한 이유를 적어주세요" : "결석 사유나 수업 중 참고할 내용 (선택)"} /></Field>
          <label className="calendar-deduct-choice"><input type="checkbox" name={mode === "correction" ? "toDeduct" : "deduct"} disabled={!canDeduct} defaultChecked={canDeduct && (mode === "correction" ? schedule.deductionState === "deducted" : true)} /><span>{mode === "correction" ? "정정 후 회차 차감" : "회차 차감"}<small>{canDeduct ? "선택하면 잔여 회차에서 1회 차감합니다." : "연결된 활성 수업 묶음·계약이 없어 차감할 수 없습니다."}</small></span></label>
          {attendanceMode && <p className="calendar-form-hint">확정 후 변경은 출결 정정으로 처리합니다.</p>}
        </>}
        {mode === "cancel" && <>
          <p className="calendar-control-note">이 수업을 취소하고 캘린더에 취소 이력을 남깁니다.</p>
          <Field label="취소 사유" required><Textarea name="reason" rows={3} required maxLength={300} placeholder="예: 학생 요청으로 이번 수업 취소" /></Field>
          <label className="calendar-deduct-choice"><input type="checkbox" name="deduct" disabled={!canDeduct} /><span>취소 수업 회차 차감<small>{canDeduct ? "체크하지 않으면 잔여 회차를 유지합니다." : "잔여 회차 차감 없이 취소합니다."}</small></span></label>
        </>}
        {mode === "change" && <>
          <p className="calendar-control-note">원래 수업은 차감 없이 취소하고, 선택한 일시에 보강을 등록합니다. 학생·수업 방식·수업 묶음은 그대로 이어집니다.</p>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="변경 날짜" required><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></Field><Field label="변경 시간" required><Input type="time" value={time} onChange={(event) => setTime(event.target.value)} required /></Field></div>
          <Field label="수업 길이(분)" required><Input name="durationMin" type="number" min={10} max={480} step={5} value={duration} onChange={(event) => setDuration(event.target.value)} required /></Field>
          {start && end && <p className="calendar-form-hint">{durationLabel(Number(duration))} · {scheduleTimeLabel({ scheduledAt: start.toISOString(), endsAt: end.toISOString() })}</p>}
          {overlaps.length > 0 && <p className="calendar-overlap">{ownOverlap ? "이 학생의 다른 수업과 시간이 겹칩니다." : "같은 시간에 다른 학생의 수업이 있습니다."} {overlaps.map((item) => `${kstTime(item.scheduledAt)} ${item.studentName}`).join(", ")}</p>}
          <Field label="변경·보강 사유" required><Textarea name="reason" rows={2} required maxLength={200} placeholder="변경 사유를 적어주세요" /></Field>
          {unchanged && <p className="calendar-form-hint">새 날짜나 시간을 선택해 주세요.</p>}
        </>}
        {mode === "contact" && <>
          <p className="calendar-control-note">실제 연락한 결과를 기록하세요. 각 시점의 기록은 한 번만 남길 수 있습니다.</p>
          <ol className="calendar-contact-timeline">{([10, 20, 30] as const).map((mark) => {
            const contact = contacts.find((item) => item.minuteMark === mark);
            return <li key={mark} data-recorded={!!contact}><strong>{mark}분</strong><span>{contact ? CONTACT_RESULT_OPTIONS.find((option) => option.value === contact.result)?.label : "미기록"}<small>{contact ? `${CONTACT_CHANNEL_OPTIONS.find((option) => option.value === contact.channel)?.label} · ${formatKDateTime(contact.contactedAt)}` : `${kstTime(new Date(Date.parse(schedule.scheduledAt) + mark * 60_000))}부터 기록 가능`}</small></span>{contact && <Check size={14} />}</li>;
          })}</ol>
          {open && contacts.length < 3 && <div className="grid gap-4 sm:grid-cols-3"><Field label="연락 시점"><Select name="minuteMark" value={minuteMark} onChange={(event) => setMinuteMark(event.target.value)}>{[10, 20, 30].map((mark) => <option key={mark} value={mark} disabled={contacts.some((contact) => contact.minuteMark === mark) || now < Date.parse(schedule.scheduledAt) + mark * 60_000}>{mark}분</option>)}</Select></Field><Field label="연락 경로"><Select name="channel" defaultValue="call">{CONTACT_CHANNEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field><Field label="연락 결과"><Select name="result" defaultValue="no_answer">{CONTACT_RESULT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field></div>}
          {open && <button type="button" className="calendar-text-action" onClick={() => { setAttendance("noshow"); switchMode("attendance"); }}>노쇼 출결 처리로 이동<ArrowUpRight size={13} /></button>}
        </>}
        {mode === "review" && (pendingCorrection ? <>
          <div className="calendar-control-note"><strong>{attendanceLabel(schedule.attendance)} → {attendanceLabel(pendingCorrection.toAttendance)} · {pendingCorrection.toDeduct ? "차감" : "무차감"}</strong><p>{pendingCorrection.reason}</p><p>{pendingCorrection.requestedBy} · {formatKDateTime(pendingCorrection.createdAt)}</p></div>
          <Field label="처리 결과"><Select name="decision" value={reviewDecision} onChange={(event) => setReviewDecision(event.target.value)}><option value="approve">승인</option><option value="reject">거절</option></Select></Field>
          <Field label="처리 사유" required={reviewDecision === "reject"}><Textarea name="decisionReason" rows={2} required={reviewDecision === "reject"} maxLength={500} /></Field>
          <p className="calendar-form-hint">승인하면 기존 기록을 보존하고 출결·잔여 회차를 정정합니다.</p>
        </> : <p className="calendar-control-note">검토할 정정 요청이 없습니다.</p>)}
        {mode === "notify" && <p className="calendar-control-note">{detail.studentName} 학생의 학부모에게 {formatKDateTime(schedule.scheduledAt)} 보강 수업 안내를 발송합니다.</p>}
      </fieldset>
      {error && <p className="calendar-control-error" role="alert">{error}</p>}
      <div className="calendar-form-actions"><button type="button" className={buttonClass("outline", "sm")} disabled={pending} onClick={onBack}>돌아가기</button>
        {!(mode === "contact" && (!open || contacts.length === 3)) && <button type="submit" disabled={pending || disabled} className={buttonClass("primary", "sm", mode === "cancel" ? "calendar-danger-button" : undefined)}>{pending ? "처리 중…" : attendanceMode ? `${attendanceLabel(attendance)} 확정` : mode === "cancel" ? "수업 취소 확정" : mode === "change" ? "변경·보강 등록" : mode === "contact" ? "연락 기록 저장" : mode === "correction" ? "정정 요청" : mode === "review" ? `정정 ${reviewDecision === "approve" ? "승인" : "거절"}` : "학부모에게 안내 발송"}</button>}
      </div>
    </form>
  </section>;
}
