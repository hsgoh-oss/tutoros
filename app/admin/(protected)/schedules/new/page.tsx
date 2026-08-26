import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { getAdminSession } from "@/lib/auth/session";
import { listStudentOptions } from "@/lib/data/crm";
import { CLASS_TYPE_OPTIONS } from "../constants";
import { createSchedule } from "../actions";

export default async function NewSchedulePage() {
  const session = await getAdminSession();
  const students = session ? await listStudentOptions(session.tenantId) : [];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">일정 신규 등록</h1>
      </div>

      <Card className="max-w-3xl">
        <SubmitForm
          action={createSchedule}
          submitLabel="등록"
          redirectTo="/admin/schedules"
        >
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="학생" required>
              <Select name="studentId" defaultValue="">
                <option value="" disabled>
                  학생을 선택하세요
                </option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="일시" required>
              <Input type="datetime-local" name="scheduledAt" />
            </Field>

            <Field label="수업 방식">
              <Select name="classType" defaultValue="inperson">
                {CLASS_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </SubmitForm>
      </Card>
    </div>
  );
}
