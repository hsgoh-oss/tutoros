"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import type { Rates } from "@/lib/types";

type Mode = "inperson" | "video";

export function RateToggle({ rates }: { rates: Rates }) {
  const [mode, setMode] = useState<Mode>("inperson");
  const rate = mode === "inperson" ? rates.inperson : rates.video;

  return (
    <div className="rounded-card border border-line bg-white p-8 shadow-card md:p-10">
      <div className="inline-flex rounded-full border border-line bg-soft p-1">
        {(
          [
            ["inperson", "대면"],
            ["video", "화상"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={cn(
              // min-h-11: 모바일 탭타깃 44px
              "inline-flex min-h-11 items-center rounded-full px-5 text-sm font-extrabold tracking-tight transition-colors",
              mode === value
                ? "bg-brand-600 text-white shadow-lift"
                : "text-muted hover:text-ink-soft",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="mt-6 text-sm font-extrabold text-brand-600">
        {mode === "inperson" ? "대면 수업" : "화상 수업"} 시간당 단가
      </p>
      <p className="mt-2 text-[40px] font-black tracking-[-0.03em] text-ink md:text-[52px]">
        {rate.toLocaleString()}
        <span className="ml-1 text-lg font-bold text-muted">원/시간</span>
      </p>
    </div>
  );
}
