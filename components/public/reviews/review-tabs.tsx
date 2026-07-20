"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { ReviewCard } from "@/components/public/review-card";
import type { Review } from "@/lib/types";

type Tab = "all" | "student" | "parent";

const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "student", label: "학생" },
  { value: "parent", label: "학부모" },
];

export function ReviewTabs({ reviews }: { reviews: Review[] }) {
  const [tab, setTab] = useState<Tab>("all");

  const filtered = useMemo(
    () =>
      tab === "all" ? reviews : reviews.filter((r) => r.reviewerType === tab),
    [reviews, tab],
  );

  return (
    <div>
      <div className="mb-8 inline-flex rounded-full border border-line bg-soft p-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={cn(
              "inline-flex min-h-12 items-center rounded-full px-5 text-sm font-extrabold tracking-tight transition-colors",
              tab === t.value
                ? "bg-brand-600 text-white shadow-lift"
                : "text-muted hover:text-ink-soft",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-panel bg-soft px-6 py-10 text-center text-sm text-muted">
          해당 조건의 후기가 아직 없습니다.
        </p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {filtered.map((review) => (
            <div key={review.id} className={review.isPinned ? "md:col-span-2" : undefined}>
              <ReviewCard review={review} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
