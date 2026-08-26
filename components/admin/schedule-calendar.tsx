import Link from "next/link";
import { cn } from "@/lib/cn";
import type { ScheduleItem } from "@/lib/types";
import type { ScheduleListItem } from "@/lib/data/crm";
import { kstDateOnly, kstTime, kstTodayDateOnly } from "@/lib/kst";

// 월간 달력(서버 컴포넌트) — 한 달치 일정을 7열 그리드로 렌더.
//
// 날짜 그룹핑은 **KST 기준**이다(주간 뷰와 동일). month를 Date가 아니라 "YYYY-MM" 문자열로 받는
// 이유도 같다 — Date로 넘기면 서버(UTC)에서 로컬 조각을 읽게 되어 KST 00~09시 회차가 전날 칸에
// 떨어진다. 달력 격자는 시간대가 없는 순수 달력이므로 조각 계산은 UTC API로만 한다.

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const STATUS_CHIP: Record<ScheduleItem["status"], string> = {
  planned: "bg-brand-50 text-brand-700",
  done: "bg-emerald-50 text-emerald-700",
  canceled: "bg-rose-50 text-rose-700 line-through",
  makeup: "bg-amber-50 text-amber-700",
  conflict: "bg-orange-100 text-orange-800 ring-1 ring-orange-300",
};

const pad2 = (n: number) => String(n).padStart(2, "0");

const formatTime = kstTime;

export function ScheduleCalendar({
  schedules,
  month,
}: {
  schedules: ScheduleListItem[];
  /** "YYYY-MM" (KST) */
  month: string;
}) {
  const [yRaw, mRaw] = month.split("-");
  const year = Number(yRaw);
  const monthIdx = Number(mRaw) - 1;
  const firstWeekday = new Date(Date.UTC(year, monthIdx, 1)).getUTCDay(); // 0=일 ... 6=토
  const daysInMonth = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();

  // KST 날짜별 그룹핑. listSchedules가 scheduled_at 오름차순이라 각 배열은 시간순이 유지된다.
  const byDate = new Map<string, ScheduleListItem[]>();
  for (const s of schedules) {
    const key = kstDateOnly(s.scheduledAt);
    const arr = byDate.get(key);
    if (arr) arr.push(s);
    else byDate.set(key, [s]);
  }

  // 앞(1일 요일)·뒤 빈 칸을 채워 7의 배수로 셀을 구성한다.
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const todayKey = kstTodayDateOnly();

  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <div className="min-w-[720px]">
        <div className="grid grid-cols-7 border-b border-line bg-soft">
          {WEEKDAYS.map((w, i) => (
            <div
              key={w}
              className={cn(
                "px-2 py-2 text-center text-xs font-bold",
                i === 0
                  ? "text-rose-600"
                  : i === 6
                    ? "text-brand-600"
                    : "text-muted",
              )}
            >
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            if (day === null) {
              return (
                <div
                  key={`blank-${i}`}
                  className="min-h-28 border-b border-r border-line bg-soft"
                />
              );
            }
            const key = `${year}-${pad2(monthIdx + 1)}-${pad2(day)}`;
            const items = byDate.get(key) ?? [];
            const isToday = key === todayKey;
            const weekday = i % 7;
            return (
              <div
                key={key}
                className="min-h-28 border-b border-r border-line p-1.5"
              >
                <div
                  className={cn(
                    "mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-bold",
                    isToday
                      ? "bg-brand-600 text-white"
                      : weekday === 0
                        ? "text-rose-600"
                        : weekday === 6
                          ? "text-brand-600"
                          : "text-ink",
                  )}
                >
                  {day}
                </div>
                <div className="flex flex-col gap-1">
                  {items.map((s) => (
                    <Link
                      key={s.id}
                      href={`/admin/schedules/${s.id}`}
                      title={`${formatTime(s.scheduledAt)} ${s.studentName}`}
                      className={cn(
                        "block truncate rounded-panel px-1.5 py-1 text-[11px] font-semibold leading-tight transition-opacity hover:opacity-80",
                        STATUS_CHIP[s.status],
                      )}
                    >
                      {formatTime(s.scheduledAt)} {s.studentName}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
