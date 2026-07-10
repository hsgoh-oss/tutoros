import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { hasDb, listGrades, formatKDate } from "@/lib/data/crm";
import { buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";

export default async function GradesPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const { student } = await searchParams;
  const session = await getAdminSession();
  const connected = hasDb();
  const grades = session ? await listGrades(session.tenantId, student) : [];

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black tracking-tight">성적 관리</h1>
          <p className="mt-1 text-sm text-muted">
            학생별 시험 성적을 기록하고 추이를 확인합니다.
          </p>
        </div>
        <Link href="/admin/grades/new" className={buttonClass("primary", "sm")}>
          신규 등록
        </Link>
      </div>

      {!connected && <DbBanner />}

      {student && (
        <div className="mb-6 flex items-center gap-3">
          <Badge tone="brand">
            {grades[0]?.studentName ?? "선택한 학생"} 성적만 표시 중
          </Badge>
          <Link
            href="/admin/grades"
            className="text-xs font-bold text-muted hover:text-ink"
          >
            필터 해제
          </Link>
        </div>
      )}

      {grades.length === 0 ? (
        <EmptyState
          title="등록된 성적이 없습니다"
          description="신규 등록 버튼으로 시험 성적을 추가할 수 있습니다."
          action={
            <Link href="/admin/grades/new" className={buttonClass("outline", "sm")}>
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
                <Th>시험명</Th>
                <Th>시험일</Th>
                <Th>원점수</Th>
                <Th>백분위</Th>
                <Th>등급</Th>
              </tr>
            </thead>
            <tbody>
              {grades.map((g) => (
                <tr key={g.id}>
                  <Td>
                    <Link
                      href={`/admin/grades/${g.id}`}
                      className="font-bold text-ink hover:text-brand-600"
                    >
                      {g.studentName}
                    </Link>
                  </Td>
                  <Td>{g.examName}</Td>
                  <Td>{formatKDate(g.examDate)}</Td>
                  <Td>{g.rawScore != null ? `${g.rawScore}점` : "-"}</Td>
                  <Td>{g.percentile != null ? g.percentile : "-"}</Td>
                  <Td>{g.grade ? `${g.grade}등급` : "-"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
