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
  as = "h2",
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  desc?: ReactNode;
  align?: "left" | "center";
  /** 페이지 선두 제목은 "h1"로 — 페이지당 문서 제목(랜드마크) 1개 보장. 기본은 섹션 제목 "h2". */
  as?: "h1" | "h2";
  className?: string;
}) {
  const Title = as;
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
      <Title className="text-[28px] font-black leading-[1.18] tracking-[-0.04em] md:text-[42px]">
        {title}
      </Title>
      {desc && (
        <p className="mt-4 text-[17px] leading-[1.86] tracking-tight text-muted">
          {desc}
        </p>
      )}
    </div>
  );
}
