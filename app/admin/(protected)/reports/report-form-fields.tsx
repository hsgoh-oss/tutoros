import { Field, Select } from "@/components/ui/form";
import type { StudentOption } from "@/lib/data/crm";
import { REPORT_AUDIENCE_OPTIONS, REPORT_TYPE_OPTIONS } from "./constants";

// 신규 생성 전용 필드 — actions.ts의 createReport name 계약과 1:1.
// 상담 브리핑(consult_brief)·내부(internal)는 상담 상세 페이지 전용 플로우라 옵션에서 제외.
export function ReportFormFields({
  studentOptions,
  defaultStudentId,
}: {
  studentOptions: StudentOption[];
  defaultStudentId?: string;
}) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Field label="학생" required>
        <Select name="studentId" defaultValue={defaultStudentId ?? ""}>
          <option value="" disabled>
            학생을 선택하세요
          </option>
          {studentOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="유형" required>
        <Select name="type" defaultValue="lesson">
          {REPORT_TYPE_OPTIONS.filter((o) => o.value !== "consult_brief").map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="대상" required>
        <Select name="audience" defaultValue="parent">
          {REPORT_AUDIENCE_OPTIONS.filter((o) => o.value !== "internal").map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="깊이" hint="월간 리포트만 적용되며, 그 외 유형은 기본으로 처리됩니다.">
        <Select name="depth" defaultValue="basic">
          <option value="basic">기본</option>
          <option value="deep">심화</option>
        </Select>
      </Field>
    </div>
  );
}
