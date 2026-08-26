import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import {
  kstDayRangeUtc,
  kstDayStartUtc,
  kstTodayDateOnly,
  kstWeekRangeUtc,
} from "@/lib/kst";
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
import {
  listOpenWorkItems,
  type WorkItem,
  type WorkItemPriority,
} from "@/lib/data/work";
import type { Dday, RecruitState, RecruitStatus, Student } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import { WorkItemActions } from "@/components/admin/work-item-actions";
import { resolveWorkItemAction } from "./actions";
import {
  consultationStatusLabel,
  consultationStatusTone,
} from "../consultations/constants";
import { scheduleStatusLabel, scheduleStatusTone } from "../schedules/constants";

type BadgeTone = "brand" | "soft" | "success" | "warning" | "danger";

// 이번 주 월요일 00:00 ~ 다음 주 월요일 00:00 (KST 기준 — lib/kst.ts 규약).
// 서버가 UTC라 로컬 Date 산술로 잡으면 KST 00~09시에 주·일 경계가 하루 앞으로 밀려
// 아침 수업이 "오늘 수업"에서 통째로 빠진다.
const currentWeekRange = kstWeekRangeUtc;
const todayRange = kstDayRangeUtc;

// examDate("YYYY-MM-DD") 기준 남은 일수 — KST 자정 기준(시험은 한국 시험이다).
// 로컬(=UTC) 자정으로 세면 KST 00~09시에 하루 더 많게 나와, 같은 시각 공개 배너와 D-day가 갈렸다.
function daysUntil(dateStr: string): number {
  const start = kstDayStartUtc(kstTodayDateOnly());
  const target = kstDayStartUtc(dateStr);
  if (!start || !target) return 0;
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

// 오늘 업무 우선순위 라벨·톤 — risk·money·privacy는 강조 톤으로 구분한다.
const WORK_PRIORITY_LABEL: Record<WorkItemPriority, string> = {
  risk: "위험",
  money: "금전",
  privacy: "개인정보",
  normal: "일반",
};

const WORK_PRIORITY_TONE: Record<WorkItemPriority, BadgeTone> = {
  risk: "danger",
  money: "warning",
  privacy: "brand",
  normal: "soft",
};

// 업무 원본 딥링크 — source_type별로 사건을 확인할 화면으로 보낸다.
// (notification은 큐 id로 학생 상세를 특정할 수 없어 메시지 이력으로 이동.)
function workSourceHref(item: WorkItem): string | null {
  switch (item.sourceType) {
    case "ai_report":
    case "report":
      return item.sourceId ? `/admin/reports/${item.sourceId}` : "/admin/reports";
    case "notification":
    case "notify_queue":
      return "/admin/messages";
    case "cron":
    case "automation_run":
      return "/admin/schedules";
    default:
      return null;
  }
}

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
  let openWork: WorkItem[] = [];

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
      openWork,
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
      listOpenWorkItems(session.tenantId),
    ]);
  }

  const recent = recentConsultations.slice(0, 5);
  const visibleDdays = ddays.filter((d) => d.isVisible);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">대시보드</h1>
      </div>

      {!connected && <DbBanner />}

      <Card className="mb-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">오늘 업무</h2>
          <span className="text-xs font-bold text-muted">
            열린 업무 {openWork.length}건
          </span>
        </div>
        {openWork.length === 0 ? (
          <EmptyState
            title="처리할 업무가 없습니다"
            description="발송 실패·자동화 오류 등 사람 손이 필요한 일감이 이곳에 모입니다."
          />
        ) : (
          <ul className="divide-y divide-line">
            {openWork.map((w) => {
              const href = workSourceHref(w);
              return (
                <li
                  key={w.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge tone={WORK_PRIORITY_TONE[w.priority]}>
                        {WORK_PRIORITY_LABEL[w.priority]}
                      </Badge>
                      {w.status === "in_progress" && (
                        <Badge tone="soft">진행 중</Badge>
                      )}
                      <p className="truncate text-sm font-bold text-ink">
                        {w.title}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      다음 행동: {w.nextAction}
                      <span className="mx-1.5">·</span>
                      {formatKDateTime(w.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {href && (
                      <Link
                        href={href}
                        className="text-xs font-bold text-brand-700 hover:underline"
                      >
                        원본 보기
                      </Link>
                    )}
                    <WorkItemActions id={w.id} resolveAction={resolveWorkItemAction} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/admin/consultations">
          <Card className="h-full px-4 py-3.5 transition-colors hover:border-brand-200">
            <p className="text-xs font-medium text-muted">신규 상담</p>
            <p className="mt-1.5 text-xl font-semibold tracking-tight text-ink">
              {newConsultations.length}건
            </p>
          </Card>
        </Link>
        <Link href="/admin/students">
          <Card className="h-full px-4 py-3.5 transition-colors hover:border-brand-200">
            <p className="text-xs font-medium text-muted">재원 학생</p>
            <p className="mt-1.5 text-xl font-semibold tracking-tight text-ink">
              {activeStudents.length}명
            </p>
          </Card>
        </Link>
        <Link href="/admin/schedules">
          <Card className="h-full px-4 py-3.5 transition-colors hover:border-brand-200">
            <p className="text-xs font-medium text-muted">이번 주 일정</p>
            <p className="mt-1.5 text-xl font-semibold tracking-tight text-ink">
              {weekSchedules.length}건
            </p>
          </Card>
        </Link>
        <Link href="/admin/payments">
          <Card className="h-full px-4 py-3.5 transition-colors hover:border-brand-200">
            <p className="text-xs font-medium text-muted">이번 달 완납 / 미납</p>
            <p className="mt-2 text-lg font-semibold tracking-tight text-ink">
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
            <h2 className="text-sm font-semibold tracking-tight">오늘 수업</h2>
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
            <h2 className="text-sm font-semibold tracking-tight">청구 필요 (D-3)</h2>
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
                    <span className="shrink-0 text-sm font-semibold tracking-tight text-ink">
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
            <h2 className="text-sm font-semibold tracking-tight">D-day</h2>
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
                  <span className="shrink-0 text-sm font-semibold tracking-tight text-brand-600">
                    {ddayLabel(d.examDate)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight">모집 상태</h2>
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
          <h2 className="text-sm font-semibold tracking-tight">최근 상담</h2>
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
          <h2 className="text-sm font-semibold tracking-tight">최근 변경</h2>
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
