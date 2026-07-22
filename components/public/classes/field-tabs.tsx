"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";
import type { SubjectCard } from "@/lib/types";

// 분야(내신·수능·약술형)를 한 번에 하나씩 보여주는 탭. 콘텐츠는 정적 카드와 동일.
export function FieldTabs({ subjects }: { subjects: SubjectCard[] }) {
  const [active, setActive] = useState(0);
  const current = subjects[active] ?? subjects[0];
  if (!current) return null;

  return (
    <div>
      <div role="tablist" aria-label="분야" className="mb-8 flex flex-wrap gap-2">
        {subjects.map((s, i) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            id={`field-tab-${s.key}`}
            aria-selected={active === i}
            aria-controls={`field-panel-${s.key}`}
            onClick={() => setActive(i)}
            className={cn(
              "inline-flex min-h-12 items-center rounded-full border px-5 text-sm font-extrabold tracking-tight transition-colors",
              active === i
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-line text-muted hover:border-brand-200",
            )}
          >
            {s.title}
          </button>
        ))}
      </div>

      <Card
        role="tabpanel"
        id={`field-panel-${current.key}`}
        aria-labelledby={`field-tab-${current.key}`}
        className="flex flex-col gap-3 p-7 md:p-9"
      >
        <p className="text-xs font-extrabold tracking-tight text-brand-600">
          {current.target}
        </p>
        <h3 className="text-xl font-black tracking-tight text-ink md:text-2xl">
          {current.title}
        </h3>
        <p className="text-sm leading-[1.86] tracking-tight text-muted md:text-[15px]">
          {current.summary}
        </p>
        <ul className="mt-1 space-y-1.5 text-[13px] leading-relaxed text-ink-soft md:text-sm">
          {current.points.map((p) => (
            <li key={p}>· {p}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
