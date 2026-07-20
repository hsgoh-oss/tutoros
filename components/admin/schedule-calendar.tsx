import Link from "next/link";
import { cn } from "@/lib/cn";
import type { ScheduleItem } from "@/lib/types";
import type { ScheduleListItem } from "@/lib/data/crm";

// 월간 달력(서버 컴포넌트) — 한 달치 일정을 7열(일~토) 그리드로 렌더한다.
// scheduledAt(ISO)은 앱 런타임 로컬 기준으로 날짜 그룹핑한다(주간 뷰와 동일 기준).

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// 상태별 칩 색상 — Badge 톤과 동일 계열(예정=brand, 완료=emerald, 취소=rose, 보강=amber).
const STATUS_CHIP: Record<ScheduleItem["status"], string> = {
  planned: "bg-brand-50 text-brand-700",
  done: "bg-emerald-50 text-emerald-700",
  canceled: "bg-rose-50 text-rose-700 line-through",
  makeup: "bg-amber-50 text-amber-700",
};

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${min}`;
}

export function ScheduleCalendar({
  schedules,
  month,
}: {
  schedules: ScheduleListItem[];
  month: Date;
}) {
  const year = month.getFullYear();
  const monthIdx = month.getMonth();
  const firstWeekday = new Date(year, monthIdx, 1).getDay(); // 0=일 ... 6=토
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();

  // 로컬 날짜별 그룹핑. listSchedules가 scheduled_at 오름차순이라 각 배열은 시간순이 유지된다.
  const byDate = new Map<string, ScheduleListItem[]>();
  for (const s of schedules) {
    const key = dateKey(new Date(s.scheduledAt));
    const arr = byDate.get(key);
    if (arr) arr.push(s);
    else byDate.set(key, [s]);
  }

  // 앞(1일 요일)·뒤 빈 칸을 채워 7의 배수로 셀을 구성한다.
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const todayKey = dateKey(new Date());

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
            const key = dateKey(new Date(year, monthIdx, day));
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
