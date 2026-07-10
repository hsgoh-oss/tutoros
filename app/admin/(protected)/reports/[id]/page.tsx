import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { formatKDate, getStudent } from "@/lib/data/crm";
import { getReport } from "@/lib/data/reports";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/form";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { ActionButton } from "@/components/admin/crm/action-button";
import {
  reportAudienceLabel,
  reportStatusLabel,
  reportStatusTone,
  reportTypeLabel,
} from "../constants";
import { approveReport, sendReport, updateReportContent } from "../actions";

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAdminSession();
  if (!session) notFound();

  const report = await getReport(session.tenantId, id);
  if (!report) notFound();

  const student = report.studentId ? await getStudent(session.tenantId, report.studentId) : null;
  const canSend =
    (report.status === "approved" || report.status === "failed") &&
    report.audience !== "internal";

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-xl font-black tracking-tight">
            {reportTypeLabel(report.type)} 리포트
            <Badge tone={reportStatusTone(report.status)}>{reportStatusLabel(report.status)}</Badge>
          </h1>
          <p className="mt-1 text-sm text-muted">
            {student?.name ?? "학생 미연결"} · {reportAudienceLabel(report.audience)} ·{" "}
            {report.depth === "deep" ? "심화" : "기본"} · {formatKDate(report.createdAt)} 생성
            {report.modelUsed && ` · ${report.modelUsed}`}
          </p>
        </div>
        <Link href="/admin/reports" className="text-sm font-bold text-muted hover:text-ink">
          ← 목록으로
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <h2 className="mb-3 text-sm font-black text-ink-soft">내용 미리보기 · 수정</h2>
            {report.status === "sent" ? (
              <div className="whitespace-pre-wrap rounded-panel bg-soft p-4 text-sm">
                {report.content}
              </div>
            ) : (
              <SubmitForm action={updateReportContent} submitLabel="저장">
                <input type="hidden" name="id" value={report.id} />
                <Textarea name="content" defaultValue={report.content} className="min-h-72" />
              </SubmitForm>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 text-sm font-black text-ink-soft">발송 처리</h2>
            <p className="mb-4 text-sm text-muted">
              초안을 검토한 뒤 승인하고, 승인된 리포트만 실제 발송할 수 있습니다.
            </p>
            <div className="flex flex-col items-start gap-3">
              {report.status === "draft" && (
                <ActionButton
                  action={approveReport}
                  id={report.id}
                  label="승인"
                  confirmText="이 리포트를 승인하시겠습니까?"
                />
              )}
              {report.audience === "internal" ? (
                <p className="text-xs text-muted">내부용 리포트는 발송 대상이 없습니다.</p>
              ) : canSend ? (
                <>
                  {report.status === "failed" && (
                    <p className="text-xs font-bold text-rose-600">
                      이전 발송이 실패했습니다. 다시 시도해 주세요.
                    </p>
                  )}
                  <ActionButton
                    action={sendReport}
                    id={report.id}
                    label="발송"
                    confirmText="실명 복원 후 발송합니다. 계속할까요?"
                  />
                </>
              ) : report.status === "sent" ? (
                <p className="text-xs text-muted">{formatKDate(report.sentAt)} 발송 완료</p>
              ) : (
                <p className="text-xs text-muted">승인 후 발송할 수 있습니다.</p>
              )}
            </div>
          </Card>

          {student && (
            <Card>
              <h2 className="mb-3 text-sm font-black text-ink-soft">연결 학생</h2>
              <Link
                href={`/admin/students/${student.id}`}
                className="text-sm font-bold text-brand-700 hover:underline"
              >
                {student.name} →
              </Link>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
