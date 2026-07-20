import { getAdminSession } from "@/lib/auth/session";
import { listStudentOptions, listLessons, formatKDate } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { uploadMaterial } from "../actions";

export default async function NewMaterialPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string; lesson?: string }>;
}) {
  const { student: selectedStudentId = "", lesson: selectedLessonId = "" } =
    await searchParams;
  const session = await getAdminSession();
  const students = session ? await listStudentOptions(session.tenantId) : [];
  // 특정 학생이 지정된 경우에만 그 학생의 수업 회차를 불러와 자료를 특정 회차에 연결할 수 있게 한다.
  const lessons =
    session && selectedStudentId
      ? await listLessons(session.tenantId, selectedStudentId)
      : [];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-black tracking-tight">자료 업로드</h1>
        <p className="mt-1 text-sm text-muted">
          특정 학생 또는 전체 공유 자료를 업로드합니다. (pdf·jpg·png·webp, 10MB 이하)
        </p>
      </div>

      <Card className="max-w-2xl">
        <SubmitForm
          action={uploadMaterial}
          submitLabel="업로드"
          redirectTo="/admin/materials"
        >
          <div className="grid gap-5">
            <Field label="자료명" required>
              <Input name="name" placeholder="1강 개념정리.pdf" />
            </Field>

            <Field label="파일" required hint="pdf, jpg, png, webp / 10MB 이하">
              <Input
                type="file"
                name="file"
                required
                accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                className="file:mr-4 file:cursor-pointer file:rounded-full file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-bold file:text-brand-700"
              />
            </Field>

            <Field label="대상 학생" hint="선택하지 않으면 전체 공유 자료로 등록됩니다">
              <Select name="studentId" defaultValue={selectedStudentId}>
                <option value="">전체 공유</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="연결할 수업"
              hint="특정 회차에 첨부하려면 선택하세요 (대상 학생 지정 시 표시)"
            >
              <Select name="lessonId" defaultValue={selectedLessonId}>
                <option value="">미연결</option>
                {lessons.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.sessionNumber}회차 · {formatKDate(l.lessonDate)}
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
