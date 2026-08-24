import { getAdminSession } from "@/lib/auth/session";
import { hasDb } from "@/lib/supabase/server";
import { getSiteContent } from "@/lib/data/content";
import { listBackups } from "@/lib/data/backup";
import { formatKDateTime } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { BackupPanel } from "@/components/admin/backup-panel";
import { updateSiteInfo, restoreSetting } from "./actions";
import { SecurityCard } from "./security-card";

export default async function SettingsPage() {
  const session = await getAdminSession();
  if (!session) return null;
  const connected = hasDb();

  const [content, backups] = await Promise.all([
    getSiteContent(session.tenantId),
    listBackups(session.tenantId, "settings:site_info"),
  ]);
  const entries = backups.map((b) => ({ id: b.id, createdAt: formatKDateTime(b.createdAt) }));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-black tracking-tight">사이트 설정</h1>
        <p className="mt-1 text-sm text-muted">
          사업자 정보와 연락 채널을 관리합니다. 저장 시 공개 사이트에 즉시 반영됩니다.
        </p>
      </div>

      {!connected && <DbBanner />}

      <Card className="max-w-3xl">
        <SubmitForm action={updateSiteInfo} submitLabel="저장">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="브랜드명" required>
              <Input name="brandName" defaultValue={content.settings.brandName} />
            </Field>
            <Field label="상호(사업자명)" required>
              <Input name="bizName" defaultValue={content.settings.bizName} />
            </Field>
            <Field label="대표자명" required>
              <Input name="ceoName" defaultValue={content.settings.ceoName} />
            </Field>
            <Field label="사업자등록번호" required>
              <Input name="bizNo" defaultValue={content.settings.bizNo} placeholder="000-00-00000" />
            </Field>
            <Field label="이메일" required>
              <Input type="email" name="email" defaultValue={content.settings.email} />
            </Field>
            <Field label="전화번호">
              <Input
                name="phone"
                defaultValue={content.settings.phone ?? ""}
                placeholder="010-1234-5678"
              />
            </Field>
            <Field label="주소" required className="md:col-span-2">
              <Input name="address" defaultValue={content.settings.address} />
            </Field>
            <Field label="카카오 채널 URL">
              <Input name="kakaoUrl" defaultValue={content.settings.kakaoUrl} />
            </Field>
            <Field label="인스타그램 URL">
              <Input name="instagramUrl" defaultValue={content.settings.instagramUrl} />
            </Field>
            <Field label="김과외 프로필 URL">
              <Input name="kimProfileUrl" defaultValue={content.settings.kimProfileUrl} />
            </Field>
            <Field label="김과외 후기 URL">
              <Input name="kimReviewUrl" defaultValue={content.settings.kimReviewUrl} />
            </Field>
            <Field
              label="개인과외교습자 신고번호"
              hint="입력 시에만 공개 사이트 푸터에 노출됩니다"
            >
              <Input name="tutorReportNo" defaultValue={content.settings.tutorReportNo ?? ""} />
            </Field>
            <Field label="Google Analytics ID">
              <Input
                name="gaId"
                defaultValue={content.settings.gaId ?? ""}
                placeholder="G-XXXXXXXXXX"
              />
            </Field>
            <Field
              label="입금 계좌 안내"
              hint="계좌이체 청구 안내에 노출됩니다"
              className="md:col-span-2"
            >
              <Input
                name="bankAccount"
                defaultValue={content.settings.bankAccount ?? ""}
                placeholder="국민은행 123456-78-901234 (예금주: 고현서)"
              />
            </Field>
          </div>
        </SubmitForm>
        <BackupPanel entries={entries} restoreAction={restoreSetting} />
      </Card>

      {/* 관리자 보안 — 전 세션 로그아웃·운영자 이메일 교체 (P-10). DB 미연결이면 동작하지 않는다(액션이 안내). */}
      <Card className="mt-8 max-w-3xl">
        <h2 className="text-lg font-black tracking-tight">관리자 보안</h2>
        <p className="mt-1 mb-6 text-sm text-muted">
          세션 회수와 운영자 승계를 관리합니다. 두 작업 모두 완료 후 재로그인이 필요합니다.
        </p>
        <SecurityCard currentEmail={session.email} />
      </Card>
    </div>
  );
}
