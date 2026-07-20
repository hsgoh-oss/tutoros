import { cn } from "@/lib/cn";
import type { HTMLAttributes } from "react";

export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  // cn은 clsx라 merge가 없다 — bg-를 넘겨도 기본 bg-white가 남아 이겨버리므로 지정 시 bg-white를 뺀다.
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
