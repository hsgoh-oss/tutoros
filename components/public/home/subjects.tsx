"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import type { SubjectCard } from "@/lib/types";

export function SubjectCards({ subjects }: { subjects: SubjectCard[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div className="grid gap-5 md:grid-cols-3">
      {subjects.map((subject) => {
        const isOpen = openKey === subject.key;
        return (
          <div
            key={subject.key}
            className="rounded-card border border-line bg-white shadow-card"
          >
            <button
              type="button"
              onClick={() => setOpenKey(isOpen ? null : subject.key)}
              aria-expanded={isOpen}
              aria-controls={`subject-panel-${subject.key}`}
              className="flex w-full flex-col gap-3 p-7 text-left"
            >
              <p className="text-sm font-extrabold tracking-tight text-brand-600">
                {subject.target}
              </p>
              <h3 className="text-xl font-black tracking-tight text-ink">
                {subject.title}
              </h3>
              <p className="text-[15px] leading-[1.7] tracking-tight text-muted">
                {subject.summary}
              </p>
              <span className="mt-1 inline-flex items-center gap-1 text-sm font-bold text-brand-600">
                {isOpen ? "접기" : "자세히 보기"}
                <span
                  aria-hidden
                  className={cn(
                    "transition-transform duration-200",
                    isOpen && "rotate-180",
                  )}
                >
                  ↓
                </span>
              </span>
            </button>

            <div
              id={`subject-panel-${subject.key}`}
              className={cn(
                "overflow-hidden transition-[max-height] duration-300 ease-in-out",
                isOpen ? "max-h-[420px]" : "max-h-0",
              )}
            >
              <ul className="space-y-2.5 border-t border-line px-7 pt-5 pb-7">
                {subject.points.map((point) => (
                  <li
                    key={point}
                    className="flex gap-2.5 text-[15px] leading-[1.7] tracking-tight text-ink-soft"
                  >
                    <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-brand-600" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}
    </div>
  );
}
