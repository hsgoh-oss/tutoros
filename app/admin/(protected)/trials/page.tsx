import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { formatKDateTime, hasDb, listConsultations } from "@/lib/data/crm";
import { listTrialSessions } from "@/lib/data/intake";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Select } from "@/components/ui/form";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import { FilterChips } from "@/components/admin/crm/filter-chips";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { consultationStatusLabel } from "../consultations/constants";
import { createTrialSession } from "./actions";
import {
  isTrialStatus,
  TRIAL_GATE_PENDING_LABEL,
  TRIAL_STATUS_OPTIONS,
  trialResultLabel,
  trialResultTone,
  trialStatusLabel,
  trialStatusTone,
} from "./constants";

// 시범수업 목록 — 상태 필터 + "확정까지 무엇이 남았는지" 배지(T-02 · 검수 8·9).
// 정본: docs/flow-canon/01_atlas_01_intake.md T-02~T-04.
//
// 확정 대기는 한 덩어리가 아니라 둘이다 — "일정만 합의(결제 대기)"와 "결제만 확인(일정 확정
// 대기)"은 각각 다른 운영 업무라서, 상태 하나로 뭉치지 않고 남은 게이트를 그대로 보여준다.

/** 새 회차를 제안할 상담 후보 — 이미 등록으로 넘어간 상담은 시범 대상이 아니다. */
const CONSULTATION_PICK_LIMIT = 100;

export default async function TrialsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const session = await getAdminSession();
  const connected = hasDb();

  const [sessions, consultations] = session
    ? await Promise.all([
        listTrialSessions(session.tenantId, {
          status: isTrialStatus(status) ? status : undefined,
        }),
        listConsultations(session.tenantId),
      ])
    : [[], []];

  const candidates = consultations
    .filter((c) => c.status !== "registered")
    .slice(0, CONSULTATION_PICK_LIMIT);

  // 오늘 처리할 업무 = 확정되지 않은 회차. 게이트별로 몇 건이 걸려 있는지 먼저 보여준다.
  const pending = sessions.filter((s) => s.status === "proposed");
  const waitingSchedule = pending.filter((s) => s.pendingGates.includes("schedule")).length;
  const waitingPayment = pending.filter((s) => s.pendingGates.includes("payment")).length;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">시범수업 관리</h1>
        <p className="mt-1 text-sm text-muted">
          시범 회차의 일정 합의·결제 확인·확정과 변경·취소·노쇼, 그리고 시범 결과를 기록합니다.
          일정과 결제가 모두 갖춰졌을 때만 확정됩니다.
        </p>
      </div>

      {!connected && <DbBanner />}

      {pending.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          <Badge tone="brand">확정 대기 {pending.length}건</Badge>
          {waitingSchedule > 0 && <Badge tone="warning">일정 미정 {waitingSchedule}건</Badge>}
          {waitingPayment > 0 && <Badge tone="warning">결제 미확인 {waitingPayment}건</Badge>}
        </div>
      )}

      <div className="mb-6">
        <FilterChips
          basePath="/admin/trials"
          paramKey="status"
          options={TRIAL_STATUS_OPTIONS}
          current={status}
        />
      </div>

      {sessions.length === 0 ? (
        <EmptyState
          title="시범 회차가 없습니다"
          description="상담 결과가 시범수업이면 아래에서 회차를 제안하고 일정·결제를 확인해 확정하세요."
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>신청자</Th>
                <Th>시범 일시</Th>
                <Th>비용</Th>
                <Th>상태</Th>
                <Th>확정까지 남은 것</Th>
                <Th>현재 결과</Th>
                <Th className="text-right">관리</Th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((item) => (
                <tr key={item.id}>
                  <Td>
                    <span className="font-bold">{item.consultationName ?? "상담 정보 없음"}</span>
                    {item.consultationPhone && (
                      <span className="ml-2 text-xs text-muted">{item.consultationPhone}</span>
                    )}
                  </Td>
                  <Td className="text-sm">
                    {item.scheduledAt ? formatKDateTime(item.scheduledAt) : "미정"}
                  </Td>
                  <Td className="text-sm">{item.isPaid ? "유료" : "무료"}</Td>
                  <Td>
                    <Badge tone={trialStatusTone(item.status)}>
                      {trialStatusLabel(item.status)}
                    </Badge>
                  </Td>
                  <Td>
                    {item.status !== "proposed" ? (
                      <span className="text-xs text-muted">-</span>
                    ) : item.pendingGates.length === 0 ? (
                      <Badge tone="success">확정 가능</Badge>
                    ) : (
                      <span className="flex flex-wrap gap-1.5">
                        {item.pendingGates.map((gate) => (
                          <Badge key={gate} tone="warning">
                            {TRIAL_GATE_PENDING_LABEL[gate]}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </Td>
                  <Td>
                    {item.latestResult ? (
                      <Badge tone={trialResultTone(item.latestResult.result)}>
                        {trialResultLabel(item.latestResult.result)}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted">미결정</span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <Link
                      href={`/admin/trials/${item.id}`}
                      className="text-xs font-bold text-brand-700 hover:underline"
                    >
                      상세
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}

      <Card className="mt-8">
        <h2 className="mb-1 text-sm font-semibold text-ink-soft">새 시범 회차 제안</h2>
        <p className="mb-4 text-xs text-muted">
          한 상담에 진행 중인 회차는 하나만 둡니다(검수 6). 이미 진행 중인 회차가 있으면 그 회차를
          닫거나 재예약하세요. 유료 여부는 만든 뒤에도 바꿀 수 있습니다.
        </p>
        <SubmitForm action={createTrialSession} submitLabel="회차 제안 만들기">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="상담" required>
              <Select name="consultationId" required defaultValue="">
                <option value="" disabled>
                  상담 선택
                </option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.phone} ({consultationStatusLabel(c.status)})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="비용" hint="무료 시범은 결제 단계를 통과 처리하는 것이 아니라 결제가 불필요한 것으로 기록됩니다.">
              <Select name="isPaid" defaultValue="0">
                <option value="0">무료 시범</option>
                <option value="1">유료 시범</option>
              </Select>
            </Field>
          </div>
        </SubmitForm>
      </Card>
    </div>
  );
}
