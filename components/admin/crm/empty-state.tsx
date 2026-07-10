import type { ReactNode } from "react";

// 목록이 비어 있을 때 공용 빈 상태 UI — 모듈별 등록 유도 문구만 다르게 전달.
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-panel border border-dashed border-line bg-soft px-6 py-12 text-center">
      <p className="text-sm font-extrabold text-ink-soft">{title}</p>
      {description && (
        <p className="mt-1.5 text-sm text-muted">{description}</p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
