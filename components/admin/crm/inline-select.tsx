"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import type { CrmActionResult } from "./types";

export interface InlineSelectOption {
  value: string;
  label: string;
}

// 값이 바뀌면 즉시 서버 액션을 호출하는 상태 변경 select (상담·일정·결제 상태 변경 공용).
export function InlineSelect({
  action,
  id,
  value,
  options,
  className,
}: {
  action: (id: string, value: string) => Promise<CrmActionResult>;
  id: string;
  value: string;
  options: InlineSelectOption[];
  className?: string;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(value);
  const [pending, setPending] = useState(false);

  return (
    <select
      value={current}
      disabled={pending}
      onChange={async (e) => {
        const next = e.target.value;
        const prev = current;
        setCurrent(next);
        setPending(true);
        const result = await action(id, next);
        setPending(false);
        if (result.ok) {
          router.refresh();
        } else {
          setCurrent(prev);
          window.alert(result.error ?? "변경에 실패했습니다.");
        }
      }}
      className={cn(
        "rounded-panel border border-line bg-white px-3 py-1.5 text-xs font-bold outline-none focus:border-brand-600 disabled:opacity-50",
        className,
      )}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
