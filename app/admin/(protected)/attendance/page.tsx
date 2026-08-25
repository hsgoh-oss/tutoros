import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { formatKDate, formatKDateTime, hasDb } from "@/lib/data/crm";
import {
  listBookingRestrictions,
  listPendingCorrections,
  listUnresolvedSchedules,
} from "@/lib/data/packages";
import { listWorkItemsByKind, type WorkItem } from "@/lib/data/work";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import {
  decideCorrection,
  dismissBookingRisk,
  liftBookingRestriction,
  restrictBooking,
} from "../schedules/attendance-actions";
import { attendanceLabel } from "../packages/constants";

// 출결·정정 업무 화면 (L-06 · L-08 · L-10).
//
// 세 가지 열린 일이 한 화면에 모인다: ①심사 대기 정정 ②귀속 미확정 회차 ③예약 위험 검토·제한.
// 셋 다 "사람이 판단해야 끝나는 일"이고, 어느 것도 시간이 지난다고 자동으로 해소되지 않는다.
// 특히 예약 제한은 자동으로 걸리지도, 자동으로 풀리지도 않는다(L-08 "자동 제한 금지").

export default async function AttendancePage() {
  const session = await getAdminSession();
  const connected = hasDb();

  const corrections = session ? await listPendingCorrections(session.tenantId) : [];
  const unresolved = session ? await listUnresolvedSchedules(session.tenantId) : [];
  const restrictions = session ? await listBookingRestrictions(session.tenantId) : [];
  const riskItems: WorkItem[] = session
    ? await listWorkItemsByKind(session.tenantId, "booking_risk_review")
    : [];

  const activeRestrictions = restrictions.filter((r) => r.status === "active");
  const today = new Date().toISOString().slice(0, 10);
  const dueForReview = activeRestrictions.filter((r) => r.reviewOn <= today);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-black tracking-tight">출결·정정</h1>
        <p className="mt-1 text-sm text-muted">
          사람이 판단해야 끝나는 일만 모았습니다. 정정은 원 기록을 덮어쓰지 않고 조정 이력을 쌓으며,
          예약 제한은 자동으로 걸리거나 풀리지 않습니다.
        </p>
      </div>

      {!connected && <DbBanner />}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs font-bold text-muted">심사 대기 정정</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-amber-600">
            {corrections.length}
          </p>
          <p className="mt-1 text-xs text-muted">승인 시 잔액이 다시 계산됩니다</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-muted">귀속 미확정 회차</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-rose-600">
            {unresolved.length}
          </p>
          <p className="mt-1 text-xs text-muted">잔액·환불 계산에서 제외 중</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-muted">예약 위험 검토</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-orange-600">
            {riskItems.length}
          </p>
          <p className="mt-1 text-xs text-muted">반복 노쇼 누적 — 판단 대기</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-muted">활성 예약 제한</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-ink">
            {activeRestrictions.length}
          </p>
          <p className="mt-1 text-xs text-muted">
            {dueForReview.length > 0
              ? `재검토일 도달 ${dueForReview.length}건`
              : "재검토일까지 유지"}
          </p>
        </Card>
      </div>

      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-black text-ink-soft">심사 대기 정정 (L-06)</h2>
        {corrections.length === 0 ? (
          <p className="text-sm text-muted">심사할 정정 요청이 없습니다.</p>
        ) : (
          <div className="space-y-4">
            {corrections.map((c) => (
              <div key={c.id} className="rounded-lg border border-line p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <Link
                    href={`/admin/schedules/${c.scheduleId}`}
                    className="font-bold text-ink hover:text-brand-600"
                  >
                    {c.studentName ?? "알 수 없음"}
                  </Link>
                  <span className="text-muted">
                    {c.scheduledAt ? formatKDateTime(c.scheduledAt) : "회차 시각 불명"}
                  </span>
                  <Badge tone="soft">
                    {attendanceLabel(c.fromAttendance)} → {attendanceLabel(c.toAttendance)}
                  </Badge>
                  {c.toDeduct && <Badge tone="danger">정정 후 차감</Badge>}
                </div>
                <p className="mb-3 text-sm">
                  <span className="text-muted">요청 사유 · </span>
                  {c.reason}
                  <span className="ml-2 text-xs text-muted">
                    ({c.requestedBy} · {formatKDateTime(c.createdAt)})
                  </span>
                </p>
                <SubmitForm action={decideCorrection.bind(null, c.id)} submitLabel="처리">
                  <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
                    <Field label="판정" required>
                      <div className="flex gap-3 pt-2 text-sm">
                        <label className="flex items-center gap-1">
                          <input
                            type="radio"
                            name="decision"
                            value="approve"
                            defaultChecked
                            className="accent-brand-600"
                          />
                          승인
                        </label>
                        <label className="flex items-center gap-1">
                          <input
                            type="radio"
                            name="decision"
                            value="reject"
                            className="accent-brand-600"
                          />
                          거절
                        </label>
                      </div>
                    </Field>
                    <Field label="판정 사유" hint="거절 시 필수">
                      <Input name="decisionReason" maxLength={300} />
                    </Field>
                  </div>
                </SubmitForm>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-black text-ink-soft">귀속 미확정 회차 (L-10)</h2>
        <p className="mb-3 text-sm text-muted">
          적용 계약이 확정되지 않은 회차입니다. 확정 전까지 잔액·환불·매출·보고서 계산에서
          확정 사실처럼 쓰이지 않습니다. 각 회차에서 유효 계약 후보를 확인해 확정하세요.
        </p>
        {unresolved.length === 0 ? (
          <p className="text-sm text-muted">모든 회차의 계약 귀속이 확정돼 있습니다.</p>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>학생</Th>
                  <Th>회차</Th>
                  <Th>종류</Th>
                  <Th>처리</Th>
                </tr>
              </thead>
              <tbody>
                {unresolved.map((s) => (
                  <tr key={s.id}>
                    <Td className="font-bold">{s.studentName}</Td>
                    <Td className="text-xs">{formatKDateTime(s.scheduledAt)}</Td>
                    <Td className="text-xs text-muted">
                      {s.originScheduleId ? "보강(파생) — 원 회차 먼저" : "일반"}
                    </Td>
                    <Td>
                      <Link
                        href={`/admin/schedules/${s.id}`}
                        className="text-sm font-bold text-brand-600 hover:underline"
                      >
                        후보 확인
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-black text-ink-soft">예약 위험 검토 (L-08)</h2>
        <p className="mb-3 text-sm text-muted">
          반복 노쇼가 누적되면 검토 업무만 생깁니다 — 제한은 자동으로 걸리지 않습니다. 원 출결·정정·
          연락 이력을 확인한 뒤 제한 없음 / 위험 확정 중 하나로 판단하세요. 제한은 새 예약·추가 자리
          제안에만 적용되며 기존 확정 수업·학습기록·정산 접근을 취소하지 않습니다.
        </p>
        {riskItems.length === 0 ? (
          <p className="text-sm text-muted">검토할 예약 위험이 없습니다.</p>
        ) : (
          <div className="space-y-4">
            {riskItems.map((w) => (
              <div key={w.id} className="rounded-lg border border-line p-4">
                <p className="mb-1 text-sm font-bold">{w.title}</p>
                <p className="mb-3 text-xs text-muted">{w.detail}</p>
                <div className="grid gap-4 lg:grid-cols-2">
                  <SubmitForm
                    action={restrictBooking.bind(null, w.sourceId ?? "")}
                    submitLabel="위험 확정 — 신규 예약 제한"
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="재검토일" required>
                        <Input name="reviewOn" type="date" required />
                      </Field>
                      <Field label="사유" required>
                        <Input name="reason" required maxLength={300} />
                      </Field>
                    </div>
                  </SubmitForm>
                  <SubmitForm
                    action={dismissBookingRisk.bind(null, w.sourceId ?? "")}
                    submitLabel="제한 없음으로 종결"
                  >
                    <Field label="판단 사유" required>
                      <Input name="reason" required maxLength={300} />
                    </Field>
                  </SubmitForm>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-black text-ink-soft">예약 제한 이력</h2>
        {restrictions.length === 0 ? (
          <EmptyState title="예약 제한이 없습니다" description="제한은 운영자 판단으로만 생깁니다." />
        ) : (
          <div className="space-y-4">
            {restrictions.map((r) => (
              <div key={r.id} className="rounded-lg border border-line p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold">{r.studentName ?? "알 수 없음"}</span>
                  <Badge tone={r.status === "active" ? "danger" : "soft"}>
                    {r.status === "active" ? "제한 중" : "해제됨"}
                  </Badge>
                  <span className="text-xs text-muted">
                    재검토일 {formatKDate(r.reviewOn)}
                    {r.status === "active" && r.reviewOn <= today && (
                      <strong className="ml-1 text-rose-600">도달 — 확인 필요</strong>
                    )}
                  </span>
                </div>
                <p className="text-sm">
                  <span className="text-muted">사유 · </span>
                  {r.reason}
                </p>
                {r.liftReason && (
                  <p className="mt-1 text-xs text-muted">해제 사유 · {r.liftReason}</p>
                )}
                {r.status === "active" && (
                  <div className="mt-3">
                    <SubmitForm
                      action={liftBookingRestriction.bind(null, r.id)}
                      submitLabel="제한 해제"
                    >
                      <Field label="해제 사유" required hint="이의 처리 결과·재검토 판단">
                        <Textarea name="reason" required rows={2} maxLength={300} />
                      </Field>
                    </SubmitForm>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
