"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { Dday } from "@/lib/types";

// 날짜 계산은 클라이언트에서(KST 가정) — 서버/클라 시각차로 인한 하이드레이션 불일치 회피.

function daysUntil(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function DdayBanner({ ddays }: { ddays: Dday[] }) {
  const [items, setItems] = useState<{ dday: Dday; left: number }[]>([]);

  useEffect(() => {
    setItems(
      ddays
        .filter((d) => d.isVisible)
        .map((dday) => ({ dday, left: daysUntil(dday.examDate) }))
        .filter(({ left }) => left >= 0)
        .sort((a, b) => a.left - b.left),
    );
  }, [ddays]);

  if (items.length === 0) return null;

  return (
    <div className="border-b border-line bg-soft">
      <div className="mx-auto flex w-full max-w-7xl gap-2 overflow-x-auto px-6 py-2.5 md:px-8 [scrollbar-width:none]">
        {items.map(({ dday, left }) => {
          const urgent = left <= 30;
          return (
            <span
              key={dday.id}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-bold tracking-tight",
                urgent
                  ? "border-brand-200 bg-brand-600 text-white"
                  : "border-line bg-white text-ink-soft",
              )}
            >
              {dday.name}
              <strong
                className={cn(
                  "font-black",
                  urgent ? "text-white" : "text-brand-600",
                )}
              >
                {left === 0 ? "D-DAY" : `D-${left}`}
              </strong>
            </span>
          );
        })}
      </div>
    </div>
  );
}
