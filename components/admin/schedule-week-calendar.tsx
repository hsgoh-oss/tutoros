import Link from "next/link";
import { cn } from "@/lib/cn";
import type { ScheduleItem } from "@/lib/types";
import type { ScheduleListItem } from "@/lib/data/crm";
import {
  addKstDays,
  kstDateOnly,
  kstMinuteOfDay,
  kstTime,
  kstTodayDateOnly,
} from "@/lib/kst";

// 주간 시간 격자(서버 컴포넌트) — 한 주치 회차를 요일 × 시각 평면에 놓는다.
//
// 표로 보던 것을 격자로 바꾼 이유는 표가 답하지 못하는 질문이 운영의 대부분이기 때문이다:
// "화요일 저녁이 비었나", "이 학생 뒤에 바로 다른 수업이 붙어 있나", "이번 주가 얼마나 찼나".
// 시각순 목록은 한 줄씩 읽어야 알 수 있고, 격자는 보면 안다.
//
// 시각 조각은 전부 lib/kst.ts로만 읽는다(kstMinuteOfDay·kstDateOnly). 서버가 UTC라
// getHours()로 세로 위치를 잡으면 모든 회차가 9시간 위로 밀린다 — KST 00~09시 회차는
// 전날 칸으로 새기까지 한다.

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];

const STATUS_BLOCK: Record<ScheduleItem["status"], string> = {
  planned: "bg-brand-50 text-brand-700 ring-1 ring-brand-100",
  done: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
  canceled: "bg-rose-50 text-rose-700 ring-1 ring-rose-100 line-through",
  makeup: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
  conflict: "bg-orange-100 text-orange-800 ring-1 ring-orange-300",
};

/** 회차가 없어도 이 시간대는 항상 보여 준다 — 빈 주에 격자가 한 줄로 찌그러지지 않게. */
const BASE_START_MIN = 9 * 60;
const BASE_END_MIN = 22 * 60;
/** 한 시간의 세로 높이(px). 30분 회차도 글자가 들어갈 만큼은 준다. */
const HOUR_PX = 56;
/** 종료 시각이 없는 회차의 표시 길이 — 실제 길이가 아니라 자리 표시라는 뜻이다. */
const DEFAULT_DURATION_MIN = 60;

interface PlacedItem {
  item: ScheduleListItem;
  startMin: number;
  endMin: number;
  /** 겹침 묶음 안에서의 가로 위치(0부터). */
  column: number;
  /** 그 묶음이 쓰는 세로 열 수. */
  columnCount: number;
}

/**
 * 하루치 회차를 겹침까지 고려해 배치한다.
 *
 * 겹치는 것들만 폭을 나눈다 — 하루에 한 번이라도 겹치면 그날 전체를 좁히는 방식은
 * 대부분의 날을 이유 없이 절반 폭으로 만든다. 그래서 "서로 맞닿아 이어지는 덩어리"
 * (cluster) 단위로 열 수를 따로 센다.
 */
function placeDay(items: ScheduleListItem[]): PlacedItem[] {
  const timed = items
    .map((item) => {
      const startMin = kstMinuteOfDay(item.scheduledAt);
      if (startMin === null) return null;
      const rawEnd = item.endsAt === null ? null : kstMinuteOfDay(item.endsAt);
      // 자정을 넘기거나 끝이 시작보다 이른 값(입력 오류·자정 넘김)은 기본 길이로 되돌린다.
      // 다음 날까지 이어지는 회차를 이 격자가 표현하지 못한다는 사실을 숨기지 않기 위해,
      // 늘리지 않고 그날 안에서 끊는다.
      const endMin =
        rawEnd !== null && rawEnd > startMin ? rawEnd : startMin + DEFAULT_DURATION_MIN;
      return { item, startMin, endMin: Math.min(endMin, 24 * 60) };
    })
    .filter((v): v is { item: ScheduleListItem; startMin: number; endMin: number } => v !== null)
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const placed: PlacedItem[] = [];
  let cluster: PlacedItem[] = [];
  let clusterEnd = -1;
  /** 열별 마지막 종료 시각 — 끝난 열은 재사용한다. */
  let columnEnds: number[] = [];

  const flush = () => {
    const count = Math.max(1, columnEnds.length);
    for (const p of cluster) p.columnCount = count;
    placed.push(...cluster);
    cluster = [];
    columnEnds = [];
    clusterEnd = -1;
  };

  for (const t of timed) {
    if (cluster.length > 0 && t.startMin >= clusterEnd) flush();

    let column = columnEnds.findIndex((end) => end <= t.startMin);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(t.endMin);
    } else {
      columnEnds[column] = t.endMin;
    }

    cluster.push({ ...t, column, columnCount: 1 });
    clusterEnd = Math.max(clusterEnd, t.endMin);
  }
  if (cluster.length > 0) flush();

  return placed;
}

