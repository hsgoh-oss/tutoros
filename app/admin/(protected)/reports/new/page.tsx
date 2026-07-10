import { getAdminSession } from "@/lib/auth/session";
import { listStudentOptions } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { createReport } from "../actions";
import { ReportFormFields } from "../report-form-fields";

export default async function NewReportPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const { student } = await searchParams;
  const session = await getAdminSession();
  const studentOptions = session ? await listStudentOptions(session.tenantId) : [];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-black tracking-tight">AI 리포트 생성</h1>
        <p className="mt-1 text-sm text-muted">
          학생의 최근 수업·성적 기록을 바탕으로 AI 초안을 생성합니다. 실명은 AI에 전달되지 않습니다.
        </p>
      </div>

      <Card className="max-w-3xl">
        <SubmitForm action={createReport} submitLabel="생성" redirectTo="/admin/reports">
          <ReportFormFields studentOptions={studentOptions} defaultStudentId={student} />
        </SubmitForm>
      </Card>
    </div>
  );
}
