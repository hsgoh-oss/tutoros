"use client";

import { useState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/form";

// 과제 초안 폼 필드 — actions.ts의 createAssignment/updateAssignment name 계약과 1:1.
// 학생 선택에 따라 원 수업 연결(최근 수업 목록)을 해당 학생 것으로 좁힌다.
// 서버가 lesson-학생 일치를 재검증하므로(verifiedLessonId) 여기 필터는 편의용이다.

export interface HomeworkLessonOption {
  id: string;
  studentId: string;
  label: string;
}

export interface HomeworkStudentOption {
  id: string;
  name: string;
}

export interface HomeworkFormDefaults {
  studentId?: string;
  lessonId?: string | null;
  title?: string;
  description?: string;
  dueDate?: string | null;
}

export function HomeworkFormFields({
  studentOptions,
  lessonOptions,
  defaults,
}: {
  studentOptions: HomeworkStudentOption[];
  lessonOptions: HomeworkLessonOption[];
  defaults?: HomeworkFormDefaults;
}) {
  const [studentId, setStudentId] = useState(defaults?.studentId ?? "");
  const lessons = lessonOptions.filter((l) => l.studentId === studentId);

  return (
    <div className="grid gap-5">
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="학생" required>
          <Select
            name="studentId"
            required
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
          >
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

        <Field
          label="원 수업 연결"
          hint="과제의 근거가 된 최근 수업 기록을 연결합니다(선택)."
        >
          <Select
            name="lessonId"
            defaultValue={defaults?.lessonId ?? ""}
            disabled={!studentId}
          >
            <option value="">연결 안 함</option>
            {lessons.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="제목" required>
        <Input
          name="title"
          required
          maxLength={200}
          defaultValue={defaults?.title ?? ""}
          placeholder="예: 2단원 연습문제 1~20번"
        />
      </Field>

      <Field label="설명" hint="과제 범위·제출 방법 등 학생에게 보여줄 안내입니다.">
        <Textarea
          name="description"
          defaultValue={defaults?.description ?? ""}
          placeholder="풀이 과정을 사진으로 찍어 제출해 주세요."
        />
      </Field>

      <Field
        label="기한"
        hint="기한이 지나도 제출을 막지 않고 지연 제출로 표시됩니다(선택)."
      >
        <Input type="date" name="dueDate" defaultValue={defaults?.dueDate ?? ""} />
      </Field>
    </div>
  );
}
