import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { hasDb, listStudents, formatKDate } from "@/lib/data/crm";
import { buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/form";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import { FilterChips } from "@/components/admin/crm/filter-chips";
import { Toolbar } from "@/components/admin/crm/toolbar";
import {
  STUDENT_STATUS_OPTIONS,
  classTypeLabel,
  studentStatusLabel,
  studentStatusTone,
} from "./constants";
import { CsvUpload } from "./csv-upload";
import type { Student } from "@/lib/types";

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status, q } = await searchParams;
  const session = await getAdminSession();
  const connected = hasDb();
  const students = session
    ? await listStudents(session.tenantId, {
        status: status as Student["status"] | undefined,
        q,
      })
    : [];

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">학생 관리</h1>
          <p className="mt-1 text-sm text-muted">
            재원 학생을 관리하고 수업·성적·결제 이력을 확인합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CsvUpload />
          <Link href="/admin/students/new" className={buttonClass("primary", "sm")}>
            신규 등록
          </Link>
        </div>
      </div>

      {!connected && <DbBanner />}

      <Toolbar>
        <FilterChips
          basePath="/admin/students"
          paramKey="status"
          current={status}
          options={STUDENT_STATUS_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
          }))}
        />
        {/* 필터 칩과 같은 줄에 붙여 툴바 한 줄로 끝낸다 — 검색은 보조 조작이라 폭을 크게 주지 않는다. */}
        <form method="get" className="ml-auto flex gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <Input
            name="q"
            defaultValue={q ?? ""}
            placeholder="이름 검색"
            className="h-9 w-48 py-0 text-sm"
          />
          <button type="submit" className={buttonClass("ghost", "sm")}>
            검색
          </button>
        </form>
      </Toolbar>

      {students.length === 0 ? (
        <EmptyState
          title="등록된 학생이 없습니다"
          description="신규 등록 버튼 또는 상담 관리의 학생 전환으로 추가할 수 있습니다."
          action={
            <Link href="/admin/students/new" className={buttonClass("outline", "sm")}>
              신규 등록
            </Link>
          }
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>이름</Th>
                <Th>학부모 연락처</Th>
                <Th>학교/학년</Th>
                <Th>수업 방식</Th>
                <Th>과목</Th>
                <Th>등록일</Th>
                <Th>상태</Th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <Link
                      href={`/admin/students/${s.id}`}
                      className="font-bold text-ink hover:text-brand-600"
                    >
                      {s.name}
                    </Link>
                  </Td>
                  <Td>{s.parentPhone}</Td>
                  <Td>
                    {s.school ?? "-"}
                    {s.grade && <span className="text-muted"> · {s.grade}</span>}
                  </Td>
                  <Td>{classTypeLabel(s.classType)}</Td>
                  <Td>{s.subjectType ?? "-"}</Td>
                  <Td>{formatKDate(s.createdAt)}</Td>
                  <Td>
                    <Badge tone={studentStatusTone(s.status)}>
                      {studentStatusLabel(s.status)}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
