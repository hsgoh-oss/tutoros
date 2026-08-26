import { getAdminSession } from "@/lib/auth/session";
import { listStudentOptions } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { createGrade } from "../actions";
import { GradeFormFields } from "../grade-form-fields";

export default async function NewGradePage() {
  const session = await getAdminSession();
  const studentOptions = session ? await listStudentOptions(session.tenantId) : [];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">성적 신규 등록</h1>
        <p className="mt-1 text-sm text-muted">학생의 시험 성적을 등록합니다.</p>
      </div>

      <Card className="max-w-3xl">
        <SubmitForm action={createGrade} submitLabel="등록" redirectTo="/admin/grades">
          <GradeFormFields studentOptions={studentOptions} />
        </SubmitForm>
      </Card>
    </div>
  );
}
