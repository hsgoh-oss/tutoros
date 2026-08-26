import { Field, Input, Select } from "@/components/ui/form";
import { CLASS_TYPE_OPTIONS, STUDENT_STATUS_OPTIONS } from "./constants";
import type { Student } from "@/lib/types";

export function StudentFormFields({ student }: { student?: Student }) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Field label="이름" required>
        <Input name="name" defaultValue={student?.name ?? ""} placeholder="홍길동" />
      </Field>

      <Field label="학부모 연락처" required>
        <Input
          name="parentPhone"
          defaultValue={student?.parentPhone ?? ""}
          inputMode="numeric"
          placeholder="010-1234-5678"
        />
      </Field>

      <Field label="학생 연락처" hint="입력 시 아래 수집 동의 확인이 필요합니다">
        <Input
          name="studentPhone"
          defaultValue={student?.studentPhone ?? ""}
          inputMode="numeric"
          placeholder="010-1234-5678"
        />
      </Field>

      <label className="flex items-center gap-3 self-end pb-3">
        <input
          type="checkbox"
          name="studentPhoneConsent"
          defaultChecked={Boolean(student?.studentPhone)}
          className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-200"
        />
        <span className="text-sm font-bold text-ink-soft">
          학생 연락처 수집 동의 확인(구두/서면)
        </span>
      </label>

      <Field label="학교">
        <Input name="school" defaultValue={student?.school ?? ""} placeholder="OO고등학교" />
      </Field>

      <Field label="학년">
        <Input name="grade" defaultValue={student?.grade ?? ""} placeholder="고2" />
      </Field>

      <Field label="수업 방식">
        <Select name="classType" defaultValue={student?.classType ?? "inperson"}>
          {CLASS_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="과목 구분">
        <Input
          name="subjectType"
          defaultValue={student?.subjectType ?? ""}
          placeholder="내신 / 수능 / 수리논술"
        />
      </Field>

      <Field label="상태">
        <Select name="status" defaultValue={student?.status ?? "trial"}>
          {STUDENT_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
