import { createServiceClient } from "@/lib/supabase/server";

// 외부 AI 처리 동의 확인 (정본 D-09).
//
// 왜 이 파일이 생겼나: AI 파이프라인에는 가명화(pseudonym.ts)와 출력 검증(validate.ts)이
// 있었지만 **동의를 확인하는 코드가 한 줄도 없었다.** `lib/ai/` 전체에 consent 문자열이 0건이라,
// 운영자가 직접 등록한 학생(동의 기록이 없는 경로)에 대해서도 생성이 그대로 외부로 나갔다.
// 정본은 이를 충돌로 판정한다 — "유효한 동의가 있을 때만 한 요청에 한 제공자로 최소정보를 전달".
//
// 판정 지점은 하나여야 한다. 그래서 이 확인은 호출부 다섯 곳이 아니라 generateReport
// 안쪽(lib/ai/generate.ts)에서 이뤄지고, 대상(subject)을 인자로 **반드시** 받게 해서
// 새 호출부가 게이트를 빠뜨릴 수 없게 했다(타입이 강제한다).
//
// 가명화가 있으니 괜찮지 않냐는 반론에 대해: 가명화는 전달 범위를 줄이는 조치지 동의의 대체가
// 아니다. 성적·수업 내용 자체가 개인정보이고, 그것을 국외 제공자에게 보내는 행위에 동의가 필요하다.

/** 동의를 확인할 대상 — consents.subject_type과 같은 축이다. */
export interface AiConsentSubject {
  type: "consultation" | "student";
  id: string;
}

export const AI_CONSENT_MISSING_ERROR =
  "이 대상에 외부 AI 처리 동의가 없습니다. AI 생성 대신 직접 작성해 주세요. (상담·신청 폼에서 'AI 처리 위탁'에 동의하면 생성할 수 있습니다.)";

/**
 * 이 대상에 유효한 `overseas_ai` 동의가 있는지.
 *
 * 조회 실패는 **없음으로 본다**(fail-closed). 모르는 상태에서 외부로 개인정보를 내보내는 쪽으로
 * 기울지 않는다 — 못 보내면 사람이 직접 쓰면 되지만, 잘못 보낸 것은 되돌릴 수 없다.
 */
export async function hasOverseasAiConsent(
  tenantId: string,
  subject: AiConsentSubject,
): Promise<boolean> {
  const db = createServiceClient();
  if (!db) return false;
  const { data, error } = await db
    .from("consents")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("subject_type", subject.type)
    .eq("subject_id", subject.id)
    .eq("item", "overseas_ai")
    .limit(1);
  if (error) {
    console.error("[ai] 외부 AI 동의 확인 실패 — 생성을 막습니다", error);
    return false;
  }
  return Boolean(data && data.length > 0);
}
