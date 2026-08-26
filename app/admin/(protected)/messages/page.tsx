import { getAdminSession } from "@/lib/auth/session";
import { hasDb, listStudents } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Field, Select, Textarea } from "@/components/ui/form";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import { sendCustomMessage, sendReEnrollmentNotice } from "./actions";

export default async function MessagesPage() {
  const session = await getAdminSession();
  const connected = hasDb();
  const students = session ? await listStudents(session.tenantId) : [];

  const studentOptions = (
    <>
      <option value="">학생 선택</option>
      {students.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </>
  );

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">메시지 발송</h1>
        <p className="mt-1 text-sm text-muted">
          학생·학부모에게 개별 안내를 보내거나 재등록 안내(광고)를 발송합니다. 알림톡 우선,
          실패 시 SMS로 폴백됩니다.
        </p>
      </div>

      {!connected && <DbBanner />}

      {students.length === 0 ? (
        <EmptyState
          title="등록된 학생이 없습니다"
          description="학생을 등록하면 개별 메시지를 발송할 수 있습니다."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="text-sm font-semibold text-ink-soft">개별 메시지</h2>
            <p className="mt-1 mb-4 text-sm text-muted">
              선택한 학생의 학부모(또는 학생 본인)에게 직접 작성한 안내를 발송합니다.
            </p>
            <SubmitForm action={sendCustomMessage} submitLabel="메시지 발송">
              <div className="space-y-4">
                <Field label="학생">
                  <Select name="studentId" required defaultValue="">
                    {studentOptions}
                  </Select>
                </Field>
                <Field label="수신 대상">
                  <Select name="recipient" defaultValue="parent">
                    <option value="parent">학부모</option>
                    <option value="student">학생 본인</option>
                  </Select>
                </Field>
                <Field label="메시지">
                  <Textarea
                    name="message"
                    required
                    placeholder="보낼 안내 문구를 입력해 주세요."
                  />
                </Field>
              </div>
            </SubmitForm>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-ink-soft">재등록 안내 (광고)</h2>
            <p className="mt-1 mb-4 text-sm text-muted">
              <strong className="text-ink-soft">마케팅 수신동의</strong>가 있는 학부모에게만
              발송됩니다. (광고) 표기·야간(21~08시) 발송 금지가 자동 적용됩니다.
            </p>
            <SubmitForm action={sendReEnrollmentNotice} submitLabel="재등록 안내 발송">
              <Field label="학생">
                <Select name="studentId" required defaultValue="">
                  {studentOptions}
                </Select>
              </Field>
            </SubmitForm>
          </Card>
        </div>
      )}
    </div>
  );
}
