import { AdminPageHeader } from "@/components/admin/page-header";
import Link from "next/link";
import { CalendarDays, Plus } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { ConsultationChart } from "@/components/admin/consultation-chart";
import { getAdminSession } from "@/lib/auth/session";
import {
  kstDayRangeUtc,
  addKstDays,
  kstDateOnly,
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
import type { ReactNode } from "react";
import { SummaryRow } from "@/components/admin/crm/summary-row";
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
      // 발송 현황의 '실패' 필터로 바로 보낸다 — 업무 카드가 올라오는 이유가 실패이고,
      // 전체 목록으로 보내면 운영자가 다시 필터를 눌러야 한다.
      return "/admin/messages?status=failed";
    case "cron":
    case "automation_run":
      return "/admin/schedules";
    // 후기·사례 제출(00025) — 검토 화면으로 바로.
    case "review":
      return item.sourceId ? `/admin/reviews/${item.sourceId}` : "/admin/reviews";
    case "review_invitation":
      return "/admin/reviews";
    // 후기 요청 후보(크론) — source_id가 학생이다.
    case "review_request":
      return item.sourceId ? `/admin/students/${item.sourceId}` : "/admin/students";
    case "homework_assignment":
      return item.sourceId ? `/admin/homework/${item.sourceId}` : "/admin/homework";
    case "homework_question":
      return "/admin/homework";
    // 신청폼 제출 — 폼 id로 상담을 특정하는 조회가 없어 목록으로 보낸다(제출 순 정렬).
    case "intake_form":
      return "/admin/consultations";
    case "backup_restore":
      return "/admin/activity";
    default:
      return null;
  }
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range } = await searchParams;
  const rangeDays = range === "7" ? 7 : range === "30" ? 30 : 14;
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
      // 관리자 로그인 기록은 변경이 아니다 — 대시보드의 '최근 변경'에서는 걸러 실제 변경만 8건 보여 준다
      // (전체 이력은 /admin/activity). 넉넉히 읽어 거른 뒤 자른다.
      listActivity(session.tenantId, 30).then((rows) =>
        rows.filter((a) => a.action !== "admin_login").slice(0, 8),
      ),
      listOpenWorkItems(session.tenantId),
    ]);
  }

  const recent = recentConsultations.slice(0, 5);
  const visibleDdays = ddays.filter((d) => d.isVisible);
  const today = kstTodayDateOnly();
  const dayCounts = new Map<string, number>();
  for (const consultation of recentConsultations) {
    const day = kstDateOnly(consultation.createdAt);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }
  const points = Array.from({ length: rangeDays }, (_, index) => {
    const date = addKstDays(today, index - rangeDays + 1);
    return { date, count: dayCounts.get(date) ?? 0 };
  });

  return (
    <div className="dash-page">
      <AdminPageHeader>
        <h1 className="text-xl font-semibold tracking-tight">대시보드</h1>
        <Link href="/admin/students/new" className={buttonClass("primary", "sm")}><Plus size={16} aria-hidden="true" /> 학생 등록</Link>
      </AdminPageHeader>

      <div className="dash-overview-toolbar">
        <span className="flex items-center gap-2 text-[13px] text-ink-soft"><CalendarDays size={17} aria-hidden="true" />{formatKDate(points[0].date)} – {formatKDate(today)}</span>
        <nav className="dash-range-links" aria-label="상담 추이 기간">
          {[7, 14, 30].map((days) => <Link key={days} href={`/admin/dashboard?range=${days}`} aria-current={rangeDays === days ? "page" : undefined}>{days}일</Link>)}
        </nav>
      </div>

      {!connected && <DbBanner />}

      <SummaryRow items={[
        { icon: "consult", label: "신규 상담", value: `${newConsultations.length}건`, href: "/admin/consultations?status=new" },
        { icon: "student", label: "재원 학생", value: `${activeStudents.length}명`, href: "/admin/students?status=active" },
        { icon: "schedule", label: "이번 주 일정", value: `${weekSchedules.length}건`, href: "/admin/schedules?view=week" },
        {
          icon: "payment",
          label: "이번 달 완납",
          value: formatWon(paymentSummary.paidThisMonth),
          href: "/admin/payments",
          detail: <span className={paymentSummary.overdueTotal > 0 ? "text-rose-700" : undefined}>미납 {formatWon(paymentSummary.overdueTotal)}</span>,
        },
      ]} />

      <div className="mt-6"><ConsultationChart key={rangeDays} points={points} connected={connected} /></div>

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="min-w-0 space-y-6">
          <DashboardSection title="오늘 업무" meta={`${openWork.length}건`}>
            {openWork.length === 0 ? (
              <EmptyState compact title="처리할 업무가 없습니다" />
            ) : (
              <ul className="divide-y divide-line">
                {openWork.map((w) => {
                  const href = workSourceHref(w);
                  return (
                    <li key={w.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <Badge tone={WORK_PRIORITY_TONE[w.priority]}>{WORK_PRIORITY_LABEL[w.priority]}</Badge>
                        {w.status === "in_progress" && <Badge tone="soft">진행 중</Badge>}
                        <span className="text-xs text-muted">{formatKDateTime(w.createdAt)}</span>
                      </div>
                      {href ? (
                        <Link href={href} className="text-sm font-semibold text-ink hover:underline">{w.title}</Link>
                      ) : (
                        <p className="text-sm font-semibold text-ink">{w.title}</p>
                      )}
                      <p className="mt-1 text-xs leading-relaxed text-muted">{w.nextAction}</p>
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4">
                        {href && <Link href={href} className="inline-flex min-h-11 items-center text-xs text-ink-soft underline underline-offset-4">내용 확인</Link>}
                        <WorkItemActions id={w.id} resolveAction={resolveWorkItemAction} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </DashboardSection>

          <DashboardSection title="오늘 수업" href="/admin/schedules" linkLabel="수업 캘린더">
            {todaySchedules.length === 0 ? (
              <EmptyState compact title="오늘 예정된 수업이 없습니다" />
            ) : (
              <ul className="divide-y divide-line">
                {todaySchedules.map((s) => (
                  <li key={s.id}>
                    <Link href={`/admin/schedules/${s.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-soft">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">{s.studentName}</p>
                        <p className="mt-1 text-xs text-muted">{formatKDateTime(s.scheduledAt)}</p>
                      </div>
                      <Badge tone={scheduleStatusTone(s.status)}>{scheduleStatusLabel(s.status)}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </DashboardSection>

          <DashboardSection title="최근 상담" href="/admin/consultations">
            {recent.length === 0 ? (
              <EmptyState compact title="상담 신청이 없습니다" />
            ) : (
              <TableWrap>
                <Table className="!min-w-120">
                  <thead><tr><Th>이름</Th><Th>연락처</Th><Th>신청일</Th><Th>상태</Th></tr></thead>
                  <tbody>
                    {recent.map((c) => (
                      <tr key={c.id}>
                        <Td><Link href={`/admin/consultations/${c.id}`} className="font-medium text-ink hover:underline">{c.name}</Link></Td>
                        <Td className="whitespace-nowrap">{c.phone}</Td>
                        <Td className="whitespace-nowrap">{formatKDate(c.createdAt)}</Td>
                        <Td><Badge tone={consultationStatusTone(c.status)}>{consultationStatusLabel(c.status)}</Badge></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </DashboardSection>
        </div>

        <div className="min-w-0 space-y-6">
          <DashboardSection title="청구 필요" href="/admin/payments" linkLabel="결제 관리" meta="3일 이내 마감">
            {duePayments.length === 0 ? (
              <EmptyState compact title="3일 이내 마감되는 청구가 없습니다" />
            ) : (
              <ul className="divide-y divide-line">
                {duePayments.map((p) => (
                  <li key={p.id}>
                    <Link href={`/admin/payments/${p.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-soft">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">{p.studentName}</p>
                        <p className="mt-1 text-xs text-muted">마감 {formatKDate(p.dueDate)}</p>
                      </div>
                      <span className="shrink-0 text-sm font-medium tabular-nums">{formatWon(p.amount)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </DashboardSection>

          <DashboardSection title="D-day" href="/admin/dday" linkLabel="입시 캘린더">
            {visibleDdays.length === 0 ? (
              <EmptyState compact title="등록된 입시 일정이 없습니다" />
            ) : (
              <ul className="divide-y divide-line">
                {visibleDdays.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm text-ink">{d.name}</p>
                      <p className="mt-1 text-xs text-muted">{formatKDate(d.examDate)}</p>
                    </div>
                    <span className="shrink-0 text-sm font-medium tabular-nums">{ddayLabel(d.examDate)}</span>
                  </li>
                ))}
              </ul>
            )}
          </DashboardSection>

          <DashboardSection title="모집 상태" href="/admin/recruit" linkLabel="모집 관리">
            {!recruit ? (
              <EmptyState compact title="모집 상태가 설정되지 않았습니다" />
            ) : (
              <div>
                <div className="flex items-center gap-2">
                  <Badge tone={RECRUIT_TONE[recruit.status]}>{RECRUIT_LABEL[recruit.status]}</Badge>
                  {recruit.seatCount != null && <span className="text-sm text-muted">잔여 {recruit.seatCount}석</span>}
                </div>
                {recruit.message && <p className="mt-3 text-sm leading-relaxed text-ink-soft">{recruit.message}</p>}
              </div>
            )}
          </DashboardSection>

          <DashboardSection title="최근 변경" href="/admin/activity">
            {recentActivity.length === 0 ? (
              <EmptyState compact title="최근 변경 이력이 없습니다" />
            ) : (
              <ul className="divide-y divide-line">
                {recentActivity.slice(0, 5).map((a) => (
                  <li key={a.id} className="py-3 first:pt-0 last:pb-0">
                    <p className="text-sm leading-relaxed text-ink-soft">{a.summary}</p>
                    <p className="mt-1 text-xs text-muted">{formatKDateTime(a.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </DashboardSection>
        </div>
      </div>
    </div>
  );
}

function DashboardSection({ title, meta, href, linkLabel = "전체 보기", children }: {
  title: string;
  meta?: string;
  href?: string;
  linkLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className="dash-section">
      <div className="dash-section-heading">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          {meta && <span className="text-xs text-muted">{meta}</span>}
        </div>
        {href && <Link href={href} className="inline-flex min-h-11 items-center text-xs text-muted hover:text-ink hover:underline">{linkLabel}</Link>}
      </div>
      <div className="dash-section-body">{children}</div>
    </section>
  );
}
