import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "outline" | "ghost" | "white";
export type ButtonSize = "sm" | "md" | "lg";

// hover 상승·그림자·굵기·높이는 전부 표면 변수로 뺀다(app/globals.css) — 공개 사이트는 CTA처럼,
// 관리자는 도구 버튼처럼 보이게 하려고 같은 컴포넌트를 두 얼굴로 쓴다.
const LIFT = "hover:[transform:translateY(var(--ui-lift))]";

const VARIANT: Record<ButtonVariant, string> = {
  primary: `bg-brand-600 text-white shadow-lift hover:bg-brand-700 ${LIFT}`,
  outline: `bg-white text-brand-600 border border-brand-200 shadow-card hover:border-brand-600 hover:bg-brand-50 ${LIFT}`,
  ghost: `bg-white text-ink-soft border border-line hover:border-brand-600 hover:text-brand-600 ${LIFT}`,
  white: `bg-white text-brand-600 shadow-soft ${LIFT}`,
};

const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-[var(--ui-h-sm)] px-4 text-sm",
  md: "min-h-[var(--ui-h-md)] px-6 text-[15px]",
  lg: "min-h-14 px-8 text-base",
};

export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] [font-weight:var(--ui-w-strong)] tracking-tight transition-all duration-200 cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 focus-visible:ring-offset-2",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  return (
    <button className={buttonClass(variant, size, className)} {...props} />
  );
}
