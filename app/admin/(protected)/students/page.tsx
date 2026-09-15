import { AdminPageHeader } from "@/components/admin/page-header";
import { studentContactPhone } from "@/lib/student-contact";
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
import { ActionButton } from "@/components/admin/crm/action-button";
import { CsvUpload } from "./csv-upload";
import { deleteStudent } from "./actions";
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
    <div className="dash-page">
      <AdminPageHeader>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">학생 관리</h1>
        </div>
        <div className="order-last w-full sm:order-none sm:w-auto">
          <CsvUpload />
        </div>
        <Link href="/admin/students/new" className={buttonClass("primary", "sm")}>
          신규 등록
        </Link>
      </AdminPageHeader>

      {!connected && <DbBanner />}

      <Toolbar>
        <FilterChips
          basePath="/admin/students"
          paramKey="status"
          current={status}
          preserveParams={{ q }}
          options={STUDENT_STATUS_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
          }))}
        />
        {/* 필터 칩과 같은 줄에 붙여 툴바 한 줄로 끝낸다 — 검색은 보조 조작이라 폭을 크게 주지 않는다. */}
        <form method="get" role="search" className="flex w-full gap-2 sm:ml-auto sm:w-auto">
          {status && <input type="hidden" name="status" value={status} />}
          <Input
            name="q"
            defaultValue={q ?? ""}
            placeholder="이름 검색"
            aria-label="학생 이름 검색"
            className="!h-[var(--ui-h-sm)] min-w-0 flex-1 sm:w-40 md:w-48 md:text-sm"
          />
          <button type="submit" className={buttonClass("ghost", "sm")}>
            검색
          </button>
        </form>
      </Toolbar>

      {students.length === 0 ? (
        <EmptyState
          title={q || status ? "조건에 맞는 학생이 없습니다" : "등록된 학생이 없습니다"}
          description={q || status ? "검색어나 상태를 변경해 주세요." : "상담을 마친 학생은 상담 상세에서도 등록할 수 있습니다."}
          action={
            <Link href={q || status ? "/admin/students" : "/admin/students/new"} className={buttonClass("outline", "sm")}>
              {q || status ? "전체 학생 보기" : "학생 등록"}
            </Link>
          }
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>이름</Th>
                <Th>연락처</Th>
                <Th>학교/학년</Th>
                <Th>수업 방식</Th>
                <Th>과목</Th>
                <Th>등록일</Th>
                <Th>상태</Th>
                <Th>삭제</Th>
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
                  <Td>{studentContactPhone(s) ?? "-"}{s.isAdult && <span className="ml-1 text-xs text-muted">본인</span>}</Td>
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
                  <Td>
                    {/* 활성 학생은 서버가 거부한다 — 버튼을 숨기지 않고 눌렀을 때 이유를 보여 준다. */}
                    <ActionButton
                      action={deleteStudent}
                      id={s.id}
                      label="삭제"
                      tone="danger"
                      confirmText={`${s.name} 학생을 삭제할까요?\n일정·수업·과제·성적·결제·포털 관계가 함께 삭제되며 되돌릴 수 없습니다. 상담·동의·후기 기록은 남습니다.`}
                    />
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
