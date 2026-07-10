import { getAdminSession } from "@/lib/auth/session";
import { hasDb } from "@/lib/supabase/server";
import { getSiteContent } from "@/lib/data/content";
import { listBackups } from "@/lib/data/backup";
import { formatKDateTime } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/form";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { BackupPanel, type BackupPanelEntry } from "./backup-panel";
import { CasesEditor } from "./cases-editor";
import { SubjectsEditor } from "./subjects-editor";
import { ChecklistEditor } from "./checklist-editor";
import { PhotoSlot } from "./photo-slot";
import {
  updateHeroCopy,
  updateRates,
  updateBadges,
  updateCases,
  updateSubjects,
  updateChecklist,
  uploadPhoto,
  deletePhoto,
  restoreSetting,
  getSitePhotos,
} from "./actions";

const PHOTO_SLOTS = 5;

function toEntries(
  backups: { id: string; createdAt: string }[],
): BackupPanelEntry[] {
  return backups.map((b) => ({ id: b.id, createdAt: formatKDateTime(b.createdAt) }));
}

export default async function PageEditPage() {
  const session = await getAdminSession();
  if (!session) return null;
  const connected = hasDb();

  const [
    content,
    photos,
    siteInfoBackups,
    ratesBackups,
    badgesBackups,
    casesBackups,
    subjectsBackups,
    checklistBackups,
    photosBackups,
  ] = await Promise.all([
    getSiteContent(session.tenantId),
    getSitePhotos(session.tenantId),
    listBackups(session.tenantId, "settings:site_info"),
    listBackups(session.tenantId, "settings:rates"),
    listBackups(session.tenantId, "settings:badges"),
    listBackups(session.tenantId, "settings:cases"),
    listBackups(session.tenantId, "settings:subjects"),
    listBackups(session.tenantId, "settings:checklist"),
    listBackups(session.tenantId, "settings:photos"),
  ]);

  const paddedPhotos = Array.from({ length: PHOTO_SLOTS }, (_, i) => photos[i] ?? "");

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-black tracking-tight">페이지 편집</h1>
        <p className="mt-1 text-sm text-muted">
          공개 사이트에 즉시 반영되는 콘텐츠를 관리합니다.
        </p>
      </div>

      {!connected && <DbBanner />}

      <div className="space-y-6">
        <Card>
          <h2 className="mb-4 text-sm font-black text-ink-soft">브랜드 카피</h2>
          <SubmitForm action={updateHeroCopy} submitLabel="저장">
            <div className="grid gap-5">
              <Field label="브랜드 태그라인" required>
                <Input name="tagline" defaultValue={content.settings.tagline} />
              </Field>
              <Field label="SEO 설명" required hint="검색 결과 등에 노출되는 설명입니다">
                <Textarea
                  name="seoDescription"
                  defaultValue={content.settings.seoDescription}
                  className="min-h-24"
                />
              </Field>
            </div>
          </SubmitForm>
          <BackupPanel entries={toEntries(siteInfoBackups)} restoreAction={restoreSetting} />
        </Card>

        <Card>
          <h2 className="mb-1 text-sm font-black text-ink-soft">시간당 단가</h2>
          <p className="mb-4 text-xs text-muted">
            공개 수업 안내(/classes) 수업료 계산기에 즉시 반영됩니다.
          </p>
          <SubmitForm action={updateRates} submitLabel="저장">
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="대면(원/시간)" required>
                <Input
                  type="number"
                  name="inperson"
                  min={0}
                  step={1000}
                  defaultValue={content.rates.inperson}
                />
              </Field>
              <Field label="화상(원/시간)" required>
                <Input
                  type="number"
                  name="video"
                  min={0}
                  step={1000}
                  defaultValue={content.rates.video}
                />
              </Field>
              <Field label="시범수업(1회)" required>
                <Input
                  type="number"
                  name="trial"
                  min={0}
                  step={1000}
                  defaultValue={content.rates.trial}
                />
              </Field>
            </div>
          </SubmitForm>
          <BackupPanel entries={toEntries(ratesBackups)} restoreAction={restoreSetting} />
        </Card>

        <Card>
          <h2 className="mb-1 text-sm font-black text-ink-soft">역량 배지</h2>
          <p className="mb-4 text-xs text-muted">한 줄에 하나씩 입력합니다.</p>
          <SubmitForm action={updateBadges} submitLabel="저장">
            <Textarea
              name="badges"
              defaultValue={content.badges.join("\n")}
              className="min-h-32"
            />
          </SubmitForm>
          <BackupPanel entries={toEntries(badgesBackups)} restoreAction={restoreSetting} />
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-black text-ink-soft">성과 사례</h2>
          <SubmitForm action={updateCases} submitLabel="저장">
            <CasesEditor initialItems={content.cases} />
          </SubmitForm>
          <BackupPanel entries={toEntries(casesBackups)} restoreAction={restoreSetting} />
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-black text-ink-soft">과목 카드</h2>
          <SubmitForm action={updateSubjects} submitLabel="저장">
            <SubjectsEditor initialItems={content.subjects} />
          </SubmitForm>
          <BackupPanel entries={toEntries(subjectsBackups)} restoreAction={restoreSetting} />
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-black text-ink-soft">자기진단 체크리스트</h2>
          <SubmitForm action={updateChecklist} submitLabel="저장">
            <ChecklistEditor initialItems={content.checklist} />
          </SubmitForm>
          <BackupPanel entries={toEntries(checklistBackups)} restoreAction={restoreSetting} />
        </Card>

        <Card>
          <h2 className="mb-1 text-sm font-black text-ink-soft">사진</h2>
          <p className="mb-4 text-xs text-muted">최대 5장, jpg·png·webp / 10MB 이하.</p>
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {paddedPhotos.map((url, i) => (
              <PhotoSlot
                key={i}
                slot={i}
                url={url}
                uploadAction={uploadPhoto}
                deleteAction={deletePhoto}
              />
            ))}
          </div>
          <BackupPanel entries={toEntries(photosBackups)} restoreAction={restoreSetting} />
        </Card>
      </div>
    </div>
  );
}
