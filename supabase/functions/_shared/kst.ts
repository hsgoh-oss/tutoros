// Asia/Seoul(KST) 날짜 계산 — 실행 서버의 로컬 타임존에 의존하지 않고 항상 Intl로 KST 캘린더일을 뽑아 변환한다.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** 임의 시각의 KST 캘린더일(y, m, d) */
export function kstParts(now: Date = new Date()): { y: number; m: number; d: number } {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now); // "YYYY-MM-DD"
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

/** KST 캘린더일(y,m,d + dayOffset)의 자정을 UTC 시각(Date)으로 변환 — KST = UTC+9 */
export function kstMidnightUtc(y: number, m: number, d: number, dayOffset = 0): Date {
  return new Date(Date.UTC(y, m - 1, d + dayOffset) - 9 * 3600 * 1000);
}

/** [start, end) — KST 기준 "오늘 + dayOffset"일 하루의 UTC 범위 (timestamptz 컬럼 비교용) */
export function kstDayRangeUtc(
  dayOffset: number,
  now: Date = new Date(),
): { start: Date; end: Date } {
  const { y, m, d } = kstParts(now);
  return {
    start: kstMidnightUtc(y, m, d, dayOffset),
    end: kstMidnightUtc(y, m, d, dayOffset + 1),
  };
}

/** KST 기준 "오늘 + dayOffset"일의 "YYYY-MM-DD" (payments.due_date 등 date 컬럼 비교용) */
export function kstDateString(dayOffset: number, now: Date = new Date()): string {
  const { y, m, d } = kstParts(now);
  const utcMidnight = new Date(Date.UTC(y, m - 1, d + dayOffset));
  return `${utcMidnight.getUTCFullYear()}-${pad(utcMidnight.getUTCMonth() + 1)}-${pad(utcMidnight.getUTCDate())}`;
}

/** 알림 메시지용 KST 표기 — 예: "7월 8일 18:00" */
export function formatKstDateTime(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")} ${get("day")} ${get("hour")}:${get("minute")}`;
}