export function ScheduleWeekCalendar({
  schedules,
  monday,
}: {
  schedules: ScheduleListItem[];
  /** 그 주 월요일 "YYYY-MM-DD" (KST) */
  monday: string;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addKstDays(monday, i));

  const byDate = new Map<string, ScheduleListItem[]>();
  for (const s of schedules) {
    const key = kstDateOnly(s.scheduledAt);
    const arr = byDate.get(key);
    if (arr) arr.push(s);
    else byDate.set(key, [s]);
  }

  const placedByDate = new Map<string, PlacedItem[]>();
  for (const day of days) placedByDate.set(day, placeDay(byDate.get(day) ?? []));

  // 격자 범위는 기본 09~22시에서 출발해 실제 회차가 벗어나는 만큼만 넓힌다.
  // 항상 00~24시를 그리면 대부분이 빈 칸이라 정작 수업 구간이 눌린다.
  let startMin = BASE_START_MIN;
  let endMin = BASE_END_MIN;
  for (const placed of placedByDate.values()) {
    for (const p of placed) {
      startMin = Math.min(startMin, p.startMin);
      endMin = Math.max(endMin, p.endMin);
    }
  }
  const startHour = Math.floor(startMin / 60);
  const endHour = Math.min(24, Math.ceil(endMin / 60));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const totalMin = (endHour - startHour) * 60;
  const gridHeight = hours.length * HOUR_PX;

  const todayKey = kstTodayDateOnly();

  return (
    <div className="overflow-x-auto rounded-card border border-line [-webkit-overflow-scrolling:touch]">
      {/* 좁은 화면에서는 7일 격자가 화면보다 넓다 — 옆으로 밀 수 있다는 것을 첫 줄에서 말한다. */}
      <p className="m-0 border-b border-line bg-soft px-3 py-1.5 text-[11px] font-bold text-muted md:hidden">
        주간표는 옆으로 밀어 볼 수 있습니다 · 아래 목록에서도 회차를 관리할 수 있습니다
      </p>
      <div className="min-w-[760px]">
        {/* 요일 머리 — 시간 눈금 폭(56px)만큼 왼쪽을 비워 본문 열과 정확히 맞춘다. */}
        <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-line bg-soft">
          <div aria-hidden />
          {days.map((day, i) => {
            const isToday = day === todayKey;
            return (
              <div
                key={day}
                className={cn(
                  "border-l border-line px-2 py-2 text-center",
                  isToday && "bg-brand-50",
                )}
              >
                <p
                  className={cn(
                    "text-xs font-bold",
                    i === 5 ? "text-brand-600" : i === 6 ? "text-rose-600" : "text-muted",
                  )}
                >
                  {WEEKDAYS[i]}
                </p>
                <p
                  className={cn(
                    "mt-0.5 text-sm font-semibold tracking-tight",
                    isToday ? "text-brand-700" : "text-ink",
                  )}
                >
                  {Number(day.slice(8, 10))}
                </p>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]">
          {/* 시간 눈금 */}
          <div style={{ height: gridHeight }}>
            {hours.map((h) => (
              <div
                key={h}
                className="relative border-b border-line"
                style={{ height: HOUR_PX }}
              >
                <span className="absolute -top-2 right-1.5 text-[11px] font-bold text-muted">
                  {h}시
                </span>
              </div>
            ))}
          </div>

          {days.map((day) => {
            const placed = placedByDate.get(day) ?? [];
            const isToday = day === todayKey;
            return (
              <div
                key={day}
                className={cn(
                  "relative border-l border-line",
                  isToday && "bg-brand-50/40",
                )}
                style={{ height: gridHeight }}
              >
                {/* 시간 눈금선 — 배경이라 클릭을 가로채지 않게 pointer-events를 끈다. */}
                <div className="pointer-events-none absolute inset-0">
                  {hours.map((h) => (
                    <div
                      key={h}
                      className="border-b border-line"
                      style={{ height: HOUR_PX }}
                    />
                  ))}
                </div>

                {placed.map((p) => {
                  const top = ((p.startMin - startHour * 60) / totalMin) * 100;
                  const height = ((p.endMin - p.startMin) / totalMin) * 100;
                  const width = 100 / p.columnCount;
                  return (
                    <Link
                      key={p.item.id}
                      href={`/admin/schedules/${p.item.id}`}
                      title={`${kstTime(p.item.scheduledAt)} ${p.item.studentName}`}
                      className={cn(
                        "absolute overflow-hidden rounded-panel px-1.5 py-1 text-[11px] font-semibold leading-tight transition-opacity hover:opacity-80",
                        STATUS_BLOCK[p.item.status],
                      )}
                      style={{
                        top: `${top}%`,
                        height: `calc(${height}% - 2px)`,
                        left: `calc(${p.column * width}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                      }}
                    >
                      <span className="block truncate">{kstTime(p.item.scheduledAt)}</span>
                      <span className="block truncate">{p.item.studentName}</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
