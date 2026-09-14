import Link from "next/link";

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
  preserveParams = {},
}: {
  basePath: string;
  paramKey: string;
  options: FilterChipOption[];
  current?: string;
  preserveParams?: Record<string, string | undefined>;
}) {
  function hrefFor(value?: string) {
    const params = new URLSearchParams();
    for (const [key, preserved] of Object.entries(preserveParams)) {
      if (preserved && key !== paramKey) params.set(key, preserved);
    }
    if (value) params.set(paramKey, value);
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  }

  return (
    <div className="dash-filter-tabs">
      {[{ value: "", label: "전체" }, ...options].map((option) => (
        <Link key={option.value} href={hrefFor(option.value)}
          aria-current={(current ?? "") === option.value ? "page" : undefined}
          className="dash-filter-tab">
          {option.label}
        </Link>
      ))}
    </div>
  );
}
