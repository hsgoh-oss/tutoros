// 가명화 — AI 호출 전 실명을 "성+○○"로 치환하고 발송 직전에만 역치환. AI 프롬프트엔 실명이 절대 들어가면 안 된다(기획서 6-4).

const ALIAS_MARK = "○○";

function aliasFor(realName: string): string {
  return `${realName.trim()[0]}${ALIAS_MARK}`;
}

export function pseudonymize(text: string, realName: string): string {
  const trimmed = realName.trim();
  if (!trimmed) return text;
  return text.split(trimmed).join(aliasFor(trimmed));
}

export function restore(text: string, realName: string): string {
  const trimmed = realName.trim();
  if (!trimmed) return text;
  return text.split(aliasFor(trimmed)).join(trimmed);
}
