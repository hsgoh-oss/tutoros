import { getAdminSession } from "@/lib/auth/session";
import { listLessons, listStudentOptions } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { createAssignment } from "../actions";
import { HomeworkFormFields } from "../homework-form-fields";

// 최근 수업 목록 상한 — 원 수업 연결 select 용(전 학생 최신순).
const RECENT_LESSON_LIMIT = 60;

export default async function NewHomeworkPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const { student } = await searchParams;
  const session = await getAdminSession();
  const [studentOptions, lessons] = session
    ? await Promise.all([
        listStudentOptions(session.tenantId),
        listLessons(session.tenantId),
      ])
    : [[], []];
  const lessonOptions = lessons.slice(0, RECENT_LESSON_LIMIT).map((l) => ({
    id: l.id,
    studentId: l.studentId,
    label: `${l.lessonDate} ${l.sessionNumber}회차 — ${l.studentName}`,
  }));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">과제 초안 만들기</h1>
        <p className="mt-1 text-sm text-muted">
          초안은 학생·보호자에게 노출되지 않습니다. 상세 화면에서 검토한 뒤 배부하면 알림이 나갑니다.
        </p>
      </div>

      <Card className="max-w-3xl">
        <SubmitForm
          action={createAssignment}
          submitLabel="초안 저장"
          redirectTo="/admin/homework"
        >
          <HomeworkFormFields
            studentOptions={studentOptions}
            lessonOptions={lessonOptions}
            defaults={{ studentId: student }}
          />
        </SubmitForm>
      </Card>
    </div>
  );
}
