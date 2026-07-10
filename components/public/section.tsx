import { cn } from "@/lib/cn";
import type { HTMLAttributes, ReactNode } from "react";

export function Container({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mx-auto w-full max-w-7xl px-6 md:px-8", className)}
      {...props}
    />
  );
}

export function Section({
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return <section className={cn("py-20 md:py-26", className)} {...props} />;
}

export function SectionHeading({
  eyebrow,
  title,
  desc,
  align = "left",
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  desc?: ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-12",
        align === "center" && "mx-auto max-w-2xl text-center",
        className,
      )}
    >
      {eyebrow && (
        <p className="mb-3 text-sm font-extrabold tracking-tight text-brand-600">
          {eyebrow}
        </p>
      )}
      <h2 className="text-[28px] font-black leading-[1.18] tracking-[-0.04em] md:text-[42px]">
        {title}
      </h2>
      {desc && (
        <p className="mt-4 text-[17px] leading-[1.86] tracking-tight text-muted">
          {desc}
        </p>
      )}
    </div>
  );
}
