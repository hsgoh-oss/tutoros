import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { hasDb, listConsultations, formatKDate } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import { FilterChips } from "@/components/admin/crm/filter-chips";
import {
  CONSULTATION_STATUS_OPTIONS,
  consultationStatusLabel,
  consultationStatusTone,
} from "./constants";
import type { ConsultationStatus } from "@/lib/types";

export default async function ConsultationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const session = await getAdminSession();
  const connected = hasDb();
  const consultations = session
    ? await listConsultations(session.tenantId, {
        status: status as ConsultationStatus | undefined,
      })
    : [];

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black tracking-tight">상담 관리</h1>
          <p className="mt-1 text-sm text-muted">
            신청된 상담을 확인하고 학생 등록으로 전환합니다.
          </p>
        </div>
      </div>

      {!connected && <DbBanner />}

      <Card className="mb-6">
        <FilterChips
          basePath="/admin/consultations"
          paramKey="status"
          current={status}
          options={CONSULTATION_STATUS_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
          }))}
        />
      </Card>

      {consultations.length === 0 ? (
        <EmptyState
          title="상담 신청이 없습니다"
          description="공개 사이트 상담 폼을 통해 접수되면 이곳에 표시됩니다."
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>이름</Th>
                <Th>연락처</Th>
                <Th>과목</Th>
                <Th>유형</Th>
                <Th>신청일</Th>
                <Th>상태</Th>
              </tr>
            </thead>
            <tbody>
              {consultations.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <Link
                      href={`/admin/consultations/${c.id}`}
                      className="font-bold text-ink hover:text-brand-600"
                    >
                      {c.name}
                    </Link>
                    {c.guardianName && (
                      <Badge tone="danger" className="ml-2">
                        만14세 미만 — 보호자 동의
                      </Badge>
                    )}
                  </Td>
                  <Td>{c.phone}</Td>
                  <Td>{c.subject ?? "-"}</Td>
                  <Td>{c.classType === "video" ? "화상" : c.classType === "inperson" ? "대면" : "-"}</Td>
                  <Td>{formatKDate(c.createdAt)}</Td>
                  <Td>
                    <Badge tone={consultationStatusTone(c.status)}>
                      {consultationStatusLabel(c.status)}
                    </Badge>
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
