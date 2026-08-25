import { createHmac, randomBytes } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { createWorkItem } from "@/lib/data/work";
import {
  defaultChannel,
  isConfigured,
  type DispatchRequest,
  type NotifyRequest,
} from "./solapi";
import { getNotifyTemplateId } from "./templates";

// 알림 발송 진입점 — 모든 모듈이 이 함수만 호출한다. 전 이력 로그 / 알림톡→SMS 폴백 / 야간(21~08) 광고성 대기.
// Solapi 미설정 시 queued로 적재만. 발송 직전 queued→sending 클레임으로 이중 발송을 막는다(N-02).

export interface SendResult {
  ok: boolean;
  channel: "alimtalk" | "sms";
  /** 야간 대기 등으로 즉시 발송하지 않고 큐에 적재된 경우 */
  queued: boolean;
  /** 다른 워커가 먼저 클레임해 이번 호출이 발송하지 않은 경우 — 성공도 실패도 아니다. */
  skipped?: boolean;
  error?: string;
}

/** 재시도 상한 — notifyRetry.ts(Deno)와 동일 값. 실패 시 +1은 dispatchQueued에서만 하므로 실제 시도 3회. */
const MAX_RETRY = 3;

/**
 * 발송 요청 — NotifyRequest(solapi.ts 소유)에 리포트 역참조를 더한 형태.
 * reportId가 있으면 notifications.report_id로 기록되고, 전달 결과가 ai_reports.delivery_status로 역전파된다.
 */
export type SendNotifyRequest = NotifyRequest & { reportId?: string };
/** 큐 재발송 요청 — DispatchRequest + 리포트 역참조. */
export type SendDispatchRequest = DispatchRequest & { reportId?: string };

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
  req: SendNotifyRequest,
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
      report_id: req.reportId ?? null,
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

/**
 * Solapi 오류 본문에서 운영자가 읽을 사유를 뽑는다.
 *
 * 이게 없으면 저장되는 건 "SMS 발송 실패"뿐이고, 오늘 업무 카드에도 그 문구만 뜬다 —
 * 운영자는 무엇을 해야 하는지 알 수 없고, 실제 원인(예: '발신번호 미등록')은 런타임 로그를
 * 뒤져야 나온다. 정본 공통 규칙 "열린 상태에는 반드시 다음 담당자와 다음 행동이 있다"에
 * 어긋나므로, 외부가 알려준 사유를 그대로 들고 온다.
 *
 * 사유는 발송 실패 원인일 뿐 개인정보가 아니다(수신번호·본문은 담지 않는다).
 */
function solapiReason(status: number, body: unknown): string {
  const b = body as { errorCode?: unknown; errorMessage?: unknown } | null;
  const code = typeof b?.errorCode === "string" ? b.errorCode : null;
  const message = typeof b?.errorMessage === "string" ? b.errorMessage : null;
  if (message && code) return `${message} (${code})`;
  if (message) return message;
  if (code) return code;
  return `HTTP ${status}`;
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
      return { ok: false, error: `알림톡 발송 실패 — ${solapiReason(res.status, errBody)}` };
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
      return { ok: false, error: `SMS 발송 실패 — ${solapiReason(res.status, errBody)}` };
    }
    return { ok: true };
  } catch (err) {
    console.error("[notify] sms error", err);
    return { ok: false, error: "SMS 호출 오류" };
  }
}

/**
 * 알림 전달 결과를 ai_reports.delivery_status로 역전파한다(N-02).
 * sent면 업무 상태(status)도 sent + sent_at으로 확정 — 큐 재발송의 지연 성공도 업무에 반영된다.
 * failed는 이미 전달 완료(sent)인 리포트를 덮지 않는다(승인된 사실은 덮어쓰지 않는다 — 재발송 성공 후 옛 실패 도착 대비).
 */
async function propagateReportDelivery(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  reportId: string,
  outcome: "sent" | "failed",
): Promise<void> {
  let query = db
    .from("ai_reports")
    .update(
      outcome === "sent"
        ? { delivery_status: "sent", status: "sent", sent_at: new Date().toISOString() }
        : { delivery_status: "failed" },
    )
    .eq("tenant_id", tenantId)
    .eq("id", reportId)
    // 철회본은 어떤 전달 결과로도 되살리지 않는다(G-03 재활성 금지) — 지연 성공이 와도
    // 게시 상태를 sent로 되돌리지 않고 무시한다(회수 경합의 마지막 방어선).
    .neq("status", "retracted");
  if (outcome === "failed") query = query.neq("delivery_status", "sent");
  const { error } = await query;
  if (error) console.error("[notify] 리포트 delivery_status 역전파 실패", error);
}

/**
 * 전달 완료된 포털 초대 본문에서 링크 토큰을 지운다.
 * 남은 문구로 "무엇을 보냈는지"는 알 수 있지만 그 링크로 로그인할 수는 없다.
 */
function redactPortalLink(message: string): string {
  return message.replace(/(\/p\/link\/)[A-Za-z0-9_-]+/g, "$1[삭제됨]");
}

/** notify_exhausted 우선순위 — 광고성은 normal, 결제 계열은 money(금전 흐름 중단), 그 외 normal. */
function exhaustedPriority(req: SendDispatchRequest): "money" | "normal" {
  if (req.isAd) return "normal";
  return req.type.startsWith("payment_") ? "money" : "normal";
}

