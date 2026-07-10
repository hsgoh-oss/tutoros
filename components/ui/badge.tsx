import { cn } from "@/lib/cn";
import type { HTMLAttributes } from "react";

type BadgeTone = "brand" | "soft" | "success" | "warning" | "danger";

const TONE: Record<BadgeTone, string> = {
  brand: "bg-brand-50 text-brand-700 border-brand-100",
  soft: "bg-soft text-ink-soft border-line",
  success: "bg-emerald-50 text-emerald-700 border-emerald-100",
  warning: "bg-amber-50 text-amber-700 border-amber-100",
  danger: "bg-rose-50 text-rose-700 border-rose-100",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = "brand", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-bold tracking-tight",
        TONE[tone],
        className,
      )}
      {...props}
    />
  );
}
