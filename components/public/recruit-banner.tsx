import Link from "next/link";
import { cn } from "@/lib/cn";
import type { RecruitStatus } from "@/lib/types";

// 모집 현황 배너 — 상태별 색상(모집중·마감임박·대기·마감), 문구 즉시 반영.

const STATE_STYLE: Record<
  RecruitStatus["status"],
  { chip: string; label: string; bar: string }
> = {
  open: {
    chip: "bg-white/20 text-white",
    label: "모집 중",
    bar: "bg-brand-600 text-white",
  },
  closing: {
    chip: "bg-amber-100 text-amber-900",
    label: "마감 임박",
    bar: "bg-amber-500 text-white",
  },
  waitlist: {
    chip: "bg-white/20 text-white",
    label: "대기 접수",
    bar: "bg-ink-soft text-white",
  },
  closed: {
    chip: "bg-white/15 text-white/80",
    label: "모집 마감",
    bar: "bg-muted text-white",
  },
};

export function RecruitBanner({ recruit }: { recruit: RecruitStatus }) {
  if (!recruit.isBannerVisible) return null;
  const style = STATE_STYLE[recruit.status];

  return (
    <Link
      href="/consult"
      className={cn(
        "block text-center text-sm font-bold tracking-tight transition-opacity hover:opacity-90",
        style.bar,
      )}
    >
      {/* 배너 전체가 /consult로 가는 CTA — 모바일 탭타깃 48px 확보 */}
      <span className="mx-auto inline-flex min-h-12 w-full max-w-7xl items-center justify-center gap-2.5 px-6 md:px-8">
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11px] font-black",
            style.chip,
          )}
        >
          {style.label}
        </span>
        {recruit.message}
        {recruit.status !== "closed" && <span aria-hidden>→</span>}
      </span>
    </Link>
  );
}
