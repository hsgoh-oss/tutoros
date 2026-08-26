import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { hasDb, listConsultations, formatKDate } from "@/lib/data/crm";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import { FilterChips } from "@/components/admin/crm/filter-chips";
import { Toolbar } from "@/components/admin/crm/toolbar";
import { listForms } from "@/lib/data/intake";
import {
  CONSULTATION_STATUS_OPTIONS,
  consultationStatusLabel,
  consultationStatusTone,
} from "./constants";
import { INTAKE_KIND_SHORT_LABEL } from "./intake-constants";
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

  // 열린 신청폼(status='sent') 한 번에 조회 → 상담별로 붙인다(행마다 조회하지 않는다).
  // 목록에는 "지금 열려 있는 다음 단계"만 싣는다 — 닫힌·제출된 이력은 상담 상세의 신청폼 카드가 보여준다.
  // 부분 유니크(intake_forms_one_active_per_kind)라 한 상담·한 종류에 최대 1건이고,
  // 시범·정규가 동시에 열려 있으면 검수 6("하나만 활성")이 깨진 상태라 두 개가 그대로 보인다.
  const openForms = session ? await listForms(session.tenantId, { status: "sent" }) : [];
  const openFormsByConsultation = new Map<string, typeof openForms>();
  for (const form of openForms) {
    const bucket = openFormsByConsultation.get(form.consultationId) ?? [];
    bucket.push(form);
    openFormsByConsultation.set(form.consultationId, bucket);
  }

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">상담 관리</h1>
        </div>
      </div>

      {!connected && <DbBanner />}

      <Toolbar>
        <FilterChips
          basePath="/admin/consultations"
          paramKey="status"
          current={status}
          options={CONSULTATION_STATUS_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
          }))}
        />
      </Toolbar>

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
                <Th>신청폼</Th>
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
                    {(openFormsByConsultation.get(c.id) ?? []).length === 0 ? (
                      <span className="text-muted">-</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {(openFormsByConsultation.get(c.id) ?? []).map((f) => (
                          <Badge key={f.id} tone={f.isExpired ? "warning" : "brand"}>
                            {INTAKE_KIND_SHORT_LABEL[f.kind]}
                            {f.isExpired ? " 기한 경과" : " 발송됨"}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </Td>
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
