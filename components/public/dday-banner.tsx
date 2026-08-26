"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { Dday } from "@/lib/types";
import { kstDayStartUtc, kstTodayDateOnly } from "@/lib/kst";

// 정본(axiom-platform)의 .dday-strip — 흰 면 위 규칙선 한 줄. 카드도 알약도 아니다.
// 가장 가까운 일정 하나만 색을 얻고, 나머지는 잉크로 남는다: 전부 빨갛게 켜면 무엇이 급한지 사라진다.
//
// 계산은 마운트 후 클라이언트에서 한다 — 서버/클라 시각차로 인한 하이드레이션 불일치 회피.
// 기준은 보는 사람의 로컬이 아니라 **KST**다: 한국 시험의 D-day는 접속 지역과 무관하게 같아야 하고,
// 관리자 화면(서버 렌더)과도 같은 값이 나와야 한다.

function daysUntil(dateStr: string): number {
  const target = kstDayStartUtc(dateStr);
  const today = kstDayStartUtc(kstTodayDateOnly());
  if (!target || !today) return 0;
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/**
 * 근접 칩의 배경색 — 남은 날수에 따라 파랑에서 적색으로 옮겨 간다.
 *
 * 칩은 흰 글자를 얹으므로 모든 정지점이 흰색에서 4.5:1 이상이어야 한다. 정본에서
 * 앰버 정지점이 [186,120,24]일 때 3.63:1로 미달해(WCAG 상대휘도 실측) 색상은 유지하고
 * 명도만 내려 5.58:1로 올린 값이다. 보간 구간도 함께 통과한다. 눈으로 고치지 말 것.
 */
function nearColor(days: number) {
  const stops: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
    [150, [43, 92, 230]],
    [90, [47, 110, 196]],
    [45, [150, 90, 12]],
    [14, [205, 54, 45]],
    [0, [176, 32, 26]],
  ];
  const value = Math.max(0, Math.min(150, days));
  let start = stops[0];
  let end = stops.at(-1) ?? stops[0];
  for (let index = 0; index < stops.length - 1; index += 1) {
    if (value <= stops[index][0] && value >= stops[index + 1][0]) {
      start = stops[index];
      end = stops[index + 1];
      break;
    }
  }
  const ratio = start[0] === end[0] ? 0 : (start[0] - value) / (start[0] - end[0]);
  const color = start[1].map((channel, index) =>
    Math.round(channel + (end[1][index] - channel) * ratio),
  );
  return `rgb(${color.join(",")})`;
}

export function DdayBanner({ ddays }: { ddays: Dday[] }) {
  const [items, setItems] = useState<{ dday: Dday; left: number }[]>([]);

  useEffect(() => {
    setItems(
      ddays
        .filter((d) => d.isVisible)
        .map((dday) => ({ dday, left: daysUntil(dday.examDate) }))
        .filter(({ left }) => left >= 0)
        .sort((a, b) => a.left - b.left),
    );
  }, [ddays]);

  if (items.length === 0) return null;

  return (
    <div
      className="border-b border-line bg-white"
      role="note"
      aria-label="주요 입시 일정"
    >
      <div className="axm-measure flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 py-2.5">
        {items.map(({ dday, left }, index) => {
          const near = index === 0;
          return (
            <span
              key={dday.id}
              className={cn(
                "inline-flex items-center gap-2.5",
                // 모바일에서는 한 줄에 하나씩 떨어지므로 이름과 남은 날수를 양 끝으로 민다.
                "max-sm:w-full max-sm:justify-between",
                // 항목 사이 세로 규칙선 — 칸막이가 아니라 구분자라 얇게 둔다.
                // 줄바꿈되면 줄 앞머리에 막대만 남으므로 한 줄로 설 때만 켠다.
                index > 0 && "sm:border-l sm:border-line sm:pl-4",
              )}
            >
              <span className="text-[13px] font-extrabold tracking-[-0.02em] text-ink-soft">
                {dday.name}
              </span>
              <strong
                className={cn(
                  "inline-flex items-center text-[13px] font-extrabold tabular-nums",
                  near
                    ? "rounded-[var(--radius-sm)] px-2.5 py-1 leading-none text-white"
                    : "text-ink",
                )}
                style={near ? { background: nearColor(left) } : undefined}
              >
                {left === 0 ? "D-DAY" : `D-${left}`}
              </strong>
            </span>
          );
        })}
      </div>
    </div>
  );
}
