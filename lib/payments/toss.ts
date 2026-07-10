// 토스페이먼츠 어댑터 — 기획서 6-4 청구/결제(토스 링크) 연동. 서버 전용 — 키는 절대 클라이언트 노출 금지.
// TOSS_SECRET_KEY 환경변수(Basic auth: base64(secretKey + ":")).
//
// 문서 확인 결과(context7 MCP, /llmstxt/tosspayments_llms_txt):
// - GET /v1/payments/{paymentKey} (결제 단건 조회) — 확인됨. 웹훅 위변조 검증에 사용.
// - 일반 결제 웹훅(PAYMENT_STATUS_CHANGED 등)은 서명 헤더가 없어 재조회로만 검증 가능 — 문서로 확인됨.
// - "결제 링크(Link Pay) 발급" 전용 API — 릴리스 노트에 존재 언급만 있고 요청/응답 스키마는 공개돼 있지 않음.
//   별도 가맹 심사(청구서·링크 결제 상품)가 필요한 상품으로, 엔드포인트를 추측해 구현하지 않는다.
//   → createPaymentLink는 명시적 미지원 스텁으로 남기고, 가맹 승인·정식 문서 확보 후 완성한다.

const TOSS_API_BASE = "https://api.tosspayments.com";

export function isTossConfigured(): boolean {
  return Boolean(process.env.TOSS_SECRET_KEY);
}

function authHeader(): string {
  const key = process.env.TOSS_SECRET_KEY ?? "";
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

export interface CreatePaymentLinkInput {
  id: string;
  amount: number;
  orderName: string;
}

export interface CreatePaymentLinkResult {
  ok: boolean;
  url?: string;
  error?: string;
}

/**
 * 토스 결제 링크 발급 — 명시적 미지원 스텁.
 * 토스의 "링크 결제(Link Pay)" API는 문서(context7)에 존재 언급만 있고 요청/응답 스키마가
 * 공개되어 있지 않다. 별도 가맹 심사가 필요한 상품으로 알려져 있어 추측으로 엔드포인트를
 * 구현하지 않는다. 가맹 승인 및 정식 API 문서 확보 후 이 함수를 완성할 것.
 */
export async function createPaymentLink(
  payment: CreatePaymentLinkInput,
): Promise<CreatePaymentLinkResult> {
  void payment;
  return {
    ok: false,
    error: "토스 링크 결제 API는 가맹 승인 후 활성화됩니다. (문서 미확인 — 추측 구현 방지)",
  };
}

export type TossPaymentStatus =
  | "READY"
  | "IN_PROGRESS"
  | "WAITING_FOR_DEPOSIT"
  | "DONE"
  | "CANCELED"
  | "PARTIAL_CANCELED"
  | "ABORTED"
  | "EXPIRED";

export interface TossPayment {
  paymentKey: string;
  orderId: string;
  status: TossPaymentStatus;
  totalAmount: number;
  approvedAt: string | null;
}

interface TossPaymentApiResponse {
  paymentKey: string;
  orderId: string;
  status: TossPaymentStatus;
  totalAmount: number;
  approvedAt: string | null;
  message?: string;
}

export interface GetPaymentResult {
  ok: boolean;
  payment?: TossPayment;
  error?: string;
}

/**
 * 결제 단건 조회 — GET /v1/payments/{paymentKey}.
 * 일반 결제 웹훅은 서명이 없으므로, 웹훅 본문을 신뢰하지 않고 이 함수로 재조회해 위변조를 검증한다.
 */
export async function getPayment(paymentKey: string): Promise<GetPaymentResult> {
  if (!isTossConfigured()) {
    return { ok: false, error: "토스 시크릿 키가 설정되지 않았습니다." };
  }
  try {
    const res = await fetch(
      `${TOSS_API_BASE}/v1/payments/${encodeURIComponent(paymentKey)}`,
      {
        method: "GET",
        headers: { Authorization: authHeader() },
        cache: "no-store",
      },
    );
    const body = (await res.json()) as TossPaymentApiResponse;
    if (!res.ok) {
      console.error("[toss] getPayment failed", res.status, body);
      return { ok: false, error: body.message ?? "토스 결제 조회에 실패했습니다." };
    }
    return {
      ok: true,
      payment: {
        paymentKey: body.paymentKey,
        orderId: body.orderId,
        status: body.status,
        totalAmount: body.totalAmount,
        approvedAt: body.approvedAt ?? null,
      },
    };
  } catch (err) {
    console.error("[toss] getPayment error", err);
    return { ok: false, error: "토스 API 호출 중 오류가 발생했습니다." };
  }
}
