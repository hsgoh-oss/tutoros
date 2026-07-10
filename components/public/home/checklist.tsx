"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { buttonClass } from "@/components/ui/button";
import type { ChecklistItem } from "@/lib/types";

// 상담 폼(components/consult/*)이 이 키로 읽어가 프리필한다 — 키 변경 시 폼도 함께 수정 필요.
const STORAGE_KEY = "axiom-checklist";
const STRONG_SIGNAL_THRESHOLD = 3;

export function Checklist({ items }: { items: ChecklistItem[] }) {
  const [checked, setChecked] = useState<string[]>([]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(checked));
  }, [checked]);

  function toggle(text: string) {
    setChecked((prev) =>
      prev.includes(text) ? prev.filter((t) => t !== text) : [...prev, text],
    );
  }

  const count = checked.length;
  const isStrongSignal = count >= STRONG_SIGNAL_THRESHOLD;

  return (
    <div className="rounded-card border border-line bg-soft p-7 md:p-10">
      <ul
        role="group"
        aria-label="자가진단 체크리스트"
        className="grid gap-3 md:grid-cols-2"
      >
        {items.map((item) => {
          const isChecked = checked.includes(item.text);
          return (
            <li key={item.id}>
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-panel border bg-white px-5 py-4 text-[15px] leading-[1.6] tracking-tight transition-colors",
                  isChecked
                    ? "border-brand-600 bg-brand-50 text-brand-700"
                    : "border-line text-ink-soft hover:border-brand-200",
                )}
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-brand-600"
                  checked={isChecked}
                  onChange={() => toggle(item.text)}
                />
                {item.text}
              </label>
            </li>
          );
        })}
      </ul>

      <div className="mt-8 text-center">
        <p
          aria-live="polite"
          className={cn(
            "text-[17px] font-bold tracking-tight",
            isStrongSignal ? "text-brand-700" : "text-ink-soft",
          )}
        >
          {count === 0 &&
            "우리 아이에게 해당하는 항목을 선택해 보세요"}
          {count > 0 &&
            !isStrongSignal &&
            `${count}개 항목에 해당합니다. 상담에서 자세히 확인해 드릴게요`}
          {isStrongSignal &&
            `${count}개 항목에 해당합니다 — 성적이 정체된 데는 이유가 있습니다. 지금 원인 진단이 필요한 시점입니다`}
        </p>

        {count > 0 && (
          <Link
            href="/consult"
            className={cn(
              buttonClass("primary", "lg"),
              "mt-5",
              isStrongSignal && "animate-pulse",
            )}
          >
            상담 신청하기
          </Link>
        )}
      </div>
    </div>
  );
}
