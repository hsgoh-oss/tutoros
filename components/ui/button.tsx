import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "outline" | "ghost" | "white";
export type ButtonSize = "sm" | "md" | "lg";

// 정본(axiom-platform)의 .btn — 최소 높이 48px, 반경 10px, 굵기 800, 자간 -0.025em.
// 그림자도 hover 상승도 없다: 버튼은 떠오르는 물체가 아니라 눌리는 면이다.
// 높이·굵기·반경은 표면 변수로 빼서 관리자에서 한 단계 더 조인다(app/globals.css).
const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "border border-brand-600 bg-brand-600 text-white hover:border-brand-700 hover:bg-brand-700",
  outline:
    "border border-line-strong bg-white text-muted hover:border-brand-600 hover:text-brand-600",
  ghost:
    "border border-line bg-white text-ink-soft hover:border-brand-600 hover:text-brand-600",
  // 어두운 밴드 위 — 흰 면이 곧 행동이다.
  white:
    "border border-white bg-white text-brand-700 hover:border-brand-light hover:bg-brand-light",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-[var(--ui-h-sm)] px-5 text-sm",
  md: "min-h-[var(--ui-h-md)] px-6 text-[15px]",
  lg: "min-h-14 px-8 text-base",
};

export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] [font-weight:var(--ui-w-strong)] tracking-[-0.025em] cursor-pointer whitespace-nowrap",
    "transition-[background-color,border-color,color] duration-[var(--motion-fast)] ease-[var(--motion-ease)]",
    "disabled:opacity-50 disabled:pointer-events-none",
    "focus-visible:outline-3 focus-visible:outline-brand-600/45 focus-visible:outline-offset-2",
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
