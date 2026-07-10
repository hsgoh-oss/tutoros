import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { getLesson, getStudent, formatKDate } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { ActionButton } from "@/components/admin/crm/action-button";
import { updateLesson, deleteLesson } from "../actions";
import { LessonFormFields } from "../lesson-form-fields";

export default async function LessonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAdminSession();
  if (!session) notFound();

  const lesson = await getLesson(session.tenantId, id);
  if (!lesson) notFound();

  const student = await getStudent(session.tenantId, lesson.studentId);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black tracking-tight">
            {student?.name ?? "알 수 없음"} · {lesson.sessionNumber}회차
          </h1>
          <p className="mt-1 text-sm text-muted">{formatKDate(lesson.lessonDate)} 수업</p>
        </div>
        <Link
          href="/admin/lessons"
          className="text-sm font-bold text-muted hover:text-ink"
        >
          ← 목록으로
        </Link>
      </div>

      <Card className="max-w-3xl">
        <SubmitForm action={updateLesson} submitLabel="저장">
          <input type="hidden" name="id" value={lesson.id} />
          <LessonFormFields lesson={lesson} studentName={student?.name ?? "알 수 없음"} />
        </SubmitForm>

        <div className="mt-4 border-t border-line pt-4">
          <ActionButton
            action={deleteLesson}
            id={lesson.id}
            label="수업 기록 삭제"
            tone="danger"
            confirmText="이 수업 기록을 삭제하시겠습니까? 되돌릴 수 없습니다."
            redirectTo="/admin/lessons"
          />
        </div>
      </Card>
    </div>
  );
}
