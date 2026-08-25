import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { formatKDate, hasDb } from "@/lib/data/crm";
import { listAssignments, listOpenQuestions } from "@/lib/data/homework";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import { FilterChips } from "@/components/admin/crm/filter-chips";
import {
  HOMEWORK_STATUS_OPTIONS,
  homeworkStatusLabel,
  homeworkStatusTone,
  isHomeworkStatus,
} from "./constants";

// 과제 목록 — 상태 필터 칩 + 미검토 제출 수 배지(검수 126 판정 근거) + 열린 질문 수(검수 29).
// draft(비노출 초안)도 관리자에게는 전부 보인다 — 노출 판정은 포털 조회가 수행한다(H-01).

export default async function HomeworkPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; student?: string }>;
}) {
  const { status, student } = await searchParams;
  const session = await getAdminSession();
  const connected = hasDb();
  const [assignments, openQuestions] = session
    ? await Promise.all([
        listAssignments(session.tenantId, {
          // 보관(archived)은 상태가 아니라 보관 마커 필터 — 기본 목록에서는 접힌다(H-07).
          status:
            status === "archived"
              ? "archived"
              : isHomeworkStatus(status)
                ? status
                : undefined,
          studentId: student,
        }),
        listOpenQuestions(session.tenantId),
      ])
    : [[], []];

  // 과제별 열린 질문 수 — 답변 대기 질문은 오늘 처리할 업무다(열린 상태는 업무로 수렴).
  const questionCount = new Map<string, number>();
  for (const q of openQuestions) {
    if (q.assignmentId) {
      questionCount.set(q.assignmentId, (questionCount.get(q.assignmentId) ?? 0) + 1);
    }
  }
  const unreviewedTotal = assignments.reduce((sum, a) => sum + a.unreviewedCount, 0);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black tracking-tight">과제 관리</h1>
          <p className="mt-1 text-sm text-muted">
            과제 초안을 만들어 검토 후 배부하고, 제출 검토·피드백·질문 답변을 처리합니다.
          </p>
        </div>
        <Link href="/admin/homework/new" className={buttonClass("primary", "sm")}>
          신규 등록
        </Link>
      </div>

      {!connected && <DbBanner />}

      {student && (
        <div className="mb-6 flex items-center gap-3">
          <Badge tone="brand">
            {assignments[0]?.studentName ?? "선택한 학생"} 과제만 표시 중
          </Badge>
          <Link
            href="/admin/homework"
            className="text-xs font-bold text-muted hover:text-ink"
          >
            필터 해제
          </Link>
        </div>
      )}

      {(unreviewedTotal > 0 || openQuestions.length > 0) && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {unreviewedTotal > 0 && (
            <Badge tone="warning">미검토 제출 {unreviewedTotal}건</Badge>
          )}
          {openQuestions.length > 0 && (
            <Badge tone="warning">답변 대기 질문 {openQuestions.length}건</Badge>
          )}
        </div>
      )}

      <Card className="mb-6">
        <FilterChips
          basePath="/admin/homework"
          paramKey="status"
          current={status}
          options={[
            ...HOMEWORK_STATUS_OPTIONS.map((o) => ({
              value: o.value as string,
              label: o.label,
            })),
            { value: "archived", label: "보관" }, // H-07 보관 — 기본 목록에서 접힌 과제
          ]}
        />
      </Card>

      {assignments.length === 0 ? (
        <EmptyState
          title="등록된 과제가 없습니다"
          description="신규 등록 버튼으로 과제 초안을 만들 수 있습니다. 초안은 배부 전까지 학생·보호자에게 노출되지 않습니다."
          action={
            <Link href="/admin/homework/new" className={buttonClass("outline", "sm")}>
              신규 등록
            </Link>
          }
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>학생</Th>
                <Th>제목</Th>
                <Th>기한</Th>
                <Th>상태</Th>
                <Th>미검토 제출</Th>
                <Th>열린 질문</Th>
                <Th>배부일</Th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <Link
                      href={`/admin/homework/${a.id}`}
                      className="font-bold text-ink hover:text-brand-600"
                    >
                      {a.studentName ?? "-"}
                    </Link>
                  </Td>
                  <Td className="max-w-60 truncate">{a.title}</Td>
                  <Td>{formatKDate(a.dueDate)}</Td>
                  <Td>
                    <Badge tone={homeworkStatusTone(a.status)}>
                      {homeworkStatusLabel(a.status)}
                    </Badge>
                  </Td>
                  <Td>
                    {/* 미검토 제출이 남은 과제는 전체 종료로 표시할 수 없다(검수 126). */}
                    {a.unreviewedCount > 0 ? (
                      <Badge tone="warning">{a.unreviewedCount}건</Badge>
                    ) : (
                      <span className="text-xs text-muted">-</span>
                    )}
                  </Td>
                  <Td>
                    {(questionCount.get(a.id) ?? 0) > 0 ? (
                      <Badge tone="warning">{questionCount.get(a.id)}건</Badge>
                    ) : (
                      <span className="text-xs text-muted">-</span>
                    )}
                  </Td>
                  <Td>{formatKDate(a.assignedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
