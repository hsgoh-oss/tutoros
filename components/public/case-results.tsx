import type { CaseItem } from "@/lib/types";

/**
 * 성적 향상 사례 — 컴팩트 리스트.
 *
 * 정본(axiom-platform)의 .case-row 조판: 카드로 띄우지 않고 규칙선으로 행을 나눈다.
 * 색은 "이후" 등급 하나만 얻는다 — 전·후를 둘 다 강조하면 무엇이 변했는지가 사라진다.
 */
export function CaseResults({ cases }: { cases: CaseItem[] }) {
  if (cases.length === 0) return null;

  return (
    <ul className="m-0 list-none border-t border-line-strong p-0">
      {cases.map((item) => (
        <li
          key={item.name}
          className="grid items-center gap-4 border-b border-line py-5 sm:grid-cols-[minmax(0,1fr)_auto]"
        >
          <p className="m-0 text-[15px] font-extrabold tracking-[-0.025em] text-ink">
            {item.name}
          </p>
          <div className="flex items-center gap-3">
            <span className="text-right">
              <span className="block text-[12.5px] font-extrabold tracking-[-0.01em] text-faint">
                {item.beforeLabel}
              </span>
              <span className="mt-1 inline-flex rounded-[var(--radius-sm)] bg-ink px-3.5 py-1.5 text-[15px] font-extrabold tracking-[-0.02em] whitespace-nowrap text-white">
                {item.beforeGrade}
              </span>
            </span>
            {/* 화살표는 라벨이 아니라 등급 칩 사이에 있어야 한다 — 위쪽 라벨 줄까지
                포함해 가운데를 잡으면 칩보다 한 줄 위로 뜬다. */}
            <span
              aria-hidden="true"
              className="self-end pb-1.5 text-lg font-extrabold text-hairline"
            >
              →
            </span>
            <span className="text-right">
              <span className="block text-[12.5px] font-extrabold tracking-[-0.01em] text-faint">
                {item.afterLabel}
              </span>
              <span className="mt-1 inline-flex rounded-[var(--radius-sm)] bg-brand-600 px-3.5 py-1.5 text-[15px] font-extrabold tracking-[-0.02em] whitespace-nowrap text-white">
                {item.afterGrade}
              </span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
