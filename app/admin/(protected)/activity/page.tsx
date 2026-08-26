import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { formatKDateTime, hasDb } from "@/lib/data/crm";
import { listActivity } from "@/lib/data/activity";
import { Card } from "@/components/ui/card";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";

// activity_log.action·target_type은 영문 키로 적재한다(집계·필터용 안정 값).
// 화면에는 여기서만 한글로 옮긴다 — 미등록 키는 원문을 그대로 보여 준다.
const ACTION_LABEL: Record<string, string> = {
  create: "등록",
  update: "수정",
  delete: "삭제",
  notify: "알림 발송",
  generate_exam_report: "시험 리포트 생성",
};

const TARGET_LABEL: Record<string, string> = {
  consultation: "상담",
  student: "학생",
  lesson: "수업",
  schedule: "일정",
  grade: "성적",
  material: "자료",
  report: "리포트",
  review: "후기",
  faq: "FAQ",
  dday: "D-day",
  recruit: "모집 현황",
};

export default async function ActivityPage() {
  const session = await getAdminSession();
  if (!session) notFound();

  const connected = hasDb();
  const entries = await listActivity(session.tenantId, 100);

  return (
    <div>
      <div className="mb-8">
        <Link
          href="/admin/dashboard"
          className="flex min-h-11 items-center text-xs font-bold text-brand-700 hover:underline"
        >
          ← 대시보드
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">변경 이력</h1>
      </div>

      {!connected && <DbBanner />}

      <Card>
        {entries.length === 0 ? (
          <EmptyState
            title="변경 이력이 없습니다"
            description="상담·학생·결제 등 주요 작업이 기록되면 이곳에 표시됩니다."
          />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>시각</Th>
                  <Th>동작</Th>
                  <Th>대상</Th>
                  <Th>요약</Th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <Td className="whitespace-nowrap text-muted">
                      {formatKDateTime(e.createdAt)}
                    </Td>
                    <Td className="font-bold text-ink">
                      {ACTION_LABEL[e.action] ?? e.action}
                    </Td>
                    <Td>
                      <span className="text-ink-soft">
                        {TARGET_LABEL[e.targetType] ?? e.targetType}
                      </span>
                      {e.targetId && (
                        <span className="ml-1 text-xs text-muted">
                          {e.targetId.slice(0, 8)}
                        </span>
                      )}
                    </Td>
                    <Td className="text-ink-soft">{e.summary}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
