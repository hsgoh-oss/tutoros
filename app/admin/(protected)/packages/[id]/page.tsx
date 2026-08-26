import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { formatKDateTime } from "@/lib/data/crm";
import { getPackageDetail } from "@/lib/data/packages";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { EmptyState } from "@/components/admin/crm/empty-state";
import { scheduleStatusLabel, scheduleStatusTone } from "../../schedules/constants";
import { activatePackage, adjustPackageSessions, endPackage, generateSessions } from "../actions";
import { GenerateSessionsForm } from "../generate-form";
import {
  attendanceLabel,
  attendanceTone,
  deductionLabel,
  ledgerKindLabel,
  packageStatusLabel,
  packageStatusTone,
  patternSummary,
} from "../constants";

// 수업 묶음 상세 (L-01 · L-03 · L-05) — 회차 후보 생성·잔액 원장·회차 목록.
//
// 잔액 카드 옆에 원장을 그대로 세우는 이유: 잔액은 저장값이 아니라 이 표의 합이다. 숫자와 근거가
// 한 화면에 있어야 "왜 7회 남았는가"를 다른 화면으로 옮겨 다니며 재구성하지 않아도 된다(L-06).

export default async function PackageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAdminSession();
  if (!session) notFound();

  const detail = await getPackageDetail(session.tenantId, id);
  if (!detail) notFound();
  const { pkg, schedules, ledger } = detail;
  const balance = pkg.balance;

  const conflicts = schedules.filter((s) => s.status === "conflict");
  const generateAction = generateSessions.bind(null, id);
  const adjustAction = adjustPackageSessions.bind(null, id);
  const endAction = endPackage.bind(null, id);
  // 폼 값이 없는 전환. SubmitForm은 FormData를 넘기지만 여기서는 쓰지 않는다.
  const activateAction = async () => {
    "use server";
    return activatePackage(id);
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {pkg.studentName ?? "알 수 없음"}
            {pkg.title && <span className="ml-2 text-sm font-bold text-muted">{pkg.title}</span>}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {patternSummary(pkg.pattern.weekdays, pkg.pattern.time, pkg.pattern.durationMin)} ·{" "}
            {pkg.startsOn} 시작 · 회차 단가 {pkg.unitPrice.toLocaleString()}원
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={packageStatusTone(pkg.status)}>{packageStatusLabel(pkg.status)}</Badge>
          <Link href="/admin/packages" className={buttonClass("ghost", "sm")}>
            목록
          </Link>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs font-bold text-muted">남은 회차</p>
          <p
            className={`mt-2 text-2xl font-semibold tracking-tight ${
              (balance?.remaining ?? 0) < 0 ? "text-rose-600" : "text-ink"
            }`}
          >
            {balance?.remaining ?? pkg.totalSessions}
          </p>
          <p className="mt-1 text-xs text-muted">계약 {pkg.totalSessions}회 기준</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-muted">소진</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-brand-700">
            {balance?.consumed ?? 0}
          </p>
          <p className="mt-1 text-xs text-muted">차감된 회차(복원분 제외 전)</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-muted">충돌 회차</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-orange-600">
            {balance?.conflictedSessions ?? 0}
          </p>
          <p className="mt-1 text-xs text-muted">재협의 전까지 확정하지 않습니다</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-muted">귀속 미확정</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-rose-600">
            {balance?.unresolvedSessions ?? 0}
          </p>
          <p className="mt-1 text-xs text-muted">잔액·환불 계산에 넣지 않습니다</p>
        </Card>
      </div>

      {pkg.status === "draft" && (
        <Card className="mb-6">
          <h2 className="text-sm font-semibold text-ink-soft">활성화</h2>
          <p className="mt-1 mb-3 text-sm text-muted">
            등록이 활성이고 계약이 동의된 경우에만 통과합니다. 활성화해야 회차를 만들 수 있습니다 —
            일정 생성이 결제·계약 완료를 대신하지는 않습니다.
          </p>
          <SubmitForm action={activateAction} submitLabel="묶음 활성화" />
        </Card>
      )}

      {pkg.status === "active" && (
        <Card className="mb-6">
          <h2 className="text-sm font-semibold text-ink-soft">회차 만들기</h2>
          <p className="mt-1 mb-3 text-sm text-muted">
            반복 조건으로 후보를 만들고, 기존 일정과 겹치는 후보는 <strong>충돌</strong>로 남겨
            재협의 업무를 만듭니다. 정상 회차는 그대로 확정됩니다. 이미 만든 시각은 다시 만들지
            않으므로 여러 번 눌러도 안전합니다.
          </p>
          <GenerateSessionsForm
            action={generateAction}
            defaultCount={Math.max(1, balance?.remaining ?? pkg.totalSessions)}
          />
        </Card>
      )}

      {conflicts.length > 0 && (
        <Card className="mb-6 border-orange-200 bg-orange-50/40">
          <h2 className="text-sm font-semibold text-orange-800">
            충돌 회차 {conflicts.length}건 — 재협의 필요
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-orange-900">
            {conflicts.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/schedules/${c.id}`} className="underline">
                  {formatKDateTime(c.scheduledAt)}
                </Link>
                {c.conflictReason && <span className="ml-2 text-xs">{c.conflictReason}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold text-ink-soft">회차 조정</h2>
          <p className="mt-1 mb-3 text-sm text-muted">
            서비스 회차 부여·계약 변경에 따른 감액을 원장에 남깁니다. 기존 기입은 고치지 않고 새 행만
            쌓입니다 — 사유가 곧 근거입니다.
          </p>
          <SubmitForm action={adjustAction} submitLabel="원장에 기입">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="조정 회차" required hint="양수=부여, 음수=감액">
                <Input name="delta" type="number" min={-200} max={200} required defaultValue={1} />
              </Field>
              <Field label="사유" required>
                <Input name="reason" required maxLength={200} />
              </Field>
            </div>
          </SubmitForm>
        </Card>

        {pkg.status !== "ended" && (
          <Card>
            <h2 className="text-sm font-semibold text-ink-soft">묶음 종료</h2>
            <p className="mt-1 mb-3 text-sm text-muted">
              종료해도 원장은 그대로 남습니다 — 남은 회차는 정산·환불 계산의 근거입니다.
            </p>
            <SubmitForm action={endAction} submitLabel="종료">
              <Field label="종료 사유" required>
                <Textarea name="reason" required rows={2} maxLength={300} />
              </Field>
            </SubmitForm>
          </Card>
        )}
      </div>

      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-ink-soft">회차 원장</h2>
        {ledger.length === 0 ? (
          <p className="text-sm text-muted">아직 기입이 없습니다. 잔액은 계약 회차 그대로입니다.</p>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>시각</Th>
                  <Th>종류</Th>
                  <Th>증감</Th>
                  <Th>사유</Th>
                  <Th>처리자</Th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id}>
                    <Td className="text-xs text-muted">{formatKDateTime(l.createdAt)}</Td>
                    <Td>
                      <Badge tone={l.delta < 0 ? "danger" : "success"}>
                        {ledgerKindLabel(l.kind)}
                      </Badge>
                    </Td>
                    <Td className="font-semibold">
                      {l.delta > 0 ? "+" : ""}
                      {l.delta}
                    </Td>
                    <Td className="text-xs">{l.reason}</Td>
                    <Td className="text-xs text-muted">{l.actorEmail ?? "-"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ink-soft">회차 목록</h2>
        {schedules.length === 0 ? (
          <EmptyState
            title="회차가 없습니다"
            description="활성화 후 '회차 만들기'로 반복 일정을 생성하세요."
          />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>일시</Th>
                  <Th>상태</Th>
                  <Th>출결</Th>
                  <Th>차감</Th>
                  <Th>귀속</Th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id}>
                    <Td>
                      <Link
                        href={`/admin/schedules/${s.id}`}
                        className="font-bold text-ink hover:text-brand-600"
                      >
                        {formatKDateTime(s.scheduledAt)}
                      </Link>
                      {s.originScheduleId && (
                        <span className="ml-1 text-xs text-amber-700">보강</span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={scheduleStatusTone(s.status)}>
                        {scheduleStatusLabel(s.status)}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge tone={attendanceTone(s.attendance)}>
                        {attendanceLabel(s.attendance)}
                      </Badge>
                    </Td>
                    <Td className="text-xs text-muted">{deductionLabel(s.deductionState)}</Td>
                    <Td className="text-xs">
                      {s.contractId ? (
                        <span className="text-muted">확정</span>
                      ) : (
                        <span className="font-bold text-rose-600">미확정</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
