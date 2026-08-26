import { Card } from "@/components/ui/card";
import { getAdminSession } from "@/lib/auth/session";
import { listStudentOptions } from "@/lib/data/crm";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { createLesson } from "../actions";
import { LessonFormFields } from "../lesson-form-fields";

export default async function NewLessonPage() {
  const session = await getAdminSession();
  const studentOptions = session ? await listStudentOptions(session.tenantId) : [];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">수업 기록 등록</h1>
        <p className="mt-1 text-sm text-muted">
          회차는 학생별 등록 순서에 따라 자동으로 계산됩니다.
        </p>
      </div>

      <Card className="max-w-3xl">
        <SubmitForm action={createLesson} submitLabel="등록" redirectTo="/admin/lessons">
          <LessonFormFields studentOptions={studentOptions} />
        </SubmitForm>
      </Card>
    </div>
  );
}
