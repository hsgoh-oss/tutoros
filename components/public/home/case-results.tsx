import type { CaseItem } from "@/lib/types";

export function CaseResults({ cases }: { cases: CaseItem[] }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {cases.map((item) => (
        <div
          key={item.name}
          className="rounded-card border border-line bg-white p-7 shadow-card"
        >
          <p className="text-sm font-bold tracking-tight text-muted">
            {item.name}
          </p>
          <div className="mt-5 flex items-center gap-4">
            <div className="text-center">
              <p className="text-xs font-bold tracking-tight text-muted">
                {item.beforeLabel}
              </p>
              <p className="mt-1.5 text-3xl font-black tracking-tight text-ink-soft">
                {item.beforeGrade}
              </p>
            </div>
            <span aria-hidden className="text-2xl font-black text-brand-300">
              →
            </span>
            <div className="text-center">
              <p className="text-xs font-bold tracking-tight text-muted">
                {item.afterLabel}
              </p>
              <p className="mt-1.5 text-4xl font-black tracking-tight text-brand-600">
                {item.afterGrade}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
