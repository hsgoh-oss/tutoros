import webpush from "web-push";
import { createServiceClient } from "@/lib/supabase/server";
import { normalizePortalPhone } from "@/lib/portal/auth";
import { isPushConfigured, pushPublicKey, pushSubject } from "./config";

// 웹 푸시 발송 — 운영자(admin)·포털 사용자(portal) 기기로 즉시 띄우는 알림.
//
// 규율:
//  · fail-open. 푸시는 보조 채널이다. 실패해도 호출한 업무(상담 접수·제출·알림톡 발송)를 되돌리지
//    않고, 다른 채널로 대신 보내지도 않는다(이용약관 제12조 "Push 실패를 문자로 자동 전환하지 않는다").
//  · 죽은 구독(404·410)은 disabled_at을 찍는다. 다음 발송부터 대상에서 빠진다.
//  · 본문에 로그인 링크·토큰을 넣지 않는다. 푸시는 잠금화면에 그대로 뜬다 — url은 화면 경로만.
//  · 결과는 push_deliveries에 종류·제목·결과만 남긴다(본문은 남기지 않는다).

export interface PushPayload {
  title: string;
  body: string;
  /** 눌렀을 때 열 경로(사이트 내부 경로). 기본 "/". */
  url?: string;
  /** 같은 tag는 기기에서 겹쳐 쓴다(같은 사건의 갱신). */
  tag?: string;
}

interface SubscriptionRow {
  id: string;
  audience: "admin" | "portal";
  endpoint: string;
  p256dh: string;
  auth: string;
}

type Db = NonNullable<ReturnType<typeof createServiceClient>>;

let vapidReady = false;
function ensureVapid(): boolean {
  if (!isPushConfigured()) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(
      pushSubject(),
      pushPublicKey() as string,
      process.env.WEB_PUSH_PRIVATE_KEY as string,
    );
    vapidReady = true;
  }
  return true;
}

/** 실제 전달 — 구독 하나씩 보내고 결과를 기록한다. 던지지 않는다. */
async function deliver(
  db: Db,
  tenantId: string,
  kind: string,
  payload: PushPayload,
  rows: SubscriptionRow[],
): Promise<{ sent: number; failed: number; gone: number }> {
  const summary = { sent: 0, failed: 0, gone: 0 };
  if (rows.length === 0 || !ensureVapid()) return summary;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/",
    tag: payload.tag ?? kind,
  });

  for (const row of rows) {
    let status: "sent" | "failed" | "gone" = "sent";
    let error: string | null = null;
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        body,
        { TTL: 60 * 60 * 24, urgency: "normal" },
      );
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      // 404·410 = 구독 만료·해지. 이 기기는 더 이상 받을 수 없다 — 비활성으로 표시한다.
      status = code === 404 || code === 410 ? "gone" : "failed";
      error = `${code ?? "ERR"} ${(err as Error).message ?? ""}`.trim().slice(0, 300);
      console.error("[push] 발송 실패", row.id, error);
      if (status === "gone") {
        // tenant-scope-ok: 방금 이 테넌트로 조회한 구독 행의 uuid를 지목한다.
        await db
          .from("push_subscriptions")
          .update({ disabled_at: new Date().toISOString(), disabled_reason: error })
          .eq("id", row.id);
      }
    }
    summary[status] += 1;
    const { error: logError } = await db.from("push_deliveries").insert({
      tenant_id: tenantId,
      subscription_id: row.id,
      audience: row.audience,
      kind,
      title: payload.title,
      status,
      error,
    });
    if (logError) console.error("[push] 전달 기록 실패", logError);
  }
  return summary;
}

/** 운영자 기기 전부(테넌트의 활성 운영자 구독)로 보낸다 — 새 접수·제출·질문 알림. */
export async function pushToAdmins(
  tenantId: string,
  kind: string,
  payload: PushPayload,
): Promise<void> {
  try {
    const db = createServiceClient();
    if (!db || !isPushConfigured()) return;
    const { data, error } = await db
      .from("push_subscriptions")
      .select("id, audience, endpoint, p256dh, auth")
      .eq("tenant_id", tenantId)
      .eq("audience", "admin")
      .is("disabled_at", null);
    if (error) {
      console.error("[push] 운영자 구독 조회 실패", error);
      return;
    }
    await deliver(db, tenantId, kind, { url: "/admin/dashboard", ...payload }, (data ?? []) as SubscriptionRow[]);
  } catch (err) {
    console.error("[push] pushToAdmins 오류", err);
  }
}

/** 포털 연락처 한 사람의 기기 전부로 보낸다. */
export async function pushToContact(
  tenantId: string,
  contactId: string,
  kind: string,
  payload: PushPayload,
): Promise<void> {
  try {
    const db = createServiceClient();
    if (!db || !isPushConfigured()) return;
    const { data, error } = await db
      .from("push_subscriptions")
      .select("id, audience, endpoint, p256dh, auth")
      .eq("tenant_id", tenantId)
      .eq("audience", "portal")
      .eq("contact_id", contactId)
      .is("disabled_at", null);
    if (error) {
      console.error("[push] 포털 구독 조회 실패", error);
      return;
    }
    await deliver(db, tenantId, kind, { url: "/p", ...payload }, (data ?? []) as SubscriptionRow[]);
  } catch (err) {
    console.error("[push] pushToContact 오류", err);
  }
}

/**
 * 알림톡·SMS 수신 번호로 포털 연락처를 찾아 그 사람의 기기로 보낸다(lib/notify/send.ts가 호출).
 * 번호가 곧 수신자다 — 같은 사람이 포털에 있으면 기기에도 띄우고, 없으면 조용히 끝난다.
 * 회수된 관계만 남은 연락처에는 보내지 않는다(P-06 — 접근이 끊긴 사람은 알림도 끊긴다).
 */
export async function pushToPhone(
  tenantId: string,
  phone: string,
  kind: string,
  payload: PushPayload,
): Promise<void> {
  try {
    const db = createServiceClient();
    if (!db || !isPushConfigured()) return;
    const normalized = normalizePortalPhone(phone);
    if (!normalized) return;
    const { data: contacts, error } = await db
      .from("portal_contacts")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("phone", normalized);
    if (error || !contacts || contacts.length === 0) return;
    for (const c of contacts as { id: string }[]) {
      const { data: active } = await db
        .from("portal_relations")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("contact_id", c.id)
        .eq("status", "active")
        .limit(1);
      if (!active || active.length === 0) continue;
      await pushToContact(tenantId, c.id, kind, payload);
    }
  } catch (err) {
    console.error("[push] pushToPhone 오류", err);
  }
}
