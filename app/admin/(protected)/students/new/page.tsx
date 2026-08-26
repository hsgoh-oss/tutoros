import { Card } from "@/components/ui/card";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { createStudent } from "../actions";
import { StudentFormFields } from "../student-form-fields";

export default function NewStudentPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">학생 신규 등록</h1>
        <p className="mt-1 text-sm text-muted">
          학생 연락처는 선택 항목이며, 입력 시 수집 동의 확인이 필요합니다.
        </p>
      </div>

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
