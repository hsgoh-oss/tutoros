import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import {
  formatKDate,
  formatWon,
  getPaymentSummary,
  hasDb,
  listConsultations,
  listSchedules,
  listStudents,
  type ConsultationDetail,
  type PaymentSummary,
  type ScheduleListItem,
} from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import {
  consultationStatusLabel,
  consultationStatusTone,
} from "../consultations/constants";
import type { Student } from "@/lib/types";

// 이번 주 월요일 00:00 ~ 다음 주 월요일 00:00 (schedules 모듈의 주간 계산과 동일 기준).
function currentWeekRange(): { from: string; to: string } {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = monday.getDay(); // 0=일 ... 6=토
  monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day));
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  return { from: monday.toISOString(), to: nextMonday.toISOString() };
}

const EMPTY_PAYMENT_SUMMARY: PaymentSummary = {
  paidThisMonth: 0,
  overdueTotal: 0,
  pendingTotal: 0,
};

export default async function DashboardPage() {
  const session = await getAdminSession();
  const connected = hasDb();

  let newConsultations: ConsultationDetail[] = [];
  let activeStudents: Student[] = [];
  let weekSchedules: ScheduleListItem[] = [];
  let paymentSummary: PaymentSummary = EMPTY_PAYMENT_SUMMARY;
  let recentConsultations: ConsultationDetail[] = [];

  if (session) {
    [
      newConsultations,
      activeStudents,
      weekSchedules,
      paymentSummary,
      recentConsultations,
    ] = await Promise.all([
      listConsultations(session.tenantId, { status: "new" }),
      listStudents(session.tenantId, { status: "active" }),
      listSchedules(session.tenantId, currentWeekRange()),
      getPaymentSummary(session.tenantId),
      listConsultations(session.tenantId),
    ]);
  }

  const recent = recentConsultations.slice(0, 5);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-black tracking-tight">대시보드</h1>
        <p className="mt-1 text-sm text-muted">주요 현황을 한눈에 확인합니다.</p>
      </div>

      {!connected && <DbBanner />}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/admin/consultations">
          <Card className="h-full transition-transform hover:-translate-y-0.5">
            <p className="text-xs font-bold text-muted">신규 상담</p>
            <p className="mt-2 text-2xl font-black tracking-tight text-ink">
              {newConsultations.length}건
            </p>
          </Card>
        </Link>
        <Link href="/admin/students">
          <Card className="h-full transition-transform hover:-translate-y-0.5">
            <p className="text-xs font-bold text-muted">재원 학생</p>
            <p className="mt-2 text-2xl font-black tracking-tight text-ink">
              {activeStudents.length}명
            </p>
          </Card>
        </Link>
        <Link href="/admin/schedules">
          <Card className="h-full transition-transform hover:-translate-y-0.5">
            <p className="text-xs font-bold text-muted">이번 주 일정</p>
            <p className="mt-2 text-2xl font-black tracking-tight text-ink">
              {weekSchedules.length}건
            </p>
          </Card>
        </Link>
        <Link href="/admin/payments">
          <Card className="h-full transition-transform hover:-translate-y-0.5">
            <p className="text-xs font-bold text-muted">이번 달 완납 / 미납</p>
            <p className="mt-2 text-lg font-black tracking-tight text-ink">
              {formatWon(paymentSummary.paidThisMonth)}
              <span className="mx-1.5 text-muted">/</span>
              <span className="text-rose-600">
                {formatWon(paymentSummary.overdueTotal)}
              </span>
            </p>
          </Card>
        </Link>
      </div>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-black tracking-tight">최근 상담</h2>
          <Link
            href="/admin/consultations"
            className="flex min-h-11 items-center text-xs font-bold text-brand-700 hover:underline"
          >
            전체 보기
          </Link>
        </div>
        {recent.length === 0 ? (
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
                  <Th>신청일</Th>
                  <Th>상태</Th>
                </tr>
              </thead>
              <tbody>
                {recent.map((c) => (
                  <tr key={c.id}>
                    <Td>
                      <Link
                        href={`/admin/consultations/${c.id}`}
                        className="font-bold text-ink hover:text-brand-600"
                      >
                        {c.name}
                      </Link>
                    </Td>
                    <Td>{c.phone}</Td>
                    <Td>{c.subject ?? "-"}</Td>
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
      </Card>
    </div>
  );
}
