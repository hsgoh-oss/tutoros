import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// 목록이 비어 있을 때 공용 빈 상태 UI — 모듈별 등록 유도 문구만 다르게 전달.
export function EmptyState({
  title,
  description,
  action,
  compact = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cn(
      "dash-empty",
      compact ? "py-6" : "rounded-panel border border-line bg-white px-6 py-10 text-center",
    )}>
      <p className="text-sm text-muted">{title}</p>
      {description && (
        <p className="mt-2 text-xs leading-relaxed text-muted">{description}</p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