/** 실발송 — queued→sending 클레임 후 Solapi 호출(알림톡 우선→SMS 폴백), 결과 갱신. flush 크론이 queued 행 재시도에도 재사용한다. */
export async function dispatchQueued(
  notificationId: string,
  req: SendDispatchRequest,
  channel: "alimtalk" | "sms",
): Promise<SendResult> {
  const db = createServiceClient();
  if (!db) {
    // 클레임 없이 발송하면 이중 발송을 막을 수 없다 — DB 미연결이면 발송 자체를 하지 않는다.
    return { ok: false, channel, queued: false, error: "DB 미연결" };
  }

  // 발송 직전 queued→sending 조건부 클레임 — 같은 행을 두 워커가 집어도 한쪽만 발송한다.
  // tenant-scope-ok: notificationId는 sendNotification/flush가 생성·조회한 행의 uuid이며
  // 사용자 입력이 아니다. 갱신 대상은 항상 그 한 행뿐이다.
  const { data: claimed, error: claimError } = await db
    .from("notifications")
    .update({ status: "sending", claimed_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("status", "queued")
    .select("id");
  if (claimError) {
    console.error("[notify] 발송 클레임 실패", claimError);
    return { ok: false, channel, queued: false, error: "발송 클레임 실패" };
  }
  if (!claimed || claimed.length === 0) {
    // 0행 = 다른 워커가 이미 집었거나 queued가 아닌 행 — 이중 발송 방지를 위해 건너뛴다.
    return { ok: false, channel, queued: false, skipped: true, error: "이미 처리 중인 알림" };
  }

  let finalChannel: "alimtalk" | "sms" = channel;
  let result =
    channel === "alimtalk" ? await sendAlimtalk(req) : await sendSms(req);
  if (channel === "alimtalk" && !result.ok) {
    finalChannel = "sms";
    result = await sendSms(req);
  }

  if (result.ok) {
    // tenant-scope-ok: 위와 동일 — 내부 생성 uuid로 단일 행을 지목한다.
    const { error: sentError } = await db
      .from("notifications")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        channel: finalChannel,
        error: null,
        // 전달이 끝나면 본문에 남은 로그인 자격(포털 초대 링크)을 지운다 — 재시도에 원문이
        // 필요한 구간은 queued~sending뿐이고, 그 뒤로도 남겨 두면 알림 이력 열람 권한이
        // 곧 포털 로그인 권한이 된다(초대 링크는 만료 없이 회수·재발급으로만 무효).
        ...(req.type === "portal_invite"
          ? { message: redactPortalLink(req.message) }
          : {}),
      })
      .eq("id", notificationId)
      .eq("status", "sending");
    if (sentError) {
      // 발송은 됐는데 기록 갱신이 실패 — 행은 sending에 남는다. 여기서 재발송하면 이중 발송이므로
      // 결과 불명(sending 체류)으로 둔다. 결과 불명은 성공이 아니다 — notify_retry 크론이
      // 장기 체류 행을 work_items(notify_unknown_result)로 수렴시켜 사람이 확인한다.
      console.error("[notify] sent 상태 갱신 실패 — sending 체류(결과 불명)로 남김", sentError);
    } else if (req.reportId) {
      await propagateReportDelivery(db, req.tenantId, req.reportId, "sent");
    }
    return { ok: true, channel: finalChannel, queued: false };
  }

  // 실패 — retry_count +1은 이 지점에서만 한다(notifyRetry 크론은 재큐잉만, 이중 증가 금지).
  // tenant-scope-ok: 위와 동일 — 내부 생성 uuid로 단일 행을 지목한다.
  const { data: row, error: readError } = await db
    .from("notifications")
    .select("retry_count")
    .eq("id", notificationId)
    .maybeSingle();
  if (readError || !row) {
    // retry_count를 못 읽으면 실패 확정을 보류한다 — 0으로 되감아 덮어쓰면 상한(3) 판정이
    // 밀려 재시도가 초과된다. 행은 sending에 남고 결과 불명 경로(notify_retry)가 수렴시킨다.
    console.error("[notify] retry_count 재조회 실패 — sending 체류(결과 불명)로 남김", readError);
    return { ok: false, channel: finalChannel, queued: false, error: result.error };
  }
  const nextRetry = (row as { retry_count: number }).retry_count + 1;
  // tenant-scope-ok: 위와 동일 — 내부 생성 uuid로 단일 행을 지목한다.
  await db
    .from("notifications")
    .update({
      status: "failed",
      retry_count: nextRetry,
      channel: finalChannel,
      error: result.error ?? "발송 실패",
    })
    .eq("id", notificationId)
    .eq("status", "sending");
  if (req.reportId) {
    await propagateReportDelivery(db, req.tenantId, req.reportId, "failed");
  }
  if (nextRetry >= MAX_RETRY) {
    // 재시도 소진 — 자동 경로는 여기서 끝. 사람 손이 필요한 업무로 넘긴다(열린 상태에는 다음 행동이 있다).
    await createWorkItem(req.tenantId, {
      kind: "notify_exhausted",
      title: `알림 재시도 소진 — ${req.type}`,
      sourceType: "notification",
      sourceId: notificationId,
      nextAction: "실패 사유 확인 후 수동 재발송 또는 종결",
      detail: result.error ?? null,
      priority: exhaustedPriority(req),
    });
  }
  return { ok: false, channel: finalChannel, queued: false, error: result.error };
}
