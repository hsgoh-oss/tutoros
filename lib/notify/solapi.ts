// 알림 발송 계약(요청 타입·채널 결정) — 기획서 6-5(알림톡 우선→SMS 폴백, 전 이력 로그).
// 실 발송 연동(템플릿·야간 대기·광고성 분리)은 W7.

import type { NotifyType } from "./templates";

export type NotifyChannel = "alimtalk" | "sms";

export interface NotifyRequest {
  tenantId: string;
  studentId: string | null;
  /** NotifyType으로 고정 — 템플릿 없는 미등록 키(예: exam_report)를 컴파일 단계에서 걸러낸다. */
  type: NotifyType;
  phone: string;
  message: string;
  isAd: boolean; // 광고성 — 별도 수신동의·(광고) 표기·야간(21~08) 발송 금지
  /**
   * 광고성(isAd=true) 발송 시 마케팅 수신동의를 확인할 대상(consents 조회 키).
   * 미지정이거나 해당 동의가 없으면 send.ts가 발송을 차단한다(정보통신망법 opt-in).
   */
  consentSubject?: { type: "consultation" | "student" | "guardian"; id: string };
}

/**
 * 큐(notifications)에서 다시 읽어 발송할 때의 요청. type 컬럼엔 CHECK가 없어(SQL·엣지도 적재) 임의 문자열일 수 있다.
 * 미등록 타입이면 알림톡 템플릿이 null→SMS 폴백 — message는 이미 완성돼 있어 발송은 안전하다.
 */
export type DispatchRequest = Omit<NotifyRequest, "type"> & { type: string };

// 발신번호까지 있어야 "설정됨"이다. 키 2개만 채우면 isConfigured()가 true로 뒤집혀 즉시 발송을
// 시도하는데, sendSms/sendAlimtalk은 SOLAPI_SENDER_PHONE 없이는 무조건 실패한다. 그러면 안전하게
// queued로 쌓여 있던 알림이 failed로 바뀌고 notify_retry가 상한(3)까지 태운 뒤 영구 폐기된다
// — 키를 넣기 전보다 나빠진다. 발신번호는 Solapi 콘솔에서 사전등록(통신사 인증)이 필요하다.
export function isConfigured(): boolean {
  return Boolean(
    process.env.SOLAPI_API_KEY &&
      process.env.SOLAPI_API_SECRET &&
      process.env.SOLAPI_SENDER_PHONE,
  );
}

/** 비즈채널(알림톡) 연결 여부에 따라 기본 채널 결정 — 미연결 시 SMS 모드(기획: SMS 선인수 가능) */
export function defaultChannel(): NotifyChannel {
  return process.env.SOLAPI_KAKAO_CHANNEL_ID ? "alimtalk" : "sms";
}
