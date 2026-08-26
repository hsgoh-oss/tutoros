import Link from "next/link";
import { cn } from "@/lib/cn";
import { kstTodayDateOnly } from "@/lib/kst";
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

/**
 * 모집 문구 자동 생성 — 정본이 하는 방식이다.
 *
 * 문구를 사람이 매달 손으로 고치게 두면 반드시 늦는다(실제로 8월 말까지 "7월 … 모집 중"이
 * 홈 최상단에 떠 있었다). 기준 달은 KST로 잡는다 — 서버가 UTC라 로컬 Date를 쓰면
 * 매달 1일 오전 9시까지 지난달이 나온다.
 *
 * 운영자가 관리자에서 문구를 직접 쓰면 그쪽이 이긴다. 비워 두면 이 함수가 맡는다.
 */
export function recruitMessage(recruit: RecruitStatus, today = kstTodayDateOnly()) {
  const custom = recruit.message?.trim();
  if (custom) return custom;

  const [year, month] = today.split("-");
  const period = `${Number(year)}년 ${Number(month)}월`;
  const seats = recruit.seatCount;

  switch (recruit.status) {
    case "open":
      return seats && seats > 0
        ? `${period} 신규 수강생 ${seats}명 모집 중`
        : `${period} 신규 수강생 모집 중`;
    case "closing":
      return seats && seats > 0
        ? `${period} 신규 수강생 ${seats}명 — 마감 임박`
        : `${period} 신규 수강생 모집 — 마감 임박`;
    case "waitlist":
      return `${period} 신규 수강생 모집 마감 — 대기 접수 중`;
    case "closed":
      return `${period} 신규 수강생 모집이 마감되었습니다`;
  }
}

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
        <span>{recruitMessage(recruit)}</span>
        <span className={cn("whitespace-nowrap", style.cta)}>
          {CTA_LABEL[recruit.status]} <span aria-hidden="true">→</span>
        </span>
      </span>
    </Link>
  );
}
