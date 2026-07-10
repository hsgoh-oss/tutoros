import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import {
  formatKDate,
  formatWon,
  getStudent,
  getStudentSummary,
  listConsents,
} from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { updateStudent } from "../actions";
import { StudentFormFields } from "../student-form-fields";
import { classTypeLabel, studentStatusLabel, studentStatusTone } from "../constants";
import { consentItemLabel } from "../../consultations/constants";

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  draft: "작성 중",
  pending: "청구",
  paid: "완납",
  overdue: "미납",
};

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAdminSession();
  if (!session) notFound();

  const student = await getStudent(session.tenantId, id);
  if (!student) notFound();

  const [summary, consents] = await Promise.all([
    getStudentSummary(session.tenantId, id),
    listConsents(session.tenantId, "student", id),
  ]);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-xl font-black tracking-tight">
            {student.name}
            <Badge tone={studentStatusTone(student.status)}>
              {studentStatusLabel(student.status)}
            </Badge>
          </h1>
          <p className="mt-1 text-sm text-muted">
            {classTypeLabel(student.classType)}
            {student.subjectType && ` · ${student.subjectType}`} ·{" "}
            {formatKDate(student.createdAt)} 등록
          </p>
        </div>
        <Link
          href="/admin/students"
          className="text-sm font-bold text-muted hover:text-ink"
        >
          ← 목록으로
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <h2 className="mb-4 text-sm font-black text-ink-soft">기본 정보</h2>
            <SubmitForm action={updateStudent} submitLabel="저장">
              <input type="hidden" name="id" value={student.id} />
              <StudentFormFields student={student} />
            </SubmitForm>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-black text-ink-soft">최근 수업 기록</h2>
              <Link
                href={`/admin/lessons?student=${student.id}`}
                className="text-xs font-bold text-brand-700 hover:underline"
              >
                전체 보기 →
              </Link>
            </div>
            {summary.lessons.length === 0 ? (
              <p className="text-sm text-muted">수업 기록이 없습니다.</p>
            ) : (
              <ul className="space-y-3">
                {summary.lessons.map((l) => (
                  <li
                    key={l.id}
                    className="border-b border-line pb-3 last:border-0 last:pb-0"
                  >
                    <p className="text-sm font-bold">
                      {l.sessionNumber}회차 · {formatKDate(l.lessonDate)}
                      {l.absent && (
                        <Badge tone="danger" className="ml-2">
                          결석
                        </Badge>
                      )}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted">{l.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-black text-ink-soft">최근 성적</h2>
              <Link
                href={`/admin/grades?student=${student.id}`}
                className="text-xs font-bold text-brand-700 hover:underline"
              >
                전체 보기 →
              </Link>
            </div>
            {summary.grades.length === 0 ? (
              <p className="text-sm text-muted">성적 기록이 없습니다.</p>
            ) : (
              <ul className="space-y-3">
                {summary.grades.map((g) => (
                  <li
                    key={g.id}
                    className="flex items-center justify-between border-b border-line pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm font-bold">{g.examName}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {formatKDate(g.examDate)}
                      </p>
                    </div>
                    <p className="text-sm font-extrabold">
                      {g.grade ? `${g.grade}등급` : g.rawScore != null ? `${g.rawScore}점` : "-"}
                      {g.percentile != null && (
                        <span className="ml-1 text-xs font-bold text-muted">
                          백분위 {g.percentile}
                        </span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-black text-ink-soft">최근 결제</h2>
              <Link
                href={`/admin/payments?student=${student.id}`}
                className="text-xs font-bold text-brand-700 hover:underline"
              >
                전체 보기 →
              </Link>
            </div>
            {summary.payments.length === 0 ? (
              <p className="text-sm text-muted">결제 내역이 없습니다.</p>
            ) : (
              <ul className="space-y-3">
                {summary.payments.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between border-b border-line pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm font-bold">{formatWon(p.amount)}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {formatKDate(p.periodStart)}~{formatKDate(p.periodEnd)}
                      </p>
                    </div>
                    <Badge tone={p.status === "paid" ? "success" : p.status === "overdue" ? "danger" : "soft"}>
                      {PAYMENT_STATUS_LABEL[p.status] ?? p.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-black text-ink-soft">AI 리포트</h2>
              <Link
                href={`/admin/reports?student=${student.id}`}
                className="text-xs font-bold text-brand-700 hover:underline"
              >
                전체 보기 →
              </Link>
            </div>
            <Link
              href={`/admin/reports/new?student=${student.id}`}
              className="text-sm font-bold text-brand-700 hover:underline"
            >
              + 새 리포트 생성
            </Link>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-black text-ink-soft">동의 내역</h2>
            {consents.length === 0 ? (
              <p className="text-sm text-muted">기록된 동의 내역이 없습니다.</p>
            ) : (
              <ul className="space-y-3">
                {consents.map((c) => (
                  <li
                    key={c.id}
                    className="border-b border-line pb-3 last:border-0 last:pb-0"
                  >
                    <p className="text-sm font-bold">{consentItemLabel(c.item)}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {formatKDate(c.consentedAt)} · {c.policyVersion} · {c.via}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {student.notionPageId && (
            <Card>
              <h2 className="mb-2 text-sm font-black text-ink-soft">Notion 연동</h2>
              <p className="text-xs text-muted">
                연결된 페이지: {student.notionPageId}
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
