"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/form";
import type { Faq } from "@/lib/types";

export function FaqExplorer({ faqs }: { faqs: Faq[] }) {
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of faqs) counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
    return Array.from(counts.entries());
  }, [faqs]);

  const [category, setCategory] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return faqs
      .filter((f) => !category || f.category === category)
      .filter(
        (f) =>
          !k ||
          f.question.toLowerCase().includes(k) ||
          f.answer.toLowerCase().includes(k),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [faqs, category, keyword]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setCategory(null)}
          className={cn(
            // min-h-12: 모바일 탭타깃 48px (계약 최소치)
            "inline-flex min-h-12 items-center rounded-full border px-4 text-sm font-extrabold tracking-tight transition-colors",
            category === null
              ? "border-brand-600 bg-brand-600 text-white"
              : "border-line text-muted hover:border-brand-200",
          )}
        >
          전체 <span className="ml-1 opacity-70">{faqs.length}</span>
        </button>
        {categories.map(([cat, count]) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={cn(
              // min-h-12: 모바일 탭타깃 48px (계약 최소치)
              "inline-flex min-h-12 items-center rounded-full border px-4 text-sm font-extrabold tracking-tight transition-colors",
              category === cat
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-line text-muted hover:border-brand-200",
            )}
          >
            {cat} <span className="ml-1 opacity-70">{count}</span>
          </button>
        ))}
      </div>

      <Input
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="궁금한 내용을 검색해 보세요"
        className="mb-8"
        aria-label="FAQ 검색"
      />

      {filtered.length === 0 ? (
        <p className="rounded-panel bg-soft px-6 py-10 text-center text-sm text-muted">
          검색 결과가 없습니다. 다른 키워드로 검색해 보세요.
        </p>
      ) : (
        <div className="divide-y divide-line rounded-card border border-line bg-white">
          {filtered.map((f) => (
            <details key={f.id} className="group p-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold tracking-tight text-ink [&::-webkit-details-marker]:hidden">
                {f.question}
                <span
                  aria-hidden
                  className="shrink-0 text-xl font-black text-brand-600 transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-4 text-[15px] leading-[1.86] tracking-tight text-ink-soft">
                {f.answer}
              </p>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
