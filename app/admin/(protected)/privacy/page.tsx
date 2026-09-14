import { ErasureControls } from "@/components/admin/privacy/erasure-controls";
import { AdminPageHeader } from "@/components/admin/page-header";
import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { formatKDate, formatKDateTime, hasDb } from "@/lib/data/crm";
import {
  RETENTION_EVENTS_NOT_TRACKED,
  RETENTION_POLICY,
  listRetentionRecords,
  type RetentionRecord,
  type RetentionState,
} from "@/lib/privacy/retention";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { Field, Input } from "@/components/ui/form";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import { FilterChips } from "@/components/admin/crm/filter-chips";
import { Toolbar } from "@/components/admin/crm/toolbar";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { ActionButton } from "@/components/admin/crm/action-button";
import {
  holdRetentionRecord,
  recomputeRetentionRecords,
  releaseRetentionHold,
} from "./actions";

const STATE_LABEL: Record<RetentionState, string> = {
  due: "파기 예정 도달",
  keeping: "보존 중",
  held: "보존 잠금",
  destroyed: "파기 완료",
};

const STATE_TONE: Record<
  RetentionState,
  "brand" | "soft" | "success" | "warning" | "danger"
> = {
  due: "danger",
  keeping: "soft",
  held: "warning",
  destroyed: "success",
};

const STATE_FILTERS = (Object.keys(STATE_LABEL) as RetentionState[]).map((v) => ({
  value: v,
  label: STATE_LABEL[v],
}));

function isState(value: string): value is RetentionState {
  return Object.hasOwn(STATE_LABEL, value);
}

