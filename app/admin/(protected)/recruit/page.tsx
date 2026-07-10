import { getAdminSession } from "@/lib/auth/session";
import { formatKDateTime, hasDb } from "@/lib/data/crm";
import { createServiceClient } from "@/lib/supabase/server";
import { listBackups } from "@/lib/data/backup";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { ActionButton } from "@/components/admin/crm/action-button";
import type { RecruitState, RecruitStatus } from "@/lib/types";
import { restoreRecruitBackup, saveRecruitStatus } from "./actions";

interface RecruitStatusRow {
  status: RecruitState;
  message: string;
  seat_count: number | null;
  is_banner_visible: boolean;
}

async function fetchRecruit(tenantId: string): Promise<RecruitStatus | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("recruit_status")
    .select("status,message,seat_count,is_banner_visible")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  const row = data as RecruitStatusRow;
  return {
    status: row.status,
    message: row.message,
    seatCount: row.seat_count,
    isBannerVisible: row.is_banner_visible,
  };
}

const STATUS_OPTIONS: { value: RecruitState; label: string }[] = [
  { value: "open", label: "모집 중" },
  { value: "closing", label: "마감 임박" },
  { value: "waitlist", label: "대기 접수" },
  { value: "closed", label: "마감" },
];

export default async function RecruitPage() {
  const session = await getAdminSession();
  const connected = hasDb();
  const recruit = session ? await fetchRecruit(session.tenantId) : null;
  const backups = session
    ? await listBackups(session.tenantId, "recruit_status")
    : [];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-black tracking-tight">모집 현황</h1>
        <p className="mt-1 text-sm text-muted">
          공개 사이트에 노출되는 모집 배너 문구와 상태를 관리합니다.
        </p>
      </div>

      {!connected && <DbBanner />}

      <Card>
        <SubmitForm action={saveRecruitStatus} submitLabel="저장">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="모집 상태" required>
              <Select name="status" defaultValue={recruit?.status ?? "open"}>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="모집 인원"
              hint="비워두면 인원 표시 없이 문구만 노출됩니다"
            >
              <Input
                type="number"
                name="seatCount"
                min={0}
                defaultValue={recruit?.seatCount ?? ""}
              />
            </Field>
          </div>

          <Field label="안내 문구" className="mt-5">
            <Textarea
              name="message"
              defaultValue={recruit?.message ?? ""}
              placeholder="예: 7월 신규 수강생 2명 모집 중"
            />
          </Field>

          <label className="mt-5 flex items-center gap-3">
            <input
              type="checkbox"
              name="isBannerVisible"
              defaultChecked={recruit?.isBannerVisible ?? false}
              className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-200"
            />
            <span className="text-sm font-bold text-ink-soft">
              공개 사이트에 모집 배너 노출
            </span>
          </label>
        </SubmitForm>
      </Card>

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
                  action={restoreRecruitBackup}
                  id={b.id}
                  label="이 시점으로 복원"
                  tone="danger"
                  confirmText="현재 모집 현황을 이 백업 시점으로 되돌립니다. 계속할까요?"
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
