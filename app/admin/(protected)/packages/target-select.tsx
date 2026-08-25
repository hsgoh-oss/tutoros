"use client";

import { useState } from "react";
import { Field, Select } from "@/components/ui/form";

// 대상 선택 — 계약·등록·학생 세 값을 한 번에 고른다.
// 셋을 따로 고르게 하면 서로 어긋난 조합(다른 학생의 계약 등)을 만들 수 있어, 하나의 선택이
// 세 hidden 필드를 함께 채우게 한다. 서버 액션은 셋을 따로 받되 여기서 짝이 보장된다.

export interface TargetOption {
  contractId: string;
  enrollmentId: string;
  studentId: string;
  studentName: string;
}

export function PackageTargetSelect({ options }: { options: TargetOption[] }) {
  const [selected, setSelected] = useState("");
  const current = options.find((o) => o.contractId === selected) ?? null;

  return (
    <>
      <Field label="대상" required>
        <Select
          name="target"
          required
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">학생·계약 선택</option>
          {options.map((o) => (
            <option key={o.contractId} value={o.contractId}>
              {o.studentName}
            </option>
          ))}
        </Select>
      </Field>
      <input type="hidden" name="contractId" value={current?.contractId ?? ""} />
      <input type="hidden" name="enrollmentId" value={current?.enrollmentId ?? ""} />
      <input type="hidden" name="studentId" value={current?.studentId ?? ""} />
    </>
  );
}
