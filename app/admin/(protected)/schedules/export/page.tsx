import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { hasDb, listStudentOptions } from "@/lib/data/crm";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";

// 학생 일정 내보내기 (L-09) — 정본: docs/flow-canon/01_atlas_02_portal_lessons.md.
//
// 폼이 GET으로 다운로드 라우트를 호출한다. 서버 액션을 쓰지 않는 이유는 파일 응답이기 때문이고,
// GET인 이유는 내보내기가 아무것도 바꾸지 않기 때문이다(L-09 "내보내기가 회차 상태·출결·잔액을
// 변경하지 않는다"). 생성 실패·일정 없음은 라우트가 문구로 답한다.

export default async function ScheduleExportPage() {
  const session = await getAdminSession();
  const connected = hasDb();
  const students = session ? await listStudentOptions(session.tenantId) : [];

  const today = new Date();
  const kst = new Date(today.getTime() + 9 * 3600 * 1000);
  const start = kst.toISOString().slice(0, 10);
  const end = new Date(kst.getTime() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">일정 내보내기</h1>
          <p className="mt-1 text-sm text-muted">
            대상 학생의 해당 기간 회차만 담습니다. 연락처·내부 메모·다른 학생 정보는 포함되지
            않습니다. 해당 기간에 일정이 없으면 빈 파일 대신 안내로 끝납니다.
          </p>
        </div>
        <Link href="/admin/schedules" className={buttonClass("ghost", "sm")}>
          일정
        </Link>
      </div>

      {!connected && <DbBanner />}

      {students.length === 0 ? (
        <EmptyState
          title="학생이 없습니다"
          description="학생을 등록하면 일정을 내보낼 수 있습니다."
        />
      ) : (
        <Card>
          <form action="/api/admin/schedule-export" method="get" target="_blank">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="학생" required>
                <Select name="studentId" required defaultValue="">
                  <option value="">학생 선택</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="시작일" required>
                <Input name="from" type="date" required defaultValue={start} />
              </Field>
              <Field label="종료일" required>
                <Input name="to" type="date" required defaultValue={end} />
              </Field>
              <Field label="형식" required>
                <Select name="format" required defaultValue="ics">
                  <option value="ics">캘린더(.ics)</option>
                  <option value="csv">표(.csv)</option>
                </Select>
              </Field>
            </div>
            <button type="submit" className={`${buttonClass("primary", "md")} mt-4`}>
              일정본 생성
            </button>
          </form>
          <p className="mt-4 text-xs text-muted">
            생성한 파일은 그 시점의 사본입니다. 이후 일정이 바뀌면 파일을 고치지 말고 포털의 최신
            일정을 우선하거나 새 일정본을 만들어 다시 전달하세요.
          </p>
        </Card>
      )}
    </div>
  );
}
