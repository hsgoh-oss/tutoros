import Link from "next/link";
import { cn } from "@/lib/cn";
import type { Dday } from "@/lib/types";
import { kstDayStartUtc, kstTodayDateOnly } from "@/lib/kst";

// 입시 일정 월간 캘린더(서버 컴포넌트) — 시험일을 달력 평면에 놓는다.
//
// D-day를 목록으로만 두면 "수능까지 며칠"은 알 수 있어도 "이번 달에 뭐가 있나",
// "학평과 중간고사가 같은 주에 겹치나"는 알 수 없다. 수업 주간 캘린더와 같은 이유로 격자다.
//
// 날짜는 전부 "YYYY-MM-DD" 문자열로만 다룬다(ddays.exam_date가 date 컬럼이라 시각이 없다).
// 격자 조각 계산은 시간대가 없는 순수 달력이므로 UTC API로만 한다 — schedule-calendar.tsx와 같은 규약.

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const pad2 = (n: number) => String(n).padStart(2, "0");

/** KST 자정 기준 남은 일수. 시험은 한국 시험이라 기준도 KST여야 한다(대시보드와 같은 계산). */
export function daysUntilExam(examDate: string, today = kstTodayDateOnly()): number {
  const start = kstDayStartUtc(today);
  const target = kstDayStartUtc(examDate);
  if (!start || !target) return 0;
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

export function ddayLabel(examDate: string, today = kstTodayDateOnly()): string {
  const n = daysUntilExam(examDate, today);
  if (n === 0) return "D-DAY";
  return n > 0 ? `D-${n}` : `D+${Math.abs(n)}`;
}

export function DdayCalendar({
  ddays,
  month,
  /** 달 이동 링크의 기준 경로. 쿼리 `month`를 붙여 넘긴다. */
  basePath,
}: {
  ddays: Dday[];
  /** "YYYY-MM" */
  month: string;
  basePath: string;
}) {
  const [yRaw, mRaw] = month.split("-");
  const year = Number(yRaw);
  const monthIdx = Number(mRaw) - 1;
  const firstWeekday = new Date(Date.UTC(year, monthIdx, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();

  const byDate = new Map<string, Dday[]>();
  for (const d of ddays) {
    const arr = byDate.get(d.examDate);
    if (arr) arr.push(d);
    else byDate.set(d.examDate, [d]);
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const todayKey = kstTodayDateOnly();
  const inMonth = ddays.filter((d) => d.examDate.slice(0, 7) === month);

  // 이 달이 비었을 때 빈 격자만 보여 주고 끝내지 않는다 — 입시 일정은 몇 달씩 비는 게 정상이라
  // "없음"만 보이면 화면이 고장 난 것처럼 읽힌다. 다음 시험이 언제인지와 그 달로 가는 길을 같이 준다.
  const upcoming = ddays
    .filter((d) => d.examDate >= todayKey)
    .sort((a, b) => a.examDate.localeCompare(b.examDate))[0];

  return (
    <div>
      <div className="overflow-x-auto rounded-card border border-line">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-7 border-b border-line bg-soft">
            {WEEKDAYS.map((w, i) => (
              <div
                key={w}
                className={cn(
                  "px-2 py-2 text-center text-xs font-bold",
                  i === 0 ? "text-rose-600" : i === 6 ? "text-brand-600" : "text-muted",
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
                    className="min-h-24 border-b border-r border-line bg-soft"
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
                  className="min-h-24 border-b border-r border-line p-1.5"
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
                    {items.map((d) => (
                      <div
                        key={d.id}
                        title={`${d.name} · ${ddayLabel(d.examDate)}`}
                        className={cn(
                          "rounded-panel px-1.5 py-1 text-[11px] font-semibold leading-tight",
                          // 숨김 항목도 격자에서 지우지 않는다 — 운영자에게는 존재하는 일정이고,
                          // 공개면에 안 나갈 뿐이라는 사실을 색으로만 구분한다.
                          d.isVisible
                            ? "bg-brand-50 text-brand-700"
                            : "bg-soft text-muted line-through",
                        )}
                      >
                        <span className="block truncate">{d.name}</span>
                        <span className="block text-[10px] font-bold opacity-80">
                          {ddayLabel(d.examDate)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {inMonth.length === 0 && (
        <p className="mt-3 text-sm text-muted">
          이 달에 등록된 입시 일정이 없습니다.
          {upcoming ? (
            <>
              {" "}
              다음 일정은 <strong className="text-ink-soft">{upcoming.name}</strong> (
              {upcoming.examDate} · {ddayLabel(upcoming.examDate)})입니다.{" "}
              <Link
                href={`${basePath}?month=${upcoming.examDate.slice(0, 7)}`}
                className="font-bold text-brand-700 hover:underline"
              >
                그 달 보기 →
              </Link>
            </>
          ) : (
            " 앞으로 예정된 일정도 없습니다 — 아래에서 추가해 주세요."
          )}
        </p>
      )}
    </div>
  );
}
