/** An unavailable source is never an empty business result. Details stay in server logs. */
export function assertQuery(error: { message: string; code?: string } | null | undefined, context: string): void {
  if (!error) return;
  console.error(`[data] ${context}`, error.code ?? "query_failed");
  throw new Error("데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
}
