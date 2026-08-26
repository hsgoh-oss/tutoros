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
      <div className="mb-8 inline-flex overflow-hidden rounded-[var(--radius-sm)] border border-line">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={cn(
              "inline-flex min-h-11 items-center border-l border-line px-5 text-sm font-extrabold tracking-[-0.02em] transition-colors first:border-l-0",
              tab === t.value
                ? "bg-ink text-white"
                : "bg-white text-muted hover:text-brand-600",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-[var(--radius-panel)] border border-line bg-soft px-6 py-10 text-center text-sm text-muted">
          해당 조건의 후기가 아직 없습니다.
        </p>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
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
