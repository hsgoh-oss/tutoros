import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { hasDb, listLessons, getStudent, formatKDate } from "@/lib/data/crm";
import type { LessonListItem } from "@/lib/data/crm";
import type { Student } from "@/lib/types";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";

export default async function LessonsPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const { student } = await searchParams;
  const session = await getAdminSession();
  const connected = hasDb();

  let lessons: LessonListItem[] = [];
  let filteredStudent: Student | null = null;
  if (session) {
    [lessons, filteredStudent] = await Promise.all([
      listLessons(session.tenantId, student),
      student ? getStudent(session.tenantId, student) : Promise.resolve(null),
    ]);
  }

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">수업 기록</h1>
          <p className="mt-1 text-sm text-muted">
            {filteredStudent
              ? `${filteredStudent.name} 학생의 수업 기록입니다.`
              : "전체 학생의 수업 기록을 확인합니다."}
          </p>
        </div>
        <Link href="/admin/lessons/new" className={buttonClass("primary", "sm")}>
          신규 등록
        </Link>
      </div>

      {!connected && <DbBanner />}

      {filteredStudent && (
        <Card className="mb-6 flex items-center justify-between">
          <span className="text-sm font-bold text-ink-soft">
            {filteredStudent.name} 학생으로 필터링됨
          </span>
          <Link
            href="/admin/lessons"
            className="text-xs font-bold text-brand-700 hover:underline"
          >
            필터 해제
          </Link>
        </Card>
      )}

      {lessons.length === 0 ? (
        <EmptyState
          title="수업 기록이 없습니다"
          description="신규 등록 버튼으로 수업 기록을 추가할 수 있습니다."
          action={
            <Link href="/admin/lessons/new" className={buttonClass("outline", "sm")}>
              신규 등록
            </Link>
          }
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>학생명</Th>
                <Th>회차</Th>
                <Th>수업일</Th>
                <Th>내용</Th>
                <Th>집중도·태도</Th>
                <Th>결석</Th>
              </tr>
            </thead>
            <tbody>
              {lessons.map((l) => (
                <tr key={l.id}>
                  <Td>
                    <Link
                      href={`/admin/lessons/${l.id}`}
                      className="font-bold text-ink hover:text-brand-600"
                    >
                      {l.studentName}
                    </Link>
                  </Td>
                  <Td>{l.sessionNumber}회차</Td>
                  <Td>{formatKDate(l.lessonDate)}</Td>
                  <Td className="max-w-xs">
                    <p className="line-clamp-2 text-sm">{l.content}</p>
                  </Td>
                  <Td>
                    {l.concentration ?? "-"} · {l.attitude ?? "-"}
                  </Td>
                  <Td>{l.absent ? <Badge tone="danger">결석</Badge> : "-"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
