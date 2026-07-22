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
  SCHEDULE_STATUS_OPTIONS,
  classTypeLabel,
  scheduleStatusTone,
} from "./constants";
import { deleteSchedule, sendMakeupNotice, updateScheduleStatus } from "./actions";

// week 파라미터("YYYY-MM-DD")를 new Date()로 파싱하면 UTC 자정이 되어 저장 기준(로컬 시간 해석)과
// 어긋난다. 연/월/일을 직접 파싱해 로컬 Date로만 다뤄 저장·조회 기준을 통일한다.
function parseDateOnly(value: string | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

function toDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function mondayOf(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = monday.getDay(); // 0=일 ... 6=토
  const diff = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + diff);
  return monday;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

// month 파라미터는 "YYYY-MM". week와 같은 이유로 연/월을 직접 파싱해 로컬 Date로 다룬다.
function parseMonth(value: string | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m] = match;
  return new Date(Number(y), Number(m) - 1, 1);
}

function firstDayOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function toMonthOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function formatKMonth(date: Date): string {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
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
        <Link href="/admin/schedules/new" className={buttonClass("primary", "sm")}>
          신규 등록
        </Link>
      </div>

      {!connected && <DbBanner />}
    </>
  );

  if (view === "month") {
    const monthStart = parseMonth(monthParam) ?? firstDayOfMonth(new Date());
    const nextMonthStart = addMonths(monthStart, 1);
    const prevMonthStart = addMonths(monthStart, -1);
    const thisMonthStart = firstDayOfMonth(new Date());

    const schedules = session
      ? await listSchedules(session.tenantId, {
          from: monthStart.toISOString(),
          to: nextMonthStart.toISOString(),
        })
      : [];

    return (
      <div>
        {header}

        <Card className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {viewToggle}
            <span className="mx-1 h-5 w-px bg-line" />
            <Link
              href={`/admin/schedules?view=month&month=${toMonthOnly(prevMonthStart)}`}
              className={buttonClass("ghost", "sm")}
            >
              이전 달
            </Link>
            <Link
              href={`/admin/schedules?view=month&month=${toMonthOnly(thisMonthStart)}`}
              className={buttonClass("ghost", "sm")}
            >
              이번 달
            </Link>
            <Link
              href={`/admin/schedules?view=month&month=${toMonthOnly(nextMonthStart)}`}
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
  const monday = mondayOf(parseDateOnly(week) ?? new Date());
  const sunday = addDays(monday, 6);
  const nextMonday = addDays(monday, 7);
  const prevMonday = addDays(monday, -7);
  const thisMonday = mondayOf(new Date());

  const schedules = session
    ? await listSchedules(session.tenantId, {
        from: monday.toISOString(),
        to: nextMonday.toISOString(),
      })
    : [];

  return (
    <div>
      {header}

      <Card className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {viewToggle}
          <span className="mx-1 h-5 w-px bg-line" />
          <Link
            href={`/admin/schedules?week=${toDateOnly(prevMonday)}`}
            className={buttonClass("ghost", "sm")}
          >
            이전 주
          </Link>
          <Link
            href={`/admin/schedules?week=${toDateOnly(thisMonday)}`}
            className={buttonClass("ghost", "sm")}
          >
            이번 주
          </Link>
          <Link
            href={`/admin/schedules?week=${toDateOnly(nextMonday)}`}
            className={buttonClass("ghost", "sm")}
          >
            다음 주
          </Link>
        </div>
        <p className="text-sm font-bold text-ink-soft">
          {formatKDate(monday.toISOString())} ~ {formatKDate(sunday.toISOString())}
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
                        options={SCHEDULE_STATUS_OPTIONS}
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