const SUBJECT_LABEL: Record<RetentionRecord["subjectType"], string> = {
  student: "학생",
  consultation: "상담",
  payment: "결제",
  review: "후기",
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-panel border border-line px-4 py-3">
      <p className="text-xs font-bold text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** 남은 일수 표기 — 지난 것은 "며칠 지남"으로 읽혀야 한다(음수 그대로 두면 못 읽는다). */
function remainLabel(daysLeft: number): string {
  if (daysLeft === 0) return "오늘";
  return daysLeft > 0 ? `${daysLeft}일 남음` : `${Math.abs(daysLeft)}일 지남`;
}

export default async function PrivacyRetentionPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state: stateParam } = await searchParams;
  const state = stateParam && isState(stateParam) ? stateParam : undefined;

  const session = await getAdminSession();
  const connected = hasDb();
  const all = session ? await listRetentionRecords(session.tenantId) : [];
  const records = state ? all.filter((r) => r.state === state) : all;

  const counts = {
    due: all.filter((r) => r.state === "due").length,
    keeping: all.filter((r) => r.state === "keeping").length,
    held: all.filter((r) => r.state === "held").length,
    destroyed: all.filter((r) => r.state === "destroyed").length,
  };

  return (
    <div className="dash-page">
      <AdminPageHeader>
        <h1 className="text-xl font-semibold tracking-tight">개인정보 보존기록</h1>
        <p className="mt-1 text-sm text-muted">
          기산 사건에서 보존기한을 계산해 파기 예정일을 관리합니다. 기준은{" "}
          <Link href="/privacy" className="font-bold text-brand-700 hover:underline">
            공개 처리방침의 보유기간
          </Link>
          입니다.
        </p>
      </AdminPageHeader>

      {!connected && <DbBanner />}

      {/* 이 화면의 한계를 맨 위에 둔다 — 밑에 두면 안 읽고, 안 읽으면 '자동으로 파기되는 줄'
          알게 된다. 그 오해는 방치된 개인정보로 이어진다. */}
      <div className="mb-6 rounded-panel border border-line bg-soft px-4 py-3">
        <p className="text-sm font-bold text-ink-soft">
          기한 확인부터 원본 삭제, 외부 보관 확인까지 단계별로 관리합니다.
        </p>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          기한이 지난 항목의 파기 범위를 확인한 뒤 직접 실행합니다. 원본·첨부파일 삭제와 외부
          서비스·백업 확인이 모두 끝나야 완료할 수 있습니다. 보존 잠금 중에는 파기할 수 없습니다.
        </p>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Stat
          label="파기 예정 도달"
          value={`${counts.due}건`}
          hint={counts.due > 0 ? "확인이 필요합니다" : "없음"}
        />
        <Stat label="보존 중" value={`${counts.keeping}건`} hint="기한 이내" />
        <Stat
          label="보존 잠금"
          value={`${counts.held}건`}
          hint={counts.held > 0 ? "주기적 재검토 대상" : "없음"}
        />
        <Stat label="파기 완료" value={`${counts.destroyed}건`} hint="기록 보존" />
      </div>

      <Card className="mb-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">기산 갱신</h2>
            <p className="mt-1 text-sm text-muted">
              등록 종료·대기 철회·완납을 훑어 보존기록을 만들거나 기산일을 미룹니다.
              여러 번 실행해도 결과는 같고, 파기 기록이 있는 항목은 건드리지 않습니다.
            </p>
          </div>
          <ActionButton
            action={recomputeRetentionRecords}
            id=""
            label="지금 기산하기"
            pendingLabel="기산 중..."
            confirmText="원 데이터를 훑어 보존기록을 갱신합니다. 계속할까요?"
          />
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <p className="text-xs font-bold text-muted">아직 자동으로 기산하지 않는 사건</p>
          <ul className="mt-2 space-y-1.5">
            {RETENTION_EVENTS_NOT_TRACKED.map((e) => (
              <li key={e.label} className="text-xs leading-relaxed text-muted">
                <strong className="text-ink-soft">{e.label}</strong> — {e.reason}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <Toolbar>
        <FilterChips
          basePath="/admin/privacy"
          paramKey="state"
          options={STATE_FILTERS}
          current={state}
        />
      </Toolbar>

      {records.length === 0 ? (
        <EmptyState
          title={state ? "이 상태의 항목이 없습니다" : "보존기록이 없습니다"}
          description={
            state
              ? "필터를 '전체'로 바꿔 보세요."
              : "위 '지금 기산하기'를 실행하면 종료된 등록·완납 결제 등에서 보존기록이 만들어집니다."
          }
        />
      ) : (
        <div className="space-y-4">
          {records.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.erasure && !r.destroyedAt ? "warning" : STATE_TONE[r.state]}>{r.erasure && !r.destroyedAt ? "파기 진행 중" : STATE_LABEL[r.state]}</Badge>
                    <span className="text-xs font-bold text-muted">
                      {SUBJECT_LABEL[r.subjectType]}
                    </span>
                    <span className="font-bold text-ink">{r.subjectLabel}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-ink-soft">{r.categoryLabel}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    기산 사건 {r.eventLabel} · {formatKDateTime(r.startedAt)} 기준 ·{" "}
                    {r.policyLabel}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-muted">파기 예정일</p>
                  <p className="mt-0.5 text-sm font-semibold tracking-tight text-ink">
                    {formatKDate(r.retainUntil)}
                  </p>
                  {r.state !== "destroyed" && (
                    <p className="mt-0.5 text-xs text-muted">{remainLabel(r.daysLeft)}</p>
                  )}
                </div>
              </div>

              {r.holdReason && (
                <p className="mt-4 rounded-panel border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <strong className="font-bold">
                    {r.holdAt ? "보존 잠금 중" : "이전 보존 잠금"}
                  </strong>{" "}
                  — {r.holdReason}
                  <span className="ml-1 text-xs">
                    ({r.holdBy ?? "담당자 미기재"}
                    {r.holdAt ? ` · ${formatKDateTime(r.holdAt)}` : " · 해제됨"})
                  </span>
                </p>
              )}

              {r.destroyedAt ? (
                <p className="mt-4 rounded-panel border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  <strong className="font-bold">{r.erasure?.completedAt ? "파기 완료" : "이전 수기 파기 기록 · 실제 삭제 별도 확인"}</strong> —{" "}
                  {r.destroyedNote ?? "내용 미기재"}
                  <span className="ml-1 text-xs">
                    ({r.destroyedBy ?? "담당자 미기재"} · {formatKDateTime(r.destroyedAt)})
                  </span>
                </p>
              ) : r.holdAt ? (
                <div className="mt-4 border-t border-line pt-4">
                  <p className="mb-3 text-xs text-muted">
                    보존 잠금 중에는 파기를 완료로 기록할 수 없습니다(자동 해제 없음 — 해제는
                    운영자 승인으로만).
                  </p>
                  <ActionButton
                    action={releaseRetentionHold}
                    id={r.id}
                    label="보존 잠금 해제"
                    confirmText="보존 잠금을 해제하면 원래의 보존·파기 흐름으로 돌아갑니다. 계속할까요?"
                  />
                </div>
              ) : (
                <div className="mt-4 grid gap-6 border-t border-line pt-4 lg:grid-cols-2">
                  <SubmitForm action={holdRetentionRecord} submitLabel="보존 잠금">
                    <input type="hidden" name="id" value={r.id} />
                    <Field
                      label="보존 잠금 사유"
                      hint="분쟁·법적 요청·보안사고 등. 사유 없는 잠금은 재검토할 수 없습니다"
                    >
                      <Input name="reason" placeholder="예: 환불 분쟁 진행 중" />
                    </Field>
                  </SubmitForm>

                  <ErasureControls record={r} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Card className="mt-8">
        <h2 className="mb-3 text-sm font-semibold tracking-tight">적용 중인 보존기한</h2>
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>데이터 종류</Th>
                <Th>보존기한</Th>
                <Th>공개 처리방침 문구</Th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(RETENTION_POLICY).map(([key, policy]) => (
                <tr key={key}>
                  <Td className="font-bold text-ink">{policy.label}</Td>
                  <Td>{policy.days}일</Td>
                  <Td className="text-xs text-muted">{policy.policyLabel}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
        <p className="mt-3 text-xs text-muted">
          이미 기산된 항목은 기산 당시의 기준을 유지합니다 — 방침이 바뀌어도 지난 약속이
          소급해 흔들리지 않습니다.
        </p>
      </Card>
    </div>
  );
}
