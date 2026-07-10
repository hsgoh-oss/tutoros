"use client";

import { useState } from "react";
import { Input } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button";
import type { ChecklistItem } from "@/lib/types";

export function ChecklistEditor({ initialItems }: { initialItems: ChecklistItem[] }) {
  const [items, setItems] = useState<ChecklistItem[]>(
    initialItems.length > 0 ? initialItems : [{ id: "chk-1", text: "" }],
  );

  function update(index: number, text: string) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, text } : item)));
  }

  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={item.id} className="flex items-center gap-2">
          <Input
            value={item.text}
            onChange={(e) => update(i, e.target.value)}
            placeholder="자기진단 문항"
          />
          <button
            type="button"
            onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
            className="flex min-h-11 shrink-0 items-center text-xs font-bold text-rose-600 hover:underline"
          >
            삭제
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setItems((prev) => [...prev, { id: `chk-${Date.now()}`, text: "" }])}
        className={buttonClass("ghost", "sm")}
      >
        + 문항 추가
      </button>
      <input
        type="hidden"
        name="checklistJson"
        value={JSON.stringify(items.filter((it) => it.text.trim()))}
      />
    </div>
  );
}
