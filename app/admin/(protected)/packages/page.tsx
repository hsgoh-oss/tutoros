import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { hasDb } from "@/lib/data/crm";
import { listPackageTargets, listPackages } from "@/lib/data/packages";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/form";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import { FilterChips } from "@/components/admin/crm/filter-chips";
import { Toolbar } from "@/components/admin/crm/toolbar";
import { createPackage } from "./actions";
import { PackageTargetSelect } from "./target-select";
import {
  PACKAGE_STATUS_OPTIONS,
  WEEKDAY_LABELS,
  isPackageStatus,
  packageStatusLabel,
  packageStatusTone,
  patternSummary,
} from "./constants";

// 수업 묶음 목록 (L-01 · L-10) — 정본: docs/flow-canon/01_atlas_02_portal_lessons.md.
//
// 이 화면이 답하는 질문은 "누구의 몇 회차가 얼마나 남았고, 무엇이 막혀 있는가"다. 그래서 잔액과
// 함께 충돌 회차·귀속 미확정 회차를 같은 줄에 세운다 — 잔액만 보면 "계산에 넣으면 안 되는 회차"가
// 섞여 있는지 알 수 없다(L-10 "귀속 미확정 회차는 확정 사실처럼 사용하지 않는다").

export default async function PackagesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const session = await getAdminSession();
  const connected = hasDb();

  const all = session ? await listPackages(session.tenantId) : [];
  const filterStatus = isPackageStatus(status) ? status : undefined;
  const rows = filterStatus ? all.filter((p) => p.status === filterStatus) : all;

  const activeCount = all.filter((p) => p.status === "active").length;
  const draftCount = all.filter((p) => p.status === "draft").length;
  const conflicted = all.reduce((n, p) => n + (p.balance?.conflictedSessions ?? 0), 0);
  const unresolved = all.reduce((n, p) => n + (p.balance?.unresolvedSessions ?? 0), 0);

  // 활성 등록 + 동의 계약이 있어야 묶음을 만들 수 있다(L-01 "활성 등록·계약 확인").
  const targets = session ? await listPackageTargets(session.tenantId) : [];
  const available = targets.filter((t) => !t.hasLivePackage);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">수업 묶음</h1>
        <p className="mt-1 text-sm text-muted">
          계약 조건으로 전체 회차를 만들고, 출결이 확정될 때마다 회차가 차감됩니다. 잔액은 저장된
          숫자가 아니라 회차 원장의 합이라 언제나 근거로 되짚을 수 있습니다.
        </p>
      </div>

      {!connected && <DbBanner />}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs font-bold text-muted">진행 중</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-emerald-600">{activeCount}</p>
          <p className="mt-1 text-xs text-muted">회차를 만들고 차감할 수 있는 묶음</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-muted">활성화 대기</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-amber-600">{draftCount}</p>
          <p className="mt-1 text-xs text-muted">등록 활성·계약 동의 확인 후 활성화</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-muted">충돌 회차</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-orange-600">{conflicted}</p>
          <p className="mt-1 text-xs text-muted">재협의 전까지 확정하지 않은 회차</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-muted">귀속 미확정</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-rose-600">{unresolved}</p>
          <p className="mt-1 text-xs text-muted">
            <Link href="/admin/attendance" className="underline">
              계약 귀속을 확정
            </Link>
            해야 잔액에 반영됩니다
          </p>
        </Card>
      </div>

      {available.length > 0 && (
        <Card className="mb-6">
          <h2 className="text-sm font-semibold text-ink-soft">수업 묶음 만들기</h2>
          <p className="mt-1 mb-3 text-sm text-muted">
            활성 등록과 동의된 계약이 있는 학생만 고를 수 있습니다. 만들면 <strong>준비</strong>{" "}
            상태이며, 여기서 일정이 생기거나 결제가 확정되지는 않습니다.
          </p>
          <SubmitForm action={createPackage} submitLabel="묶음 만들기">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <PackageTargetSelect
                options={available.map((t) => ({
                  contractId: t.contractId,
                  enrollmentId: t.enrollmentId,
                  studentId: t.studentId,
                  studentName: t.studentName,
                }))}
              />
              <Field label="묶음 이름" hint="예: 2026 가을 정규">
                <Input name="title" maxLength={60} />
              </Field>
              <Field label="총 회차" required>
                <Input name="totalSessions" type="number" min={1} max={200} required defaultValue={8} />
              </Field>
              <Field label="회차 단가(원)">
                <Input name="unitPrice" type="number" min={0} step={1000} defaultValue={0} />
              </Field>
              <Field label="시작일" required>
                <Input name="startsOn" type="date" required />
              </Field>
              <Field label="수업 시각(KST)" required hint="HH:MM">
                <Input name="time" type="time" required defaultValue="17:00" />
              </Field>
              <Field label="수업 길이(분)" required>
                <Input name="durationMin" type="number" min={10} max={480} step={5} required defaultValue={60} />
              </Field>
              <Field label="반복 요일" required>
                <div className="flex flex-wrap gap-2 pt-2">
                  {WEEKDAY_LABELS.map((label, i) => (
                    <label key={label} className="flex items-center gap-1 text-sm">
                      <input type="checkbox" name="weekdays" value={i} className="accent-brand-600" />
                      {label}
                    </label>
                  ))}
                </div>
              </Field>
            </div>
          </SubmitForm>
        </Card>
      )}

      <Toolbar>
        <FilterChips
          basePath="/admin/packages"
          paramKey="status"
          current={filterStatus}
          options={PACKAGE_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
      </Toolbar>

      {rows.length === 0 ? (
        <EmptyState
          title="수업 묶음이 없습니다"
          description={
            available.length > 0
              ? "위의 '수업 묶음 만들기'에서 시작할 수 있습니다."
              : "활성 등록과 동의된 계약이 있어야 수업 묶음을 만들 수 있습니다(정규 등록에서 활성화하세요)."
          }
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>학생·묶음</Th>
                <Th>상태</Th>
                <Th>반복 조건</Th>
                <Th>잔액</Th>
                <Th>회차</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <Link
                      href={`/admin/packages/${p.id}`}
                      className="font-bold text-ink hover:text-brand-600"
                    >
                      {p.studentName ?? "알 수 없음"}
                    </Link>
                    {p.title && <span className="block text-xs text-muted">{p.title}</span>}
                  </Td>
                  <Td>
                    <Badge tone={packageStatusTone(p.status)}>{packageStatusLabel(p.status)}</Badge>
                  </Td>
                  <Td className="text-xs text-muted">
                    {patternSummary(p.pattern.weekdays, p.pattern.time, p.pattern.durationMin)}
                    <span className="block">{p.startsOn} 시작</span>
                  </Td>
                  <Td>
                    <span
                      className={
                        (p.balance?.remaining ?? 0) < 0
                          ? "font-semibold text-rose-600"
                          : "font-semibold text-ink"
                      }
                    >
                      {p.balance?.remaining ?? p.totalSessions}
                    </span>
                    <span className="text-xs text-muted"> / {p.totalSessions}</span>
                    {(p.balance?.remaining ?? 0) < 0 && (
                      <span className="block text-xs font-bold text-rose-600">계약 회차 초과</span>
                    )}
                  </Td>
                  <Td className="text-xs text-muted">
                    확정 {p.balance?.confirmedSessions ?? 0}
                    {(p.balance?.conflictedSessions ?? 0) > 0 && (
                      <span className="ml-1 font-bold text-orange-600">
                        · 충돌 {p.balance?.conflictedSessions}
                      </span>
                    )}
                    {(p.balance?.unresolvedSessions ?? 0) > 0 && (
                      <span className="ml-1 font-bold text-rose-600">
                        · 귀속 미확정 {p.balance?.unresolvedSessions}
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
