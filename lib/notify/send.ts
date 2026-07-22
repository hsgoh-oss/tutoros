import { createHmac, randomBytes } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import {
  defaultChannel,
  isConfigured,
  type DispatchRequest,
  type NotifyRequest,
} from "./solapi";
import { getNotifyTemplateId } from "./templates";

// 알림 발송 진입점 — 모든 모듈이 이 함수만 호출한다. 전 이력 로그 / 알림톡→SMS 폴백 / 야간(21~08) 광고성 대기.
// Solapi 미설정 시 queued로 적재만, 실발송은 W7.

export interface SendResult {
  ok: boolean;
  channel: "alimtalk" | "sms";
  /** 야간 대기 등으로 즉시 발송하지 않고 큐에 적재된 경우 */
  queued: boolean;
  error?: string;
}

const NIGHT_START_HOUR = 21; // 야간 발송 금지 21:00~08:00 (Asia/Seoul)
const NIGHT_END_HOUR = 8;

export function isNightWindow(now: Date = new Date()): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

/** 광고성 발송 전 마케팅 수신동의 확인(정보통신망법 opt-in). 대상 미지정·동의 없음이면 false. */
async function hasMarketingConsent(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  req: NotifyRequest,
): Promise<boolean> {
  if (!req.consentSubject) return false;
  const { data } = await db
    .from("consents")
    .select("id")
    .eq("tenant_id", req.tenantId)
    .eq("subject_type", req.consentSubject.type)
    .eq("subject_id", req.consentSubject.id)
    .eq("item", "marketing")
    .limit(1);
  return Boolean(data && data.length > 0);
}

export async function sendNotification(
  req: NotifyRequest,
): Promise<SendResult> {
  const channel = defaultChannel();
  const db = createServiceClient();
  if (!db) {
    return { ok: false, channel, queued: false, error: "DB 미연결" };
  }

  // 광고성은 마케팅 수신동의가 있는 대상에게만 발송한다(수신거부=동의 철회 시 자동 차단).
  if (req.isAd && !(await hasMarketingConsent(db, req))) {
    console.warn("[notify] 광고성 발송 차단 — 마케팅 수신동의 없음", req.type);
    return {
      ok: false,
      channel,
      queued: false,
      error: "마케팅 수신동의가 없어 발송하지 않았습니다.",
    };
  }

  // 광고성은 야간(21~08) 발송 금지 — 다음 발송 슬롯까지 큐 대기.
  const mustQueue = req.isAd && isNightWindow();
  const canSendNow = isConfigured() && !mustQueue;

  const { data: row, error: insertError } = await db
    .from("notifications")
    .insert({
      tenant_id: req.tenantId,
      student_id: req.studentId,
      type: req.type,
      channel,
      phone: req.phone,
      message: req.message,
      is_ad: req.isAd,
      status: "queued",
    })
    .select("id")
    .single();
  if (insertError || !row) {
    console.error("[notify] log insert failed", insertError);
    return { ok: false, channel, queued: false, error: "알림 로그 적재 실패" };
  }

  if (!canSendNow) {
    // 미설정·야간 대기 — queued로 남겨 두면 크론이 재시도한다.
    return { ok: true, channel, queued: true };
  }

  return dispatchQueued(row.id, req, channel);
}

const SOLAPI_ENDPOINT = "https://api.solapi.com/messages/v4/send";

function solapiAuthHeader(): string {
  const apiKey = process.env.SOLAPI_API_KEY ?? "";
  const apiSecret = process.env.SOLAPI_API_SECRET ?? "";
  const date = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", apiSecret)
    .update(date + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

interface SolapiSendResult {
  ok: boolean;
  error?: string;
}

async function sendAlimtalk(req: DispatchRequest): Promise<SolapiSendResult> {
  const pfId = process.env.SOLAPI_KAKAO_CHANNEL_ID;
  const sender = process.env.SOLAPI_SENDER_PHONE;
  const templateId = getNotifyTemplateId(req.type);
  if (!pfId || !sender || !templateId) {
    return { ok: false, error: "알림톡 템플릿 미설정" };
  }
  try {
    const res = await fetch(SOLAPI_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: solapiAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          to: req.phone,
          from: sender,
          text: req.message,
          kakaoOptions: {
            pfId,
            templateId,
            variables: { "#{message}": req.message },
            disableSms: false,
          },
        },
      }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      console.error("[notify] alimtalk failed", res.status, errBody);
      return { ok: false, error: "알림톡 발송 실패" };
    }
    return { ok: true };
  } catch (err) {
    console.error("[notify] alimtalk error", err);
    return { ok: false, error: "알림톡 호출 오류" };
  }
}

async function sendSms(req: DispatchRequest): Promise<SolapiSendResult> {
  const sender = process.env.SOLAPI_SENDER_PHONE;
  if (!sender) return { ok: false, error: "SMS 발신번호 미설정" };
  try {
    const res = await fetch(SOLAPI_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: solapiAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: { to: req.phone, from: sender, text: req.message },
      }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      console.error("[notify] sms failed", res.status, errBody);
      return { ok: false, error: "SMS 발송 실패" };
    }
    return { ok: true };
  } catch (err) {
    console.error("[notify] sms error", err);
    return { ok: false, error: "SMS 호출 오류" };
  }
}

/** 실발송 — Solapi 호출(알림톡 우선→SMS 폴백) 후 상태 갱신. flush 크론이 queued 행 재시도에도 재사용한다. */
export async function dispatchQueued(
  notificationId: string,
  req: DispatchRequest,
  channel: "alimtalk" | "sms",
): Promise<SendResult> {
  let finalChannel: "alimtalk" | "sms" = channel;
  let result =
    channel === "alimtalk" ? await sendAlimtalk(req) : await sendSms(req);
  if (channel === "alimtalk" && !result.ok) {
    finalChannel = "sms";
    result = await sendSms(req);
  }

  const db = createServiceClient();
  if (!db) {
    return { ok: result.ok, channel: finalChannel, queued: false, error: result.error };
  }

  if (result.ok) {
    // tenant-scope-ok: notificationId는 sendNotification/flush가 생성·조회한 행의 uuid이며
    // 사용자 입력이 아니다. 갱신 대상은 항상 그 한 행뿐이다.
    await db
      .from("notifications")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        channel: finalChannel,
        error: null,
      })
      .eq("id", notificationId);
    return { ok: true, channel: finalChannel, queued: false };
  }

  // tenant-scope-ok: 위와 동일 — 내부 생성 uuid로 단일 행을 지목한다.
  const { data: row } = await db
    .from("notifications")
    .select("retry_count")
    .eq("id", notificationId)
    .maybeSingle();
  // tenant-scope-ok: 위와 동일 — 내부 생성 uuid로 단일 행을 지목한다.
  await db
    .from("notifications")
    .update({
      status: "failed",
      retry_count: ((row as { retry_count: number } | null)?.retry_count ?? 0) + 1,
      channel: finalChannel,
      error: result.error ?? "발송 실패",
    })
    .eq("id", notificationId);
  return { ok: false, channel: finalChannel, queued: false, error: result.error };
}
