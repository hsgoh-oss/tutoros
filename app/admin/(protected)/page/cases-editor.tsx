"use client";

import { useState } from "react";
import { Input } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button";
import type { CaseItem } from "@/lib/types";

const EMPTY_CASE: CaseItem = {
  name: "",
  beforeLabel: "",
  beforeGrade: "",
  afterLabel: "",
  afterGrade: "",
};

// 행 배열을 useState로 관리하고 hidden input(JSON)으로 직렬화 — 서버는 zod 없이 안전 파싱한다.
export function CasesEditor({ initialItems }: { initialItems: CaseItem[] }) {
  const [items, setItems] = useState<CaseItem[]>(
    initialItems.length > 0 ? initialItems : [{ ...EMPTY_CASE }],
  );

  function update(index: number, patch: Partial<CaseItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  return (
    <div className="space-y-4">
      <div className="hidden gap-3 px-1 text-xs font-bold text-muted sm:grid sm:grid-cols-5">
        <span>학생</span>
        <span>이전 시점</span>
        <span>이전 등급</span>
        <span>이후 시점</span>
        <span>이후 등급</span>
      </div>
      {items.map((item, i) => (
        <div key={i} className="grid gap-3 rounded-panel border border-line p-4 sm:grid-cols-5">
          <Input
            placeholder="여OO 학생"
            value={item.name}
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <Input
            placeholder="고1 2학기 내신"
            value={item.beforeLabel}
            onChange={(e) => update(i, { beforeLabel: e.target.value })}
          />
          <Input
            placeholder="2등급"
            value={item.beforeGrade}
            onChange={(e) => update(i, { beforeGrade: e.target.value })}
          />
          <Input
            placeholder="고2 1학기 내신"
            value={item.afterLabel}
            onChange={(e) => update(i, { afterLabel: e.target.value })}
          />
          <div className="flex gap-2">
            <Input
              placeholder="1등급"
              value={item.afterGrade}
              onChange={(e) => update(i, { afterGrade: e.target.value })}
            />
            <button
              type="button"
              onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
              className="flex min-h-11 shrink-0 items-center text-xs font-bold text-rose-600 hover:underline"
            >
              삭제
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setItems((prev) => [...prev, { ...EMPTY_CASE }])}
        className={buttonClass("ghost", "sm")}
      >
        + 행 추가
      </button>
      <input type="hidden" name="casesJson" value={JSON.stringify(items)} />
    </div>
  );
}
