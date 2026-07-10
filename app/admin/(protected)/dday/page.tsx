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

export default async function DdayPage() {
  const session = await getAdminSession();
  const connected = hasDb();
  const ddays = session ? await listTenantDdays(session.tenantId) : [];
  const backups = session ? await listBackups(session.tenantId, "ddays") : [];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-black tracking-tight">D-day 관리</h1>
        <p className="mt-1 text-sm text-muted">
          공개 사이트에 노출되는 D-day 배너를 관리합니다.
        </p>
      </div>

      {!connected && <DbBanner />}

      <Card className="mb-6">
        <h2 className="mb-4 text-sm font-black tracking-tight">D-day 추가</h2>
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

      {ddays.length === 0 ? (
        <EmptyState
          title="등록된 D-day가 없습니다"
          description="위 폼으로 D-day를 추가할 수 있습니다."
        />
      ) : (
        <div className="space-y-4">
          {ddays.map((d, i) => (
            <Card key={d.id}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="font-bold text-ink">{d.name}</p>
                  <p className="mt-0.5 text-sm text-muted">
                    {formatKDate(d.examDate)}
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
                    confirmText="이 D-day를 삭제하시겠습니까?"
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
        <h2 className="mb-4 text-sm font-black tracking-tight">백업 복원</h2>
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
                  confirmText="현재 D-day 목록을 이 백업 시점으로 되돌립니다. 계속할까요?"
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
