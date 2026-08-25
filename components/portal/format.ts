// 포털 공용 날짜 포맷 — 서버·클라이언트 양쪽에서 렌더링되므로 Asia/Seoul 고정.
// (런타임 로컬 타임존을 쓰면 SSR/하이드레이션 결과가 어긋날 수 있다.)
// lib/data/crm.ts formatKDate는 supabase 서버 클라이언트를 끌고 오므로
// 클라이언트 컴포넌트에서는 이 파일을 쓴다.

const DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** ISO 문자열 → "YYYY.MM.DD" (Asia/Seoul). 잘못된 값은 "-". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return DATE_FMT.format(d).replace(/-/g, ".");
}

/** ISO 문자열 → "YYYY.MM.DD HH:mm" (Asia/Seoul). 잘못된 값은 "-". */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${DATE_FMT.format(d).replace(/-/g, ".")} ${TIME_FMT.format(d)}`;
}

/** 오늘 날짜(Asia/Seoul, "YYYY-MM-DD") — 과제 기한 경과(H-02 지연) 판정용. */
export function kstToday(): string {
  return DATE_FMT.format(new Date());
}
