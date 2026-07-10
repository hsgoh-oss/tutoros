// 알림 발송 골격 — 기획서 6-5 (Solapi: 알림톡 우선 → SMS 자동 폴백, 전 이력 로그).
// 실 발송 연동(템플릿·야간 대기·광고성 분리·전환 스위치)은 W7(알림 모듈)에서 구현한다.
// 여기서는 발송 요청 계약과 채널 결정 로직만 확정한다.

import type { NotifyType } from "./templates";

export type NotifyChannel = "alimtalk" | "sms";

export interface NotifyRequest {
  tenantId: string;
  studentId: string | null;
  /** 알림 종류. string이 아니라 NotifyType이어야 미등록 키(예: 템플릿 없는 exam_report)가 컴파일에 걸린다. */
  type: NotifyType;
  phone: string;
  message: string;
  isAd: boolean; // 광고성 — 별도 수신동의·(광고) 표기·야간(21~08) 발송 금지
}

/**
 * 큐(notifications)에서 다시 읽어 발송할 때 쓰는 요청.
 * DB의 type 컬럼에는 CHECK 제약이 없고 SQL·엣지 함수도 행을 적재하므로, 값은 임의 문자열일 수 있다.
 * 미등록 타입이면 알림톡 템플릿 조회가 null을 반환해 SMS로 폴백한다 — message는 이미 완성돼 있어 발송 자체는 안전하다.
 */
export type DispatchRequest = Omit<NotifyRequest, "type"> & { type: string };

export function isConfigured(): boolean {
  return Boolean(
    process.env.SOLAPI_API_KEY && process.env.SOLAPI_API_SECRET,
  );
}

/** 비즈채널(알림톡) 연결 여부에 따라 기본 채널 결정 — 미연결 시 SMS 모드(기획: SMS 선인수 가능) */
export function defaultChannel(): NotifyChannel {
  return process.env.SOLAPI_KAKAO_CHANNEL_ID ? "alimtalk" : "sms";
}
