import { getAdminSession } from "@/lib/auth/session";
import { hasDb, listSchedules, listStudents } from "@/lib/data/crm";
import { addKstDays, addKstMonths, kstDayStartUtc, kstMondayOf, kstTodayDateOnly } from "@/lib/kst";
import { validCalendarDate, validCalendarMonth } from "@/lib/admin-calendar";
import { CalendarWorkspace } from "@/components/admin/calendar/workspace";

export default async function SchedulesPage({ searchParams }: {
  searchParams: Promise<{ week?: string; view?: string; month?: string; student?: string; date?: string; day?: string }>;
}) {
  const query = await searchParams;
  const today = kstTodayDateOnly();
  const view = query.view === "month" ? "month" : "week";
  const requestedDate = validCalendarDate(query.date) ? query.date : today;
  const month = validCalendarMonth(query.month) ? query.month : requestedDate.slice(0, 7);
  const monday = kstMondayOf(validCalendarDate(query.week) ? query.week : requestedDate);
  const from = view === "month" ? `${month}-01` : monday;
  const to = view === "month" ? `${addKstMonths(month, 1)}-01` : addKstDays(monday, 7);
  const focusDate = requestedDate >= from && requestedDate < to ? requestedDate : from;
  const session = await getAdminSession();
  const [schedules, studentRows] = session ? await Promise.all([
    listSchedules(session.tenantId, { from: kstDayStartUtc(from)!.toISOString(), to: kstDayStartUtc(to)!.toISOString(), includeOverlapping: true }),
    listStudents(session.tenantId),
  ]) : [[], []];
  const students = studentRows.map(({ id, name, classType }) => ({ id, name, classType })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const studentId = students.some((student) => student.id === query.student) ? query.student! : "";
  const initialDay = validCalendarDate(query.day) && query.day >= from && query.day < to ? query.day : undefined;
  return <CalendarWorkspace schedules={schedules} students={students} studentId={studentId} view={view}
    focusDate={focusDate} from={from} to={to} today={today} initialDay={initialDay} connected={hasDb()} />;
}
