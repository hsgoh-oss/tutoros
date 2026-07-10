import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { RATING_OPTIONS } from "./constants";
import type { StudentOption } from "@/lib/data/crm";
import type { Lesson } from "@/lib/types";

// 신규 등록·상세 수정 공용 필드 — actions.ts parseLessonForm의 name 계약과 1:1.
// 수정 모드(studentOptions 없음)에서는 학생을 표시만 하고 hidden input으로 studentId를 유지한다
// (회차는 학생별 등록 순서로 자동 계산되므로 수정 시 학생 변경을 허용하지 않는다).
export function LessonFormFields({
  lesson,
  studentOptions,
  studentName,
}: {
  lesson?: Lesson;
  studentOptions?: StudentOption[];
  studentName?: string;
}) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {studentOptions ? (
        <Field label="학생" required>
          <Select name="studentId" defaultValue={lesson?.studentId ?? ""} required>
            <option value="" disabled>
              학생 선택
            </option>
            {studentOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field label="학생">
          <Input defaultValue={studentName ?? "-"} disabled readOnly />
          <input type="hidden" name="studentId" value={lesson?.studentId ?? ""} />
        </Field>
      )}

      <Field label="수업일" required>
        <Input
          type="date"
          name="lessonDate"
          defaultValue={lesson?.lessonDate ?? ""}
          required
        />
      </Field>

      <div className="md:col-span-2">
        <Field label="수업 내용" required>
          <Textarea
            name="content"
            defaultValue={lesson?.content ?? ""}
            placeholder="수업에서 다룬 내용을 입력해 주세요."
            required
          />
        </Field>
      </div>

      <div className="md:col-span-2">
        <Field label="숙제">
          <Textarea
            name="homework"
            defaultValue={lesson?.homework ?? ""}
            placeholder="다음 수업까지의 숙제를 입력해 주세요."
          />
        </Field>
      </div>

      <Field label="집중도" hint="1~5점, 선택 항목">
        <Select name="concentration" defaultValue={lesson?.concentration?.toString() ?? ""}>
          <option value="">선택 안 함</option>
          {RATING_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}점
            </option>
          ))}
        </Select>
      </Field>

      <Field label="태도" hint="1~5점, 선택 항목">
        <Select name="attitude" defaultValue={lesson?.attitude?.toString() ?? ""}>
          <option value="">선택 안 함</option>
          {RATING_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}점
            </option>
          ))}
        </Select>
      </Field>

      <label className="flex items-center gap-3 self-end pb-3">
        <input
          type="checkbox"
          name="absent"
          defaultChecked={lesson?.absent ?? false}
          className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-200"
        />
        <span className="text-sm font-bold text-ink-soft">결석 처리</span>
      </label>
    </div>
  );
}
