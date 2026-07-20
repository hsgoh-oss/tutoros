import { cn } from "@/lib/cn";
import type { HTMLAttributes } from "react";

export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  // cn은 tailwind-merge가 아니라 clsx다 — 호출부가 bg-를 넘겨도 기본 bg-white가 함께 남아
  // CSS 순서상 흰색이 이겨버린다(예: bg-brand-50/40 틴트 카드가 흰색으로 렌더됨).
  // 배경색을 명시한 카드에서는 기본 bg-white를 빼서 override가 실제로 먹게 한다.
  const hasBgOverride = className ? /(?:^|\s)bg-/.test(className) : false;
  return (
    <div
      className={cn(
        "rounded-card border border-line p-6 shadow-card",
        !hasBgOverride && "bg-white",
        className,
      )}
      {...props}
    />
  );
}
