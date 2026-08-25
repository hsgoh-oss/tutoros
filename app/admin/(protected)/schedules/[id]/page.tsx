import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { formatKDateTime } from "@/lib/data/crm";
import { getScheduleDetail, listContractCandidates } from "@/lib/data/packages";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import {
  cancelSchedule,
  createMakeup,
  logAttendanceContact,
  requestCorrection,
  resolveScheduleContract,
  settleAttendance,
} from "../attendance-actions";
import { scheduleStatusLabel, scheduleStatusTone } from "../constants";
import {
  ATTENDANCE_OPTIONS,
  CONTACT_CHANNEL_OPTIONS,
  CONTACT_RESULT_OPTIONS,
  REQUESTER_ROLE_OPTIONS,
  attendanceLabel,
  attendanceTone,
  deductionLabel,
} from "../../packages/constants";

// 회차 상세 (L-03 · L-04 · L-05 · L-06 · L-10) — 한 회차에서 일어나는 모든 판정이 여기 모인다.
//
// 화면 순서가 정본의 순서다: 출결 확정 → (미참석이면) 연락 타임라인 → 변경·취소·보강 →
// 정정 요청 → 계약 귀속. 확정된 뒤에 보이는 것은 정정 경로뿐이다 — 확정을 덮어쓰는 버튼은 없다.

