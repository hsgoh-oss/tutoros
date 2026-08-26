import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { hasDb, listSchedules, formatKDate, formatKDateTime } from "@/lib/data/crm";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import { InlineSelect } from "@/components/admin/crm/inline-select";
import { ActionButton } from "@/components/admin/crm/action-button";
import { ScheduleCalendar } from "@/components/admin/schedule-calendar";
import {
  addKstDays,
  addKstMonths,
  kstDayStartUtc,
  kstMondayOf,
  kstTodayDateOnly,
} from "@/lib/kst";
import {
  MANUAL_SCHEDULE_STATUS_OPTIONS,
  classTypeLabel,
  scheduleStatusTone,
} from "./constants";
import { deleteSchedule, sendMakeupNotice, updateScheduleStatus } from "./actions";

// 주·월 네비게이션은 **KST 달력 문자열**("YYYY-MM-DD" / "YYYY-MM")로만 다룬다.
// Date 객체로 다루면 서버(UTC)에서 로컬 조각을 읽게 되어 KST 00~09시 회차가 이전 주·월로 새어
// 나간다. 조회 구간만 마지막에 KST 자정 → UTC instant로 옮긴다(lib/kst.ts).

function parseDateOnly(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function parseMonth(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return null;
  return value;
}

function monthOf(dateOnly: string): string {
  return dateOnly.slice(0, 7);
}

function formatKMonth(monthOnly: string): string {
  const [y, m] = monthOnly.split("-");
  return `${Number(y)}년 ${Number(m)}월`;
}

/** KST 달력 문자열 구간 → 조회용 UTC ISO 구간. */
function rangeUtc(fromDateOnly: string, toDateOnly: string): { from: string; to: string } {
  return {
    from: kstDayStartUtc(fromDateOnly)!.toISOString(),
    to: kstDayStartUtc(toDateOnly)!.toISOString(),
  };
}

export default async function SchedulesPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; view?: string; month?: string }>;
}) {
  const { week, view: viewParam, month: monthParam } = await searchParams;
  const view: "week" | "month" = viewParam === "month" ? "month" : "week";

  const session = await getAdminSession();
  const connected = hasDb();

  // 주간 ↔ 월간 뷰 토글 (양쪽 뷰에서 공용)
  const viewToggle = (
    <div className="flex items-center gap-1">
      <Link
        href="/admin/schedules?view=week"
        className={buttonClass(view === "week" ? "primary" : "ghost", "sm")}
      >
        주간
      </Link>
      <Link
        href="/admin/schedules?view=month"
        className={buttonClass(view === "month" ? "primary" : "ghost", "sm")}
      >
        월간
      </Link>
    </div>
  );

  const header = (
    <>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black tracking-tight">일정 관리</h1>
          <p className="mt-1 text-sm text-muted">
            {view === "month"
              ? "월간 달력에서 수업 일정을 한눈에 확인합니다."
              : "주간 수업 일정을 확인하고 상태를 관리합니다."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/schedules/export" className={buttonClass("outline", "sm")}>
            내보내기
          </Link>
          <Link href="/admin/schedules/new" className={buttonClass("primary", "sm")}>
            신규 등록
          </Link>
        </div>
      </div>

      {!connected && <DbBanner />}
    </>
  );

  if (view === "month") {
    const monthStart = parseMonth(monthParam) ?? monthOf(kstTodayDateOnly());
    const nextMonthStart = addKstMonths(monthStart, 1);
    const prevMonthStart = addKstMonths(monthStart, -1);
    const thisMonthStart = monthOf(kstTodayDateOnly());

    const schedules = session
      ? await listSchedules(
          session.tenantId,
          rangeUtc(`${monthStart}-01`, `${nextMonthStart}-01`),
        )
      : [];

    return (
      <div>
        {header}

        <Card className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {viewToggle}
            <span className="mx-1 h-5 w-px bg-line" />
            <Link
              href={`/admin/schedules?view=month&month=${prevMonthStart}`}
              className={buttonClass("ghost", "sm")}
            >
              이전 달
            </Link>
            <Link
              href={`/admin/schedules?view=month&month=${thisMonthStart}`}
              className={buttonClass("ghost", "sm")}
            >
              이번 달
            </Link>
            <Link
              href={`/admin/schedules?view=month&month=${nextMonthStart}`}
              className={buttonClass("ghost", "sm")}
            >
              다음 달
            </Link>
          </div>
          <p className="text-sm font-bold text-ink-soft">{formatKMonth(monthStart)}</p>
        </Card>

        <ScheduleCalendar schedules={schedules} month={monthStart} />
      </div>
    );
  }

  // 주간 뷰 (기본)
  const monday = kstMondayOf(parseDateOnly(week) ?? kstTodayDateOnly());
  const sunday = addKstDays(monday, 6);
  const nextMonday = addKstDays(monday, 7);
  const prevMonday = addKstDays(monday, -7);
  const thisMonday = kstMondayOf(kstTodayDateOnly());

  const schedules = session
    ? await listSchedules(session.tenantId, rangeUtc(monday, nextMonday))
    : [];

  return (
    <div>
      {header}

      <Card className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {viewToggle}
          <span className="mx-1 h-5 w-px bg-line" />
          <Link
            href={`/admin/schedules?week=${prevMonday}`}
            className={buttonClass("ghost", "sm")}
          >
            이전 주
          </Link>
          <Link
            href={`/admin/schedules?week=${thisMonday}`}
            className={buttonClass("ghost", "sm")}
          >
            이번 주
          </Link>
          <Link
            href={`/admin/schedules?week=${nextMonday}`}
            className={buttonClass("ghost", "sm")}
          >
            다음 주
          </Link>
        </div>
        <p className="text-sm font-bold text-ink-soft">
          {formatKDate(monday)} ~ {formatKDate(sunday)}
        </p>
      </Card>

      {schedules.length === 0 ? (
        <EmptyState
          title="등록된 일정이 없습니다"
          description="신규 등록 버튼으로 수업 일정을 추가할 수 있습니다."
          action={
            <Link href="/admin/schedules/new" className={buttonClass("outline", "sm")}>
              신규 등록
            </Link>
          }
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>일시</Th>
                <Th>학생명</Th>
                <Th>방식</Th>
                <Th>상태</Th>
                <Th>알림 발송</Th>
                <Th>관리</Th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id}>
                  <Td>{formatKDateTime(s.scheduledAt)}</Td>
                  <Td className="font-bold text-ink">{s.studentName}</Td>
                  <Td>{classTypeLabel(s.classType)}</Td>
                  <Td>
                    <Badge tone={scheduleStatusTone(s.status)}>
                      <InlineSelect
                        action={updateScheduleStatus}
                        id={s.id}
                        value={s.status}
                        options={MANUAL_SCHEDULE_STATUS_OPTIONS}
                        className="border-none bg-transparent p-0 text-xs font-bold"
                      />
                    </Badge>
                  </Td>
                  <Td>
                    <Badge tone={s.reminderSent ? "success" : "soft"}>
                      {s.reminderSent ? "발송" : "미발송"}
                    </Badge>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-3">
                      {s.status === "makeup" && (
                        <ActionButton
                          action={sendMakeupNotice}
                          id={s.id}
                          label="보강 안내"
                          confirmText="보강 안내를 학부모에게 발송하시겠습니까?"
                        />
                      )}
                      <ActionButton
                        action={deleteSchedule}
                        id={s.id}
                        label="삭제"
                        confirmText="이 일정을 삭제하시겠습니까?"
                        tone="danger"
                      />
                    </div>
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
