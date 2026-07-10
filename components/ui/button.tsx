import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "outline" | "ghost" | "white";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-600 text-white shadow-lift hover:bg-brand-700 hover:-translate-y-0.5",
  outline:
    "bg-white text-brand-600 border border-brand-200 shadow-card hover:border-brand-600 hover:bg-brand-50 hover:-translate-y-0.5",
  ghost:
    "bg-white text-ink-soft border border-line hover:border-brand-600 hover:text-brand-600 hover:-translate-y-0.5",
  white: "bg-white text-brand-600 shadow-soft hover:-translate-y-0.5",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-11 px-4 text-sm",
  md: "min-h-12 px-6 text-[15px]",
  lg: "min-h-14 px-8 text-base",
};

export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-full font-extrabold tracking-tight transition-all duration-200 cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:pointer-events-none",
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
