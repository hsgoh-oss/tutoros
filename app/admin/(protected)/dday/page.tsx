import { getAdminSession } from "@/lib/auth/session";
import { formatKDate, formatKDateTime, hasDb } from "@/lib/data/crm";
import { createServiceClient } from "@/lib/supabase/server";
import { listBackups } from "@/lib/data/backup";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/form";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { InlineSelect } from "@/components/admin/crm/inline-select";
import { ActionButton } from "@/components/admin/crm/action-button";
import { DdayCalendar, ddayLabel } from "@/components/admin/dday-calendar";
import { buttonClass } from "@/components/ui/button";
import { Toolbar } from "@/components/admin/crm/toolbar";
import { addKstMonths, kstTodayDateOnly } from "@/lib/kst";
import Link from "next/link";
import type { Dday } from "@/lib/types";
import {
  createDday,
  deleteDday,
  moveDdayDown,
  moveDdayUp,
  restoreDdayBackup,
  toggleDdayVisibility,
  updateDday,
} from "./actions";

interface DdayRow {
  id: string;
  name: string;
  exam_date: string;
  is_visible: boolean;
  sort_order: number;
}

async function listTenantDdays(tenantId: string): Promise<Dday[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("ddays")
    .select("id,name,exam_date,is_visible,sort_order")
    .eq("tenant_id", tenantId)
    .order("sort_order");
  return ((data ?? []) as DdayRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    examDate: r.exam_date,
    isVisible: r.is_visible,
    sortOrder: r.sort_order,
  }));
}

const VISIBILITY_OPTIONS = [
  { value: "true", label: "노출" },
  { value: "false", label: "숨김" },
];

/** 달 이동 파라미터 검증 — "YYYY-MM"만 받는다(그 외는 이번 달). */
function parseMonth(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return null;
  return value;
}

function formatKMonth(monthOnly: string): string {
  const [y, m] = monthOnly.split("-");
  return `${Number(y)}년 ${Number(m)}월`;
}

export default async function DdayPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthParam } = await searchParams;
  const session = await getAdminSession();
  const connected = hasDb();
  const ddays = session ? await listTenantDdays(session.tenantId) : [];
  const backups = session ? await listBackups(session.tenantId, "ddays") : [];

  const thisMonth = kstTodayDateOnly().slice(0, 7);
  const month = parseMonth(monthParam) ?? thisMonth;
  const prevMonth = addKstMonths(month, -1);
  const nextMonth = addKstMonths(month, 1);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">입시 일정</h1>
        <p className="mt-1 text-sm text-muted">
          수능·모의고사·내신 등 시험일을 달력으로 관리합니다. 노출로 둔 일정은 공개 사이트의
          D-day 배너에도 표시됩니다.
        </p>
      </div>

      {!connected && <DbBanner />}

      {/* ① 입시 일정 캘린더 — 이 화면의 본체. 아래 목록은 추가·수정·순서·노출을 맡는다. */}
      <Toolbar className="justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/admin/dday?month=${prevMonth}`} className={buttonClass("ghost", "sm")}>
            이전 달
          </Link>
          <Link href={`/admin/dday?month=${thisMonth}`} className={buttonClass("ghost", "sm")}>
            이번 달
          </Link>
          <Link href={`/admin/dday?month=${nextMonth}`} className={buttonClass("ghost", "sm")}>
            다음 달
          </Link>
        </div>
        <p className="text-sm font-bold text-ink-soft">{formatKMonth(month)}</p>
      </Toolbar>

      <DdayCalendar ddays={ddays} month={month} basePath="/admin/dday" />

      <Card className="mt-8 mb-6">
        <h2 className="mb-4 text-sm font-semibold tracking-tight">입시 일정 추가</h2>
        <SubmitForm action={createDday} submitLabel="추가">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="이름" required>
              <Input
                name="name"
                required
                placeholder="예: 2027학년도 대학수학능력시험"
              />
            </Field>
            <Field label="시험일" required>
              <Input type="date" name="examDate" required />
            </Field>
          </div>
        </SubmitForm>
      </Card>

      <h2 className="mt-8 mb-3 text-sm font-semibold tracking-tight">
        등록된 일정 · 노출 설정
      </h2>

      {ddays.length === 0 ? (
        <EmptyState
          title="등록된 입시 일정이 없습니다"
          description="위 폼으로 시험일을 추가하면 캘린더와 공개 D-day 배너에 반영됩니다."
        />
      ) : (
        <div className="space-y-4">
          {ddays.map((d, i) => (
            <Card key={d.id}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="font-bold text-ink">{d.name}</p>
                  <p className="mt-0.5 text-sm text-muted">
                    {formatKDate(d.examDate)}{" "}
                    <span className="font-bold text-brand-700">{ddayLabel(d.examDate)}</span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone={d.isVisible ? "success" : "soft"}>
                    <InlineSelect
                      action={toggleDdayVisibility}
                      id={d.id}
                      value={String(d.isVisible)}
                      options={VISIBILITY_OPTIONS}
                      className="border-none bg-transparent p-0 text-xs font-bold"
                    />
                  </Badge>
                  <ActionButton
                    action={moveDdayUp}
                    id={d.id}
                    label="위로"
                    className={i === 0 ? "pointer-events-none opacity-30" : undefined}
                  />
                  <ActionButton
                    action={moveDdayDown}
                    id={d.id}
                    label="아래로"
                    className={
                      i === ddays.length - 1 ? "pointer-events-none opacity-30" : undefined
                    }
                  />
                  <ActionButton
                    action={deleteDday}
                    id={d.id}
                    label="삭제"
                    tone="danger"
                    confirmText="이 입시 일정을 삭제하시겠습니까?"
                  />
                </div>
              </div>

              <SubmitForm
                action={updateDday}
                submitLabel="수정 저장"
                className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-2"
              >
                <input type="hidden" name="id" value={d.id} />
                <Field label="이름" required>
                  <Input name="name" defaultValue={d.name} required />
                </Field>
                <Field label="시험일" required>
                  <Input
                    type="date"
                    name="examDate"
                    defaultValue={d.examDate}
                    required
                  />
                </Field>
              </SubmitForm>
            </Card>
          ))}
        </div>
      )}

      <Card className="mt-8">
        <h2 className="mb-4 text-sm font-semibold tracking-tight">백업 복원</h2>
        {backups.length === 0 ? (
          <p className="text-sm text-muted">백업 이력이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {backups.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line px-4 py-3"
              >
                <span className="text-sm text-ink-soft">
                  {formatKDateTime(b.createdAt)} 시점
                </span>
                <ActionButton
                  action={restoreDdayBackup}
                  id={b.id}
                  label="이 시점으로 복원"
                  tone="danger"
                  confirmText="현재 입시 일정 목록을 이 백업 시점으로 되돌립니다. 계속할까요?"
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
