/**
 * KST(UTC+9) 시각 규약 — 이 파일이 유일한 기준이다.
 *
 * 규약은 셋뿐이다:
 *  1. **저장은 UTC instant**다. DB의 timestamptz에는 절대 시각만 들어간다.
 *  2. **표시는 KST 벽시계**다. 운영자·학부모가 보는 모든 시각은 한국 시간이다.
 *  3. **입력(datetime-local)은 KST 벽시계**다. 운영자가 친 "19:01"은 한국 시간 19:01이다.
 *
 * 이 파일이 생긴 이유: 서버(Vercel)는 UTC로 돌기 때문에 `Date#getHours()`·`getDate()` 같은
 * "로컬" API는 전부 UTC를 돌려준다. 표시에서 이걸 쓰면 화면이 9시간 빠르고, 입력에서 쓰면
 * 저장이 9시간 늦다. 둘을 함께 틀리면 관리자 화면 안에서는 서로 상쇄돼 멀쩡해 보이지만,
 * KST를 제대로 계산하는 쪽(ICS 내보내기·SQL 일자 경계·학부모 캘린더)과 어긋난다.
 * 실제로 같은 회차가 화면에서는 19:01, 내보낸 캘린더에서는 04:01로 잡혔다.
 *
 * 그래서 **로컬 시간대에 의존하는 Date API를 이 파일 밖에서 쓰지 않는다.** 필요한 변환은
 * 전부 여기에 있고, 전부 `+9h 뒤 UTC 조각 읽기`(표시) / `벽시계 조립 후 -9h`(입력)로 한다.
 * 서버 TZ가 무엇이든 결과가 같다.
 */

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** UTC instant → KST 벽시계 조각. 파싱 불가면 null. */
function kstParts(
  iso: string | Date | null | undefined,
): { y: number; m: number; d: number; h: number; min: number } | null {
  if (iso === null || iso === undefined || iso === "") return null;
  const base = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(base.getTime())) return null;
  const k = new Date(base.getTime() + KST_OFFSET_MS);
  return {
    y: k.getUTCFullYear(),
    m: k.getUTCMonth() + 1,
    d: k.getUTCDate(),
    h: k.getUTCHours(),
    min: k.getUTCMinutes(),
  };
}

/** 표시용 "YYYY.MM.DD" (KST). */
export function formatKDate(iso: string | Date | null | undefined): string {
  const p = kstParts(iso);
  if (!p) return "-";
  return `${p.y}.${pad2(p.m)}.${pad2(p.d)}`;
}

/** 표시용 "YYYY.MM.DD HH:MM" (KST). */
export function formatKDateTime(iso: string | Date | null | undefined): string {
  const p = kstParts(iso);
  if (!p) return "-";
  return `${p.y}.${pad2(p.m)}.${pad2(p.d)} ${pad2(p.h)}:${pad2(p.min)}`;
}

/** 정렬·키·쿼리용 "YYYY-MM-DD" (KST). */
export function kstDateOnly(iso: string | Date | null | undefined): string {
  const p = kstParts(iso);
  if (!p) return "";
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
}

/** 표시용 "HH:MM" (KST). */
export function kstTime(iso: string | Date | null | undefined): string {
  const p = kstParts(iso);
  if (!p) return "-";
  return `${pad2(p.h)}:${pad2(p.min)}`;
}

/** 표(CSV) 정렬용 "YYYY-MM-DD HH:MM" (KST). */
export function kstStamp(iso: string | Date | null | undefined): string {
  const p = kstParts(iso);
  if (!p) return "";
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)} ${pad2(p.h)}:${pad2(p.min)}`;
}

/** `<input type="datetime-local">` 기본값 "YYYY-MM-DDTHH:mm" (KST). */
export function toKstDateTimeLocal(iso: string | Date | null | undefined): string {
  const p = kstParts(iso);
  if (!p) return "";
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}T${pad2(p.h)}:${pad2(p.min)}`;
}

