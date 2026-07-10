// 가명화 — AI 호출 전 실명을 "성+○○"로 치환하고, 발송 직전에만 역치환한다.
// 계약(기획서 6-4): AI 프롬프트에 실명이 절대 포함되지 않아야 한다.

const ALIAS_MARK = "○○";

function aliasFor(realName: string): string {
  return `${realName.trim()[0]}${ALIAS_MARK}`;
}

/** text 내 realName의 모든 출현을 "성+○○"로 치환한다. */
export function pseudonymize(text: string, realName: string): string {
  const trimmed = realName.trim();
  if (!trimmed) return text;
  return text.split(trimmed).join(aliasFor(trimmed));
}

/** pseudonymize로 치환된 "성+○○" 표기를 발송 직전 실명으로 되돌린다. */
export function restore(text: string, realName: string): string {
  const trimmed = realName.trim();
  if (!trimmed) return text;
  return text.split(aliasFor(trimmed)).join(trimmed);
}
