import Link from "next/link";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { ScheduleCreateForm } from "@/components/admin/calendar/schedule-create-form";
import { getAdminSession } from "@/lib/auth/session";
import { listStudents } from "@/lib/data/crm";
import { calendarHref, validCalendarDate, validCalendarTime } from "@/lib/admin-calendar";
import { kstTodayDateOnly } from "@/lib/kst";

export default async function NewSchedulePage({ searchParams }: {
  searchParams: Promise<{ student?: string; date?: string; time?: string; view?: string }>;
}) {
  const query = await searchParams;
  const session = await getAdminSession();
  const students = session ? (await listStudents(session.tenantId)).map(({ id, name, classType }) => ({ id, name, classType })) : [];
  const studentId = students.some((student) => student.id === query.student) ? query.student! : "";
  const date = validCalendarDate(query.date) ? query.date : kstTodayDateOnly();
  const time = validCalendarTime(query.time) ? query.time : "";
  const view = query.view === "month" ? "month" : "week";
  const returnHref = calendarHref({ view, date, studentId });
  return <div className="dash-page">
    <AdminPageHeader><h1>일정 신규 등록</h1><Link href={returnHref} className={buttonClass("ghost", "sm")}>캘린더로</Link></AdminPageHeader>
    <Card className="max-w-2xl"><ScheduleCreateForm students={students} initialStudentId={studentId} initialDate={date} initialTime={time} view={view} returnHref={returnHref} /></Card>
  </div>;
}
