import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { getGrade, listStudentOptions } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { ActionButton } from "@/components/admin/crm/action-button";
import { updateGrade, deleteGrade, generateExamReport } from "../actions";
import { GradeFormFields } from "../grade-form-fields";

export default async function GradeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAdminSession();
  if (!session) notFound();

  const grade = await getGrade(session.tenantId, id);
  if (!grade) notFound();

  const studentOptions = await listStudentOptions(session.tenantId);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black tracking-tight">{grade.examName}</h1>
          <p className="mt-1 text-sm text-muted">성적 정보를 수정하거나 삭제합니다.</p>
        </div>
        <Link
          href="/admin/grades"
          className="text-sm font-bold text-muted hover:text-ink"
        >
          ← 목록으로
        </Link>
      </div>

      <Card className="max-w-3xl">
        <SubmitForm action={updateGrade} submitLabel="저장">
          <input type="hidden" name="id" value={grade.id} />
          <GradeFormFields studentOptions={studentOptions} record={grade} />
        </SubmitForm>
        <div className="mt-6 flex flex-wrap items-center gap-5 border-t border-line pt-4">
          <ActionButton
            action={generateExamReport}
            id={grade.id}
            label="시험 리포트 생성"
            pendingLabel="생성 중..."
            confirmText="이 시험 성적으로 학부모용·학생용 리포트 초안을 생성하시겠습니까? (AI 참고용, 발송 전 검토 필요)"
            redirectTo={`/admin/reports?student=${grade.studentId}`}
          />
          <ActionButton
            action={deleteGrade}
            id={grade.id}
            label="성적 삭제"
            confirmText="이 성적 기록을 삭제하시겠습니까?"
            redirectTo="/admin/grades"
            tone="danger"
          />
        </div>
      </Card>
    </div>
  );
}
