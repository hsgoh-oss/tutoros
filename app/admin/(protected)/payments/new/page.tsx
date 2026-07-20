import { getAdminSession } from "@/lib/auth/session";
import { listStudentOptions } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { PAYMENT_METHOD_OPTIONS } from "../constants";
import { createPayment } from "../actions";

export default async function NewPaymentPage() {
  const session = await getAdminSession();
  const students = session ? await listStudentOptions(session.tenantId) : [];

  // 4주 정액 기본값 — 한국 시간(KST) 기준 오늘/오늘+27일.
  const kstDay = (offsetDays = 0) => {
    const kstMs = Date.now() + 9 * 3600 * 1000 + offsetDays * 24 * 3600 * 1000;
    return new Date(kstMs).toISOString().slice(0, 10);
  };
  const defaultPeriodStart = kstDay(0);
  const defaultPeriodEnd = kstDay(27);
  const defaultDueDate = kstDay(27);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-black tracking-tight">신규 청구</h1>
        <p className="mt-1 text-sm text-muted">
          생성된 청구는 &apos;청구&apos; 상태로 등록됩니다.
        </p>
      </div>

      <Card className="max-w-3xl">
        <SubmitForm
          action={createPayment}
          submitLabel="청구 생성"
          redirectTo="/admin/payments"
        >
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="학생" required>
              <Select name="studentId" defaultValue="">
                <option value="" disabled>
                  학생 선택
                </option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="청구 수단">
              <Select name="method" defaultValue="bank">
                {PAYMENT_METHOD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="기간 시작" required>
              <Input type="date" name="periodStart" defaultValue={defaultPeriodStart} />
            </Field>

            <Field label="기간 종료" required>
              <Input type="date" name="periodEnd" defaultValue={defaultPeriodEnd} />
            </Field>

            <Field label="금액" required hint="원 단위">
              <Input type="number" name="amount" min="1" step="1" placeholder="300000" />
            </Field>

            <Field label="납기일">
              <Input type="date" name="dueDate" defaultValue={defaultDueDate} />
            </Field>

            <p className="text-xs text-muted md:col-span-2">
              4주 정액 기본값이 채워져 있습니다 — 필요 시 수정하세요.
            </p>
          </div>
        </SubmitForm>
      </Card>
    </div>
  );
}