export default async function ScheduleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAdminSession();
  if (!session) notFound();

  const detail = await getScheduleDetail(session.tenantId, id);
  if (!detail) notFound();
  const { schedule, studentName, contacts, corrections, packageTitle, remaining } = detail;

  const settled = schedule.attendance !== null;
  const closed = schedule.status === "canceled" || schedule.status === "done";
  const pendingCorrection = corrections.find((c) => c.status === "pending") ?? null;
  const candidates = schedule.contractId
    ? []
    : await listContractCandidates(session.tenantId, id);

  const settleAction = settleAttendance.bind(null, id);
  const cancelAction = cancelSchedule.bind(null, id);
  const makeupAction = createMakeup.bind(null, id);
  const contactAction = logAttendanceContact.bind(null, id);
  const correctionAction = requestCorrection.bind(null, id);
  const resolveAction = resolveScheduleContract.bind(null, id);

  const noAnswerCount = contacts.filter((c) => c.result === "no_answer").length;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-black tracking-tight">
            {studentName} · {formatKDateTime(schedule.scheduledAt)}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {packageTitle ? `${packageTitle} · ` : ""}
            {remaining === null ? "묶음 미연결" : `남은 회차 ${remaining}`}
            {schedule.originScheduleId && (
              <>
                {" · "}
                <Link
                  href={`/admin/schedules/${schedule.originScheduleId}`}
                  className="underline"
                >
                  원 회차 보기
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={scheduleStatusTone(schedule.status)}>
            {scheduleStatusLabel(schedule.status)}
          </Badge>
          <Badge tone={attendanceTone(schedule.attendance)}>
            {attendanceLabel(schedule.attendance)}
          </Badge>
          <Link href="/admin/schedules" className={buttonClass("ghost", "sm")}>
            일정
          </Link>
        </div>
      </div>

      {schedule.status === "conflict" && (
        <Card className="mb-6 border-orange-200 bg-orange-50/40">
          <h2 className="text-sm font-black text-orange-800">충돌 회차 — 아직 확정되지 않았습니다</h2>
          <p className="mt-1 text-sm text-orange-900">
            {schedule.conflictReason ?? "기존 일정과 겹칩니다."} 재협의 후 아래에서 취소하거나, 새
            시각으로 보강을 만들어 대체하세요.
          </p>
        </Card>
      )}

      {!schedule.contractId && (
        <Card className="mb-6 border-rose-200 bg-rose-50/40">
          <h2 className="text-sm font-black text-rose-800">계약 귀속 미확정 (L-10)</h2>
          <p className="mt-1 mb-3 text-sm text-rose-900">
            이 회차는 잔액·환불·매출 계산에 확정 사실처럼 쓰이지 않으며 차감도 되지 않습니다.
            {candidates.length === 0 &&
              " 회차 시각을 포함하는 동의된 계약이 없습니다 — 등록 기간·계약을 먼저 정정하세요."}
            {candidates.length > 1 &&
              " 유효 계약 후보가 둘 이상입니다 — 계약 원장·기간을 먼저 정정하세요."}
          </p>
          {candidates.length === 1 && (
            <SubmitForm action={resolveAction} submitLabel="귀속 확정">
              <Field label="유효 계약 후보" required>
                <Select name="contractId" required defaultValue={candidates[0].contractId}>
                  {candidates.map((c) => (
                    <option key={c.contractId} value={c.contractId}>
                      {formatKDateTime(c.agreedAt)} 동의
                    </option>
                  ))}
                </Select>
              </Field>
            </SubmitForm>
          )}
        </Card>
      )}

      {!settled && !closed && (
        <Card className="mb-6">
          <h2 className="text-sm font-black text-ink-soft">출결 확정</h2>
          <p className="mt-1 mb-3 text-sm text-muted">
            회차당 한 번만 확정됩니다. 바꾸려면 아래 <strong>정정 요청</strong>을 거쳐야 합니다 —
            확정을 덮어쓰는 경로는 없습니다.
            {!schedule.contractId && " 계약 귀속이 미확정이라 차감은 선택할 수 없습니다."}
          </p>
          <SubmitForm action={settleAction} submitLabel="출결 확정">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="출결" required>
                <Select name="attendance" required defaultValue="present">
                  {ATTENDANCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label} — {o.hint}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="메모" hint="차감 판정의 근거 (선택)">
                <Input name="reason" maxLength={200} />
              </Field>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="deduct"
                className="accent-brand-600"
                defaultChecked={Boolean(schedule.contractId)}
                disabled={!schedule.contractId}
              />
              회차 차감 (잔액 −1)
            </label>
          </SubmitForm>
        </Card>
      )}

      {!settled && !closed && (
        <Card className="mb-6">
          <h2 className="text-sm font-black text-ink-soft">
            미참석 연락 기록 (L-04) · 무응답 {noAnswerCount}/3
          </h2>
          <p className="mt-1 mb-3 text-sm text-muted">
            노쇼는 10·20·30분 연락이 모두 무응답이고 수업 시작 30분이 지나야 확정할 수 있습니다.
            기록에는 시각·경로·결과만 남으며 수정·삭제할 수 없습니다.
          </p>
          {contacts.length > 0 && (
            <TableWrap className="mb-4">
              <Table>
                <thead>
                  <tr>
                    <Th>시점</Th>
                    <Th>경로</Th>
                    <Th>결과</Th>
                    <Th>시각</Th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => (
                    <tr key={c.id}>
                      <Td>{c.minuteMark}분</Td>
                      <Td className="text-xs">
                        {CONTACT_CHANNEL_OPTIONS.find((o) => o.value === c.channel)?.label}
                      </Td>
                      <Td>
                        <Badge tone={c.result === "no_answer" ? "danger" : "success"}>
                          {CONTACT_RESULT_OPTIONS.find((o) => o.value === c.result)?.label}
                        </Badge>
                      </Td>
                      <Td className="text-xs text-muted">{formatKDateTime(c.contactedAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
          <SubmitForm action={contactAction} submitLabel="연락 기록">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="시점" required>
                <Select name="minuteMark" required defaultValue="10">
                  {[10, 20, 30].map((m) => (
                    <option key={m} value={m} disabled={contacts.some((c) => c.minuteMark === m)}>
                      {m}분
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="경로" required>
                <Select name="channel" required defaultValue="call">
                  {CONTACT_CHANNEL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="결과" required>
                <Select name="result" required defaultValue="no_answer">
                  {CONTACT_RESULT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </SubmitForm>
        </Card>
      )}

      {!closed && (
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="text-sm font-black text-ink-soft">회차 취소 (L-05)</h2>
            <p className="mt-1 mb-3 text-sm text-muted">
              차감 여부가 곧 정책 판정 결과입니다. 활성 보강이 달린 회차는 차감 취소할 수 없습니다 —
              원 회차와 대체 회차를 동시에 차감하지 않습니다.
            </p>
            <SubmitForm action={cancelAction} submitLabel="회차 취소">
              <Field label="사유" required>
                <Textarea name="reason" required rows={2} maxLength={300} />
              </Field>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="deduct"
                  className="accent-brand-600"
                  disabled={!schedule.contractId}
                />
                회차 차감 (차감 변경·취소 판정)
              </label>
            </SubmitForm>
          </Card>

          <Card>
            <h2 className="text-sm font-black text-ink-soft">보강 만들기 (L-05)</h2>
            <p className="mt-1 mb-3 text-sm text-muted">
              원 회차를 <strong>무차감</strong>으로 닫고 대체 회차를 만듭니다. 차감은 대체 회차에서
              일어나며, 원 회차당 활성 보강은 하나뿐입니다. 겹치는 시각이면 만들지 않습니다.
            </p>
            <SubmitForm action={makeupAction} submitLabel="보강 생성">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="보강 일시" required>
                  <Input name="scheduledAt" type="datetime-local" required />
                </Field>
                <Field label="수업 길이(분)" required>
                  <Input name="durationMin" type="number" min={10} max={480} step={5} defaultValue={60} required />
                </Field>
              </div>
              <Field label="사유" required>
                <Input name="reason" required maxLength={200} />
              </Field>
            </SubmitForm>
          </Card>
        </div>
      )}

      {settled && (
        <Card className="mb-6">
          <h2 className="text-sm font-black text-ink-soft">출결 정정 요청 (L-06)</h2>
          <p className="mt-1 mb-3 text-sm text-muted">
            확정된 출결은 <strong>{attendanceLabel(schedule.attendance)}</strong> ·{" "}
            {deductionLabel(schedule.deductionState)}입니다. 원 기록은 그대로 두고 정정 요청을
            남깁니다 — 승인되면 조정 이력이 원장에 쌓이고 잔액이 다시 계산됩니다.
            {pendingCorrection && " 이미 심사 중인 요청이 있어 새로 접수할 수 없습니다."}
          </p>
          {!pendingCorrection && (
            <SubmitForm action={correctionAction} submitLabel="정정 요청">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="요청 주체" required>
                  <Select name="requesterRole" required defaultValue="operator">
                    {REQUESTER_ROLE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="요청자" hint="이름·연락처 등 (비우면 로그인 계정)">
                  <Input name="requestedBy" maxLength={80} />
                </Field>
                <Field label="정정할 출결" required>
                  <Select name="toAttendance" required defaultValue={schedule.attendance ?? "present"}>
                    {ATTENDANCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="사유" required>
                <Textarea name="reason" required rows={2} maxLength={500} />
              </Field>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" name="toDeduct" className="accent-brand-600" />
                정정 후 회차 차감
              </label>
            </SubmitForm>
          )}
        </Card>
      )}

      {corrections.length > 0 && (
        <Card>
          <h2 className="mb-3 text-sm font-black text-ink-soft">정정 이력</h2>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>요청</Th>
                  <Th>변경</Th>
                  <Th>상태</Th>
                  <Th>사유·판정</Th>
                </tr>
              </thead>
              <tbody>
                {corrections.map((c) => (
                  <tr key={c.id}>
                    <Td className="text-xs">
                      {REQUESTER_ROLE_OPTIONS.find((o) => o.value === c.requesterRole)?.label} ·{" "}
                      {c.requestedBy}
                      <span className="block text-muted">{formatKDateTime(c.createdAt)}</span>
                    </Td>
                    <Td className="text-xs">
                      {attendanceLabel(c.fromAttendance)} → {attendanceLabel(c.toAttendance)}
                      {c.toDeduct && <span className="block text-muted">차감</span>}
                    </Td>
                    <Td>
                      <Badge
                        tone={
                          c.status === "approved"
                            ? "success"
                            : c.status === "rejected"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {c.status === "approved" ? "승인" : c.status === "rejected" ? "거절" : "심사 중"}
                      </Badge>
                    </Td>
                    <Td className="text-xs">
                      {c.reason}
                      {c.decisionReason && (
                        <span className="block text-muted">판정: {c.decisionReason}</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}
    </div>
  );
}
