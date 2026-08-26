import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { formatKDate, hasDb } from "@/lib/data/crm";
import { listReports } from "@/lib/data/reports";
import { buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import { FilterChips } from "@/components/admin/crm/filter-chips";
import { Toolbar } from "@/components/admin/crm/toolbar";
import {
  REPORT_TYPE_OPTIONS,
  reportAudienceLabel,
  reportDeliveryLabel,
  reportDeliveryTone,
  reportStatusLabel,
  reportStatusTone,
  reportTypeLabel,
} from "./constants";
import type { ReportType } from "@/lib/types";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; student?: string }>;
}) {
  const { type, student } = await searchParams;
  const session = await getAdminSession();
  const connected = hasDb();
  const reports = session
    ? await listReports(session.tenantId, {
        type: type as ReportType | undefined,
        studentId: student,
      })
    : [];

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">AI 리포트</h1>
          <p className="mt-1 text-sm text-muted">
            수업·주간·월간·시험 리포트와 상담 브리핑을 생성하고 승인 후 발송합니다.
          </p>
        </div>
        <Link href="/admin/reports/new" className={buttonClass("primary", "sm")}>
          신규 생성
        </Link>
      </div>

      {!connected && <DbBanner />}

      {student && (
        <div className="mb-6 flex items-center gap-3">
          <Badge tone="brand">
            {reports[0]?.studentName ?? "선택한 학생"} 리포트만 표시 중
          </Badge>
          <Link href="/admin/reports" className="text-xs font-bold text-muted hover:text-ink">
            필터 해제
          </Link>
        </div>
      )}

      <Toolbar>
        <FilterChips
          basePath="/admin/reports"
          paramKey="type"
          current={type}
          options={REPORT_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
      </Toolbar>

      {reports.length === 0 ? (
        <EmptyState
          title="생성된 리포트가 없습니다"
          description="신규 생성 버튼으로 AI 리포트를 만들 수 있습니다."
          action={
            <Link href="/admin/reports/new" className={buttonClass("outline", "sm")}>
              신규 생성
            </Link>
          }
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>학생</Th>
                <Th>유형</Th>
                <Th>대상</Th>
                <Th>깊이</Th>
                <Th>상태</Th>
                <Th>전달</Th>
                <Th>모델</Th>
                <Th>생성일</Th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <Link
                      href={`/admin/reports/${r.id}`}
                      className="font-bold text-ink hover:text-brand-600"
                    >
                      {r.studentName ?? "-"}
                    </Link>
                  </Td>
                  <Td>{reportTypeLabel(r.type)}</Td>
                  <Td>{reportAudienceLabel(r.audience)}</Td>
                  <Td>{r.depth === "deep" ? "심화" : "기본"}</Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <Badge tone={reportStatusTone(r.status)}>{reportStatusLabel(r.status)}</Badge>
                      {/* G-03 이전본 대체 표시 — 철회 뱃지 옆에 정정된 최신본으로 가는 연결을 드러낸다. */}
                      {r.supersededBy && (
                        <Link
                          href={`/admin/reports/${r.supersededBy}`}
                          className="whitespace-nowrap text-[11px] font-bold text-brand-700 hover:underline"
                        >
                          대체됨 →
                        </Link>
                      )}
                    </div>
                  </Td>
                  <Td>
                    {/* 전달 상태 — 업무 상태와 분리(N-02). 미발송은 뱃지 대신 "-"로 소음을 줄인다. */}
                    {r.deliveryStatus === "none" ? (
                      <span className="text-xs text-muted">-</span>
                    ) : (
                      <Badge tone={reportDeliveryTone(r.deliveryStatus)}>
                        {reportDeliveryLabel(r.deliveryStatus)}
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-xs text-muted">{r.modelUsed ?? "-"}</Td>
                  <Td>{formatKDate(r.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