// 타임존이 이미 붙은 문자열("...Z" / "...+09:00")은 절대 시각이므로 그대로 믿는다.
const HAS_TZ = /(?:Z|[+-]\d{2}:?\d{2})$/;
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * `<input type="datetime-local">` 값(KST 벽시계) → UTC instant.
 *
 * `new Date("2026-07-20T19:01")`은 **서버 로컬**로 해석돼 UTC 서버에서 19:01Z가 된다(9시간 늦음).
 * 여기서는 조각을 직접 읽어 KST 19:01 → 10:01Z로 옮긴다.
 */
export function parseKstWallClock(raw: string | null | undefined): Date | null {
  const value = (raw ?? "").trim();
  if (!value) return null;

  if (HAS_TZ.test(value)) {
    const abs = new Date(value);
    return Number.isNaN(abs.getTime()) ? null : abs;
  }

  const m = WALL_CLOCK.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, min, s] = m;
  const utcMs = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(min),
    s ? Number(s) : 0,
  );
  const at = new Date(utcMs - KST_OFFSET_MS);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** KST 기준 오늘 "YYYY-MM-DD". */
export function kstTodayDateOnly(now: Date = new Date()): string {
  return kstDateOnly(now);
}

/** KST "YYYY-MM-DD"의 00:00에 해당하는 UTC instant. */
export function kstDayStartUtc(dateOnly: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)) - KST_OFFSET_MS);
}

/** KST 날짜에 일수를 더한 "YYYY-MM-DD"(달·해 넘김 포함). */
export function addKstDays(dateOnly: string, days: number): string {
  const start = kstDayStartUtc(dateOnly);
  if (!start) return dateOnly;
  return kstDateOnly(new Date(start.getTime() + days * 24 * 60 * 60 * 1000));
}

/** KST 기준 그 날짜가 속한 주의 월요일 "YYYY-MM-DD". */
export function kstMondayOf(dateOnly: string): string {
  const start = kstDayStartUtc(dateOnly);
  if (!start) return dateOnly;
  // KST 자정의 UTC instant에 +9h를 더하면 그 날 정오 근처가 아니라 KST 00:00이라,
  // 요일은 KST 기준으로 읽어야 한다.
  const kstMidnight = new Date(start.getTime() + KST_OFFSET_MS);
  const day = kstMidnight.getUTCDay(); // 0=일 ... 6=토
  return addKstDays(dateOnly, day === 0 ? -6 : 1 - day);
}

/** KST 기준 이번 주 월요일 00:00 ~ 다음 주 월요일 00:00 (UTC ISO). */
export function kstWeekRangeUtc(now: Date = new Date()): { from: string; to: string } {
  const monday = kstMondayOf(kstDateOnly(now));
  const from = kstDayStartUtc(monday)!;
  const to = kstDayStartUtc(addKstDays(monday, 7))!;
  return { from: from.toISOString(), to: to.toISOString() };
}

/** KST 기준 오늘 00:00 ~ 내일 00:00 (UTC ISO). */
export function kstDayRangeUtc(now: Date = new Date()): { from: string; to: string } {
  const today = kstDateOnly(now);
  const from = kstDayStartUtc(today)!;
  const to = kstDayStartUtc(addKstDays(today, 1))!;
  return { from: from.toISOString(), to: to.toISOString() };
}

/** KST 기준 당월 1일 00:00의 UTC instant(ISO). */
export function kstMonthStartUtc(now: Date = new Date()): string {
  const p = kstParts(now)!;
  return kstDayStartUtc(`${p.y}-${pad2(p.m)}-01`)!.toISOString();
}

/** KST "YYYY-MM"에 개월을 더한 "YYYY-MM". */
export function addKstMonths(monthOnly: string, months: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthOnly.trim());
  if (!m) return monthOnly;
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + months;
  return `${Math.floor(total / 12)}-${pad2((total % 12) + 1)}`;
}
