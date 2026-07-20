// 자동화 잡 전용 메시지 템플릿 — Deno 런타임이 lib/notify/templates.ts(Node 의존)를 import할 수 없어
// 실제 쓰는 문구만 복제한다. 변경 시 lib/notify/templates.ts와 수동으로 맞출 것(docs/cron-definitions.md).

export function formatWon(amount: number): string {
  return `${amount.toLocaleString("ko-KR")}원`;
}

export function lessonReminderMessage(name: string, dateLabel: string): string {
  return `${name}님, ${dateLabel} 수업 예정입니다. 준비물을 확인해 주세요.`;
}

export function paymentD3Message(name: string, amount: number): string {
  return `${name}님, 결제 마감일이 3일 남았습니다. (${formatWon(amount)})`;
}

export function paymentOverdueMessage(name: string, amount: number): string {
  return `${name}님, 결제 기한이 지났습니다. 확인 부탁드립니다. (${formatWon(amount)})`;
}

export function reviewRequestMessage(name: string): string {
  return `${name}님, 그동안의 수업은 어떠셨나요? 짧은 후기를 남겨 주시면 큰 힘이 됩니다.`;
}
