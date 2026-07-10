import Link from "next/link";
import { cn } from "@/lib/cn";

export interface FilterChipOption {
  value: string;
  label: string;
}

// searchParams 기반 상태 필터 칩 — 순수 링크 네비게이션이라 클라이언트 컴포넌트가 필요 없다.
export function FilterChips({
  basePath,
  paramKey,
  options,
  current,
}: {
  basePath: string;
  paramKey: string;
  options: FilterChipOption[];
  current?: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link
        href={basePath}
        className={cn(
          "inline-flex min-h-11 items-center rounded-full border px-4 text-xs font-bold tracking-tight transition-colors",
          !current
            ? "border-brand-600 bg-brand-50 text-brand-700"
            : "border-line bg-white text-ink-soft hover:border-brand-200",
        )}
      >
        전체
      </Link>
      {options.map((opt) => (
        <Link
          key={opt.value}
          href={`${basePath}?${paramKey}=${opt.value}`}
          className={cn(
            "inline-flex min-h-11 items-center rounded-full border px-4 text-xs font-bold tracking-tight transition-colors",
            current === opt.value
              ? "border-brand-600 bg-brand-50 text-brand-700"
              : "border-line bg-white text-ink-soft hover:border-brand-200",
          )}
        >
          {opt.label}
        </Link>
      ))}
    </div>
  );
}
