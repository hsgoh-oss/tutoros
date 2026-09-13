// 쿼리 파라미터(?student=)로 넘어온 값이 uuid 모양인지만 확인한다 — DB 조회는 Supabase eq()라
// 형태가 달라도 안전하지만, 화면 기본값(select defaultValue 등)에 그대로 흘려보내기 전에
// 엉뚱한 문자열을 걸러낸다. 형태가 아니면 무시하고 값 없음으로 취급한다.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined | null): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
