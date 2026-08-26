import Link from "next/link";
import { cn } from "@/lib/cn";
import type { RecruitStatus } from "@/lib/types";

// 정본(axiom-platform)의 .topstrip — 화면 맨 위 한 줄. 상태 라벨 칩을 따로 두지 않고
// 문장 자체가 상태를 말한다("… 모집 중" / "… 마감"). 오른쪽 끝은 항상 다음 행동이다.
//
// 마감이어도 띠를 숨기지 않는다: 자리가 없다는 사실도 알려야 하고, 대기 접수로 가는 길이
// 여기 말고는 없다. 대신 색을 낮춰 행동을 재촉하지 않는다.

const STATE_STYLE: Record<RecruitStatus["status"], { bar: string; cta: string }> = {
  open: { bar: "bg-brand-600 text-white", cta: "text-brand-100" },
  closing: { bar: "bg-brand-700 text-white", cta: "text-brand-light" },
  waitlist: { bar: "bg-ink-soft text-white", cta: "text-white/70" },
  closed: { bar: "bg-soft text-ink-soft", cta: "text-brand-600" },
};

const CTA_LABEL: Record<RecruitStatus["status"], string> = {
  open: "상담 신청하기",
  closing: "상담 신청하기",
  waitlist: "대기 신청하기",
  closed: "대기 안내 보기",
};

export function RecruitBanner({ recruit }: { recruit: RecruitStatus }) {
  if (!recruit.isBannerVisible) return null;
  const style = STATE_STYLE[recruit.status];

  return (
    <Link
      href={recruit.status === "open" ? "/apply" : "/apply?waitlist=1"}
      className={cn(
        "block border-b border-line transition-opacity hover:opacity-95",
        style.bar,
      )}
    >
      <span className="axm-measure flex min-h-11 flex-wrap items-center justify-center gap-x-2.5 gap-y-1 py-2.5 text-center text-[13.5px] font-extrabold tracking-[-0.01em]">
        <span>{recruit.message}</span>
        <span className={cn("whitespace-nowrap", style.cta)}>
          {CTA_LABEL[recruit.status]} <span aria-hidden="true">→</span>
        </span>
      </span>
    </Link>
  );
}
