import { AdminPageHeader } from "@/components/admin/page-header";
import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { getStudent, hasDb } from "@/lib/data/crm";
import { listPackageTargets, listPackages } from "@/lib/data/packages";
import { isUuid } from "@/lib/uuid";
import type { LessonPackage, Student } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { SummaryRow } from "@/components/admin/crm/summary-row";
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
  searchParams: Promise<{ status?: string; student?: string }>;
}) {
  const { status, student } = await searchParams;
  const filterStudentId = isUuid(student) ? student : undefined;
  const session = await getAdminSession();
  const connected = hasDb();

  let all: LessonPackage[] = [];
  let filteredStudent: Student | null = null;
  if (session) {
    [all, filteredStudent] = await Promise.all([
      listPackages(session.tenantId),
      filterStudentId ? getStudent(session.tenantId, filterStudentId) : Promise.resolve(null),
    ]);
  }
  const filterStatus = isPackageStatus(status) ? status : undefined;
  // 상태 필터·학생 필터는 목록(rows)에만 걸고, 위 집계 카드는 테넌트 전체 기준을 유지한다
  // (상태 FilterChips가 이미 같은 방식으로 동작한다).
  let rows = all;
  if (filterStatus) rows = rows.filter((p) => p.status === filterStatus);
  if (filterStudentId) rows = rows.filter((p) => p.studentId === filterStudentId);

  const activeCount = all.filter((p) => p.status === "active").length;
  const draftCount = all.filter((p) => p.status === "draft").length;
  const conflicted = all.reduce((n, p) => n + (p.balance?.conflictedSessions ?? 0), 0);
  const unresolved = all.reduce((n, p) => n + (p.balance?.unresolvedSessions ?? 0), 0);

  // 활성 등록 + 동의 계약이 있어야 묶음을 만들 수 있다(L-01 "활성 등록·계약 확인").
  const targets = session ? await listPackageTargets(session.tenantId) : [];
  const available = targets.filter((t) => !t.hasLivePackage);

  return (
    <div className="dash-page">
      <AdminPageHeader>
        <h1 className="text-xl font-semibold tracking-tight">수업 묶음</h1>
        <p className="mt-1 text-sm text-muted">
          계약별 수업 회차와 남은 횟수를 확인합니다.
        </p>
      </AdminPageHeader>

      {!connected && <DbBanner />}

      <div className="mb-6">
        <SummaryRow items={[
          { label: "진행 중", value: `${activeCount}건` },
          { label: "활성화 대기", value: `${draftCount}건` },
          { label: "충돌 회차", value: `${conflicted}회`, attention: conflicted > 0 },
          { label: "귀속 미확정", value: `${unresolved}회`, attention: unresolved > 0 },
        ]} />
        {unresolved > 0 && (
          <p className="mt-3 text-sm text-muted">
            귀속 미확정 회차는 남은 횟수에 반영되지 않습니다.{" "}
            <Link href="/admin/attendance" className="underline underline-offset-4">출결·정정에서 확인</Link>
          </p>
        )}
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
                defaultStudentId={filterStudentId}
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

      {filterStudentId && (
        <Card className="mb-6 flex items-center justify-between">
          <span className="text-sm font-bold text-ink-soft">
            {filteredStudent?.name ?? "선택한 학생"} 학생으로 필터링됨
          </span>
          <Link
            href="/admin/packages"
            className="text-xs font-bold text-brand-700 hover:underline"
          >
            학생 필터 해제
          </Link>
        </Card>
      )}

      <Toolbar>
        <FilterChips
          basePath="/admin/packages"
          paramKey="status"
          current={filterStatus}
          preserveParams={{ student: filterStudentId }}
          options={PACKAGE_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
      </Toolbar>

      {rows.length === 0 ? (
        <EmptyState
          title={filterStatus || filterStudentId ? "조건에 맞는 수업 묶음이 없습니다" : "수업 묶음이 없습니다"}
          description={
            filterStatus || filterStudentId
              ? "학생이나 상태 조건을 변경해 주세요."
              : available.length > 0
              ? "위의 '수업 묶음 만들기'에서 시작할 수 있습니다."
              : "정규 등록을 활성화하고 계약 동의를 완료하면 수업 묶음을 만들 수 있습니다."
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
