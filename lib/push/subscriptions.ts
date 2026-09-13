import { createServiceClient } from "@/lib/supabase/server";

// 푸시 구독 저장·해제·조회 — 운영자(admin)와 포털 사용자(portal) 양쪽 액션이 이 모듈만 쓴다.
// 구독의 정본은 브라우저(PushManager)이고 DB는 그 사본이다: 같은 endpoint가 다시 오면 키를 갱신하고
// disabled를 풀어 준다(기기에서 껐다 켜면 endpoint가 바뀌기도, 같기도 하다).

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type PushOwner =
  | { audience: "admin"; adminEmail: string }
  | { audience: "portal"; contactId: string };

export interface PushSubscriptionView {
  id: string;
  endpoint: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  disabledAt: string | null;
}

/** 브라우저가 보낸 구독 JSON을 최소 검증한다 — 형식이 아니면 저장하지 않는다. */
export function parseSubscriptionInput(raw: unknown): PushSubscriptionInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof r.endpoint !== "string" || !/^https:\/\/.{10,2000}$/.test(r.endpoint)) return null;
  const p256dh = r.keys?.p256dh;
  const auth = r.keys?.auth;
  if (typeof p256dh !== "string" || typeof auth !== "string") return null;
  if (p256dh.length < 20 || p256dh.length > 300 || auth.length < 10 || auth.length > 100) return null;
  return { endpoint: r.endpoint, keys: { p256dh, auth } };
}

export async function upsertPushSubscription(
  tenantId: string,
  owner: PushOwner,
  input: PushSubscriptionInput,
  userAgent: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const db = createServiceClient();
  if (!db) return { ok: false, error: "DB 미연결" };
  const now = new Date().toISOString();
  const row = {
    tenant_id: tenantId,
    audience: owner.audience,
    admin_email: owner.audience === "admin" ? owner.adminEmail : null,
    contact_id: owner.audience === "portal" ? owner.contactId : null,
    endpoint: input.endpoint,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    user_agent: userAgent ? userAgent.slice(0, 300) : null,
    last_seen_at: now,
    disabled_at: null,
    disabled_reason: null,
  };
  // tenant-scope-ok: row가 tenant_id를 담는다(바로 위 선언). endpoint 유니크로 같은 기기는 갱신된다.
  const { data, error } = await db
    .from("push_subscriptions")
    .upsert(row, { onConflict: "endpoint" })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[push] 구독 저장 실패", error);
    return { ok: false, error: "구독을 저장하지 못했습니다." };
  }
  return { ok: true, id: (data as { id: string }).id };
}

/** 구독 해제 — 소유자 본인 것만 지운다(endpoint를 안다고 남의 구독을 지울 수 없게). */
export async function removePushSubscription(
  tenantId: string,
  owner: PushOwner,
  endpoint: string,
): Promise<boolean> {
  const db = createServiceClient();
  if (!db) return false;
  let query = db
    .from("push_subscriptions")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("endpoint", endpoint)
    .eq("audience", owner.audience);
  query =
    owner.audience === "admin"
      ? query.eq("admin_email", owner.adminEmail)
      : query.eq("contact_id", owner.contactId);
  const { error } = await query;
  if (error) {
    console.error("[push] 구독 해제 실패", error);
    return false;
  }
  return true;
}

/** 소유자의 구독 목록(기기 관리 화면용). 죽은 구독도 보여 준다 — 왜 안 오는지 알 수 있게. */
export async function listPushSubscriptions(
  tenantId: string,
  owner: PushOwner,
): Promise<PushSubscriptionView[]> {
  const db = createServiceClient();
  if (!db) return [];
  let query = db
    .from("push_subscriptions")
    .select("id, endpoint, user_agent, created_at, last_seen_at, disabled_at")
    .eq("tenant_id", tenantId)
    .eq("audience", owner.audience)
    .order("created_at", { ascending: false });
  query =
    owner.audience === "admin"
      ? query.eq("admin_email", owner.adminEmail)
      : query.eq("contact_id", owner.contactId);
  const { data, error } = await query;
  if (error) {
    console.error("[push] 구독 조회 실패", error);
    return [];
  }
  return ((data ?? []) as {
    id: string;
    endpoint: string;
    user_agent: string | null;
    created_at: string;
    last_seen_at: string;
    disabled_at: string | null;
  }[]).map((r) => ({
    id: r.id,
    endpoint: r.endpoint,
    userAgent: r.user_agent,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    disabledAt: r.disabled_at,
  }));
}

/** 이 기기(endpoint)가 소유자 이름으로 살아 있는 구독인지 — 토글의 초기 상태 판정용. */
export async function isEndpointSubscribed(
  tenantId: string,
  owner: PushOwner,
  endpoint: string,
): Promise<boolean> {
  const db = createServiceClient();
  if (!db) return false;
  let query = db
    .from("push_subscriptions")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("endpoint", endpoint)
    .eq("audience", owner.audience)
    .is("disabled_at", null)
    .limit(1);
  query =
    owner.audience === "admin"
      ? query.eq("admin_email", owner.adminEmail)
      : query.eq("contact_id", owner.contactId);
  const { data } = await query;
  return Boolean(data && data.length > 0);
}

/** 기기 이름 — 저장된 UA를 사람이 읽을 한 줄로. 완벽할 필요는 없다, 구분만 되면 된다. */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return "알 수 없는 기기";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "Mac"
        : /Windows/.test(ua)
          ? "Windows"
          : "기타";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "삼성 브라우저"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : "브라우저";
  return `${os} · ${browser}`;
}
