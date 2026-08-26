import { cn } from "@/lib/cn";
import type { HTMLAttributes, ReactNode } from "react";

// 정본(axiom-platform)의 공개면 조판 프리미티브.
// 폭·리듬·제목 계층은 전부 토큰에서 온다(app/globals.css) — 페이지가 숫자를 직접 쓰지 않는다.

/** 기본 콘텐츠 폭 — min(1216px, 100% - gutter*2). 헤더·본문·푸터가 같은 세로 기준선을 공유한다. */
export function Container({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("axm-measure", className)} {...props} />;
}

/** 약관·정책처럼 읽는 문서의 폭 — 68ch. */
export function DocContainer({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("axm-measure-doc", className)} {...props} />;
}

export function Section({
  className,
  sunken = false,
  ...props
}: HTMLAttributes<HTMLElement> & { sunken?: boolean }) {
  return (
    <section
      className={cn("axm-section", sunken && "axm-section-sunken", className)}
      {...props}
    />
  );
}

/**
 * 섹션 머리.
 *
 * 아이브로우는 `번호 + 영문 레이블`이다 — 장식이 아니라 스캔 앵커라서 번호가 스크롤
 * 위치를 고정한다. 다만 제목 계층에는 끼지 않으므로(h1 → h2 → h3 유지) b 로만 둔다.
 */
export function SectionHeading({
  index,
  eyebrow,
  title,
  desc,
  action,
  as = "h2",
  id,
  className,
}: {
  /** 아이브로우 앞 번호 — "02" 처럼 두 자리. */
  index?: string;
  eyebrow?: string;
  title: ReactNode;
  desc?: ReactNode;
  /** 제목 줄 오른쪽 끝의 이동 링크. */
  action?: ReactNode;
  /** 페이지 선두 제목은 "h1"로 — 페이지당 문서 제목(랜드마크) 1개 보장. */
  as?: "h1" | "h2";
  id?: string;
  className?: string;
}) {
  const Title = as;
  return (
    <div className={cn("mb-6", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          {eyebrow && (
            <p className="axm-eyebrow">
              {index && <b aria-hidden="true">{index}</b>}
              {eyebrow}
            </p>
          )}
          <Title
            id={id}
            className={cn(
              "axm-section-title",
              as === "h1" && "[font:var(--font-display-2)] [letter-spacing:var(--tracking-display)]",
            )}
          >
            {title}
          </Title>
        </div>
        {action}
      </div>
      {desc && <p className="axm-section-lead mt-4">{desc}</p>}
    </div>
  );
}

/**
 * 섹션 머리 오른쪽의 이동 링크 스타일 — "→" 는 호출부에서 문장에 붙인다.
 * inline-flex + min-h-11: 글자 높이는 20px이라 그대로 두면 모바일 탭 타깃이 절반도 안 된다.
 */
export const textLinkClass =
  "inline-flex min-h-11 items-center text-sm font-extrabold tracking-[-0.02em] text-brand-600 underline-offset-4 hover:text-brand-700 hover:underline";
