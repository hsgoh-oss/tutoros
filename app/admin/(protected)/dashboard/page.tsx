import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import {
  formatKDate,
  formatKDateTime,
  formatWon,
  getPaymentSummary,
  getRecruitStatus,
  hasDb,
  listConsultations,
  listPaymentsDueSoon,
  listSchedules,
  listStudents,
  listTenantDdays,
  type ConsultationDetail,
  type DueSoonPayment,
  type PaymentSummary,
  type ScheduleListItem,
} from "@/lib/data/crm";
import { listActivity, type ActivityEntry } from "@/lib/data/activity";
import type { Dday, RecruitState, RecruitStatus, Student } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import {
  consultationStatusLabel,
  consultationStatusTone,
} from "../consultations/constants";
import { scheduleStatusLabel, scheduleStatusTone } from "../schedules/constants";

type BadgeTone = "brand" | "soft" | "success" | "warning" | "danger";

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

// 오늘 00:00 ~ 내일 00:00 (currentWeekRange와 동일한 로컬 기준).
function todayRange(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(start);
  tomorrow.setDate(start.getDate() + 1);
  return { from: start.toISOString(), to: tomorrow.toISOString() };
}

// examDate("YYYY-MM-DD") 기준 남은 일수 — 로컬 자정 기준 계산.
function daysUntil(dateStr: string): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, (m ?? 1) - 1, d ?? 1);
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

function ddayLabel(dateStr: string): string {
  const n = daysUntil(dateStr);
  if (n === 0) return "D-DAY";
  return n > 0 ? `D-${n}` : `D+${Math.abs(n)}`;
}

const RECRUIT_LABEL: Record<RecruitState, string> = {
  open: "모집중",
  closing: "마감 임박",
  waitlist: "대기 접수",
  closed: "마감",
};

const RECRUIT_TONE: Record<RecruitState, BadgeTone> = {
  open: "success",
  closing: "warning",
  waitlist: "brand",
  closed: "danger",
};

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
  let todaySchedules: ScheduleListItem[] = [];
  let duePayments: DueSoonPayment[] = [];
  let ddays: Dday[] = [];
  let recruit: RecruitStatus | null = null;
  let recentActivity: ActivityEntry[] = [];

  if (session) {
    [
      newConsultations,
      activeStudents,
      weekSchedules,
      paymentSummary,
      recentConsultations,
      todaySchedules,
      duePayments,
      ddays,
      recruit,
      recentActivity,
    ] = await Promise.all([
      listConsultations(session.tenantId, { status: "new" }),
      listStudents(session.tenantId, { status: "active" }),
      listSchedules(session.tenantId, currentWeekRange()),
      getPaymentSummary(session.tenantId),
      listConsultations(session.tenantId),
      listSchedules(session.tenantId, todayRange()),
      listPaymentsDueSoon(session.tenantId, 3),
      listTenantDdays(session.tenantId),
      getRecruitStatus(session.tenantId),
      listActivity(session.tenantId, 8),
    ]);
  }

  const recent = recentConsultations.slice(0, 5);
  const visibleDdays = ddays.filter((d) => d.isVisible);

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

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-black tracking-tight">오늘 수업</h2>
            <Link
              href="/admin/schedules"
              className="flex min-h-11 items-center text-xs font-bold text-brand-700 hover:underline"
            >
              일정 관리
            </Link>
          </div>
          {todaySchedules.length === 0 ? (
            <EmptyState title="오늘 예정된 수업이 없습니다" />
          ) : (
            <ul className="divide-y divide-line">
              {todaySchedules.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">
                      {s.studentName}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {formatKDateTime(s.scheduledAt)}
                    </p>
                  </div>
                  <Badge tone={scheduleStatusTone(s.status)}>
                    {scheduleStatusLabel(s.status)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-black tracking-tight">청구 필요 (D-3)</h2>
            <Link
              href="/admin/payments"
              className="flex min-h-11 items-center text-xs font-bold text-brand-700 hover:underline"
            >
              결제 관리
            </Link>
          </div>
          {duePayments.length === 0 ? (
            <EmptyState title="임박한 청구가 없습니다" />
          ) : (
            <ul className="divide-y divide-line">
              {duePayments.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/admin/payments/${p.id}`}
                    className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 hover:text-brand-600"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">
                        {p.studentName}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        마감 {formatKDate(p.dueDate)}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-black tracking-tight text-ink">
                      {formatWon(p.amount)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-black tracking-tight">D-day</h2>
            <Link
              href="/admin/settings"
              className="flex min-h-11 items-center text-xs font-bold text-brand-700 hover:underline"
            >
              설정
            </Link>
          </div>
          {visibleDdays.length === 0 ? (
            <EmptyState title="표시 중인 D-day가 없습니다" />
          ) : (
            <ul className="divide-y divide-line">
              {visibleDdays.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">{d.name}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {formatKDate(d.examDate)}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-black tracking-tight text-brand-600">
                    {ddayLabel(d.examDate)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-black tracking-tight">모집 상태</h2>
            <Link
              href="/admin/settings"
              className="flex min-h-11 items-center text-xs font-bold text-brand-700 hover:underline"
            >
              설정
            </Link>
          </div>
          {!recruit ? (
            <EmptyState title="모집 상태가 설정되지 않았습니다" />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Badge tone={RECRUIT_TONE[recruit.status]}>
                  {RECRUIT_LABEL[recruit.status]}
                </Badge>
                {recruit.seatCount != null && (
                  <span className="text-xs font-bold text-muted">
                    잔여 {recruit.seatCount}석
                  </span>
                )}
              </div>
              {recruit.message && (
                <p className="text-sm text-ink-soft">{recruit.message}</p>
              )}
            </div>
          )}
        </Card>
      </div>

      <Card className="mb-6">
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

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-black tracking-tight">최근 변경</h2>
          <Link
            href="/admin/activity"
            className="flex min-h-11 items-center text-xs font-bold text-brand-700 hover:underline"
          >
            전체 보기
          </Link>
        </div>
        {recentActivity.length === 0 ? (
          <EmptyState title="최근 변경 이력이 없습니다" />
        ) : (
          <ul className="divide-y divide-line">
            {recentActivity.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <p className="min-w-0 truncate text-sm text-ink-soft">
                  {a.summary}
                </p>
                <span className="shrink-0 text-xs text-muted">
                  {formatKDateTime(a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
