import { AdminPageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/card";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { createStudent } from "../actions";
import { StudentFormFields } from "../student-form-fields";

export default function NewStudentPage() {
  return (
    <div className="dash-page">
      <AdminPageHeader>
        <h1 className="text-xl font-semibold tracking-tight">학생 신규 등록</h1>
        <p className="mt-1 text-sm text-muted">
          성인은 본인 연락처만 입력합니다. 미성년자는 보호자 연락처가 필요하며 학생 연락처는 선택입니다.
        </p>
      </AdminPageHeader>

      <Card className="max-w-3xl">
        <SubmitForm
          action={createStudent}
          submitLabel="등록"
          redirectTo="/admin/students"
        >
          <StudentFormFields />
        </SubmitForm>
      </Card>
    </div>
  );
}
