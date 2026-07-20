import { Field, Input, Select } from "@/components/ui/form";
import type { StudentOption } from "@/lib/data/crm";
import type { GradeRecord } from "@/lib/types";

export function GradeFormFields({
  studentOptions,
  record,
}: {
  studentOptions: StudentOption[];
  record?: GradeRecord;
}) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Field label="학생" required>
        <Select name="studentId" defaultValue={record?.studentId ?? ""}>
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

      <Field label="시험명" required>
        <Input
          name="examName"
          defaultValue={record?.examName ?? ""}
          placeholder="2026학년도 6월 모의고사"
        />
      </Field>

      <Field label="시험일">
        <Input type="date" name="examDate" defaultValue={record?.examDate ?? ""} />
      </Field>

      <Field label="원점수" hint="0~100">
        <Input
          type="number"
          name="rawScore"
          min={0}
          max={100}
          defaultValue={record?.rawScore ?? ""}
        />
      </Field>

      <Field label="백분위" hint="0~100">
        <Input
          type="number"
          name="percentile"
          min={0}
          max={100}
          defaultValue={record?.percentile ?? ""}
        />
      </Field>

      <Field label="등급" hint="예: 1">
        <Input name="grade" defaultValue={record?.grade ?? ""} placeholder="1" />
      </Field>
    </div>
  );
}
