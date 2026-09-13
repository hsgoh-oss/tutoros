"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { resolveTenant } from "@/lib/tenant";
import { sendNotification } from "@/lib/notify/send";
import { renderTemplate } from "@/lib/notify/templates";
import {
  normalizePortalPhone,
  portalLinkPath,
  portalOrigin,
  rotateAccessLink,
} from "@/lib/portal/auth";

// 공개 포털 진입 — "링크를 잃어버린 사람"의 유일한 복구 경로 (P-02 로그인·복구).
//
// 포털은 비밀번호가 없다. 로그인 수단은 문자로 받은 링크 하나뿐이라, 링크를 잃으면
// 지금까지는 선생님에게 연락하는 것 말고 방법이 없었다. 그 연락이 곧 운영자의 일이 된다.
// 이 액션은 같은 신뢰 모델(= 그 번호의 휴대폰을 가진 사람이 본인)을 그대로 쓰면서,
// 새 인증 수단을 만들지 않고 링크만 다시 보낸다.
//
// 지켜야 하는 세 가지:
//
//  ① **존재를 알려 주지 않는다**(P-02 「계정 존재를 노출하지 않는 확인」).
//     등록된 번호든 아니든, 관계가 살아 있든 회수됐든, 쿨다운에 걸렸든 — 응답은 한 문장으로
//     같다. 응답이 갈리면 이 폼이 "이 번호가 이 학원 학부모인가"를 조회하는 도구가 된다.
//
//  ② **새 링크를 주면 이전 링크는 죽는다**(검수 20 — 살아 있는 링크는 늘 하나).
//     rotateAccessLink가 그 규약을 강제한다. 그래서 남의 번호로 요청해 그 사람의 링크를
//     무효화하는 장난이 가능한데, 새 링크는 그 번호의 휴대폰으로만 가므로 본인은 바로 복구된다.
//     대신 반복 요청은 ③으로 막는다.
//
//  ③ **쿨다운과 하루 상한**. 살아 있는 링크가 방금 발급된 상태면 아무것도 하지 않고,
//     하루에 보낸 링크 문자가 상한을 넘으면 더 보내지 않는다. 둘이 막는 것은 같은 시나리오다:
//     남의 번호를 아는 사람이 요청을 반복해 ⓐ 그 사람 링크를 계속 무효화하고 ⓑ 문자를 퍼붓고
//     ⓒ 학원의 발송 비용을 태우는 것. 운영자가 방금 보낸 초대가 이 요청으로 무효화되는 사고도
//     여기서 걸린다.
//
// 감사 기록은 남기지 않는다: 이 경로는 익명 입력이라 "누가 했다"를 적을 주체가 없고,
// 실제 발급 사실은 portal_access_links(rotated_at·revoked_reason)와 notifications에 남는다.

/**
 * 성공·비대상·쿨다운이 전부 이 문장으로 수렴한다.
 * 세 갈래가 각각 다른 말을 하면 그 차이가 곧 조회 결과가 된다(위 ①).
 */
const GENERIC_OK =
  "등록된 번호라면 포털 링크를 문자로 보내드립니다. 최근에 받은 링크가 있다면 그 링크가 계속 유효하니 그대로 사용해 주세요. 도착하지 않으면 잠시 후 다시 시도하거나 담당 선생님께 문의해 주세요.";

const DB_ERROR = "일시적으로 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.";
const PHONE_ERROR = "휴대전화 번호를 다시 확인해 주세요.";

/** 살아 있는 링크가 이 시간 안에 발급됐으면 다시 발급하지 않는다. */
const RESEND_COOLDOWN_MS = 2 * 60 * 1000;

/**
 * 한 번호로 하루에 나가는 포털 링크 문자의 상한.
 * 운영자가 보낸 초대도 함께 센다 — 상한의 목적이 "이 번호가 오늘 받은 링크 문자 수"를
 * 묶는 것이라 발신 주체를 가릴 이유가 없다. 정상 사용에서 하루 5통은 넘을 일이 없다.
 */
const DAILY_LINK_SMS_LIMIT = 5;

export type PortalLinkRequestResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export async function requestPortalLink(
  rawPhone: string,
): Promise<PortalLinkRequestResult> {
  const phone = normalizePortalPhone(rawPhone ?? "");
  // 형식 오류만 다르게 답한다 — 이건 입력한 사람이 이미 아는 사실이라 아무것도 노출하지 않는다.
  if (!/^[0-9]{9,12}$/.test(phone)) return { ok: false, error: PHONE_ERROR };

  const db = createServiceClient();
  if (!db) return { ok: false, error: DB_ERROR };

  const tenant = await resolveTenant();

  const { data: contact, error: contactError } = await db
    .from("portal_contacts")
    .select("id,name")
    .eq("tenant_id", tenant.id)
    .eq("phone", phone)
    .maybeSingle();
  if (contactError) {
    console.error("[portal] contact lookup failed", contactError);
    return { ok: false, error: DB_ERROR };
  }
  if (!contact) return { ok: true, message: GENERIC_OK };

  // 회수(revoked)된 관계는 대상이 아니다 — 링크 재발송이 회수된 권한을 되살리는 경로가 되면
  // 안 된다(rotateAccessLink도 같은 이유로 revoked 관계를 거절한다).
  const { data: relationRows, error: relationError } = await db
    .from("portal_relations")
    .select("id,student_id,status,accepted_at,created_at")
    .eq("tenant_id", tenant.id)
    .eq("contact_id", contact.id)
    .in("status", ["invited", "active"]);
  if (relationError) {
    console.error("[portal] relation lookup failed", relationError);
    return { ok: false, error: DB_ERROR };
  }
  const relations = (relationRows ?? []) as {
    id: string;
    student_id: string;
    status: string;
    accepted_at: string | null;
    created_at: string;
  }[];
  if (relations.length === 0) return { ok: true, message: GENERIC_OK };

  // 링크 하나면 충분하다: 세션은 사람(contact) 단위로 발급되고, getPortalSession이 그 사람의
  // active 관계 전부를 다시 계산한다. 관계 수만큼 문자를 보내면 학생 둘을 둔 학부모가
  // 같은 안내를 두 통 받는다.
  //
  // 고르는 기준은 "이미 써 본 관계" — 수락(accepted_at)이 있는 것 중 가장 최근, 없으면 가장 먼저
  // 초대된 것. 한 번도 열지 않은 초대를 회전시키면 운영자가 방금 보낸 초대가 죽는다.
  const accepted = relations
    .filter((r) => r.accepted_at !== null)
    .sort((a, b) => (b.accepted_at ?? "").localeCompare(a.accepted_at ?? ""));
  const target =
    accepted[0] ??
    [...relations].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];

  const { data: liveLinks, error: linkError } = await db
    .from("portal_access_links")
    .select("created_at")
    .eq("tenant_id", tenant.id)
    .in(
      "relation_id",
      relations.map((r) => r.id),
    )
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (linkError) {
    console.error("[portal] access link lookup failed", linkError);
    return { ok: false, error: DB_ERROR };
  }
  const newest = liveLinks?.[0]?.created_at;
  if (newest && Date.now() - new Date(newest).getTime() < RESEND_COOLDOWN_MS) {
    // 방금 받은 링크가 아직 살아 있다 — 그걸 쓰면 된다. 회전시키지 않는다.
    return { ok: true, message: GENERIC_OK };
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: sentToday, error: countError } = await db
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .eq("phone", phone)
    .eq("type", "portal_invite")
    .gte("created_at", since);
  if (countError) {
    // 상한을 확인하지 못하면 보내지 않는다 — 모르는 상태에서 문자를 더 보내는 쪽으로 기울지 않는다.
    console.error("[portal] 링크 발송 상한 확인 실패", countError);
    return { ok: false, error: DB_ERROR };
  }
  if ((sentToday ?? 0) >= DAILY_LINK_SMS_LIMIT) {
    return { ok: true, message: GENERIC_OK };
  }

  const rotated = await rotateAccessLink(
    tenant.id,
    target.id,
    "본인 요청 — 공개 화면에서 포털 링크 재발송",
  );
  if (!rotated.ok) {
    console.error("[portal] 링크 재발송 실패", rotated.error);
    return { ok: false, error: DB_ERROR };
  }

  const link = `${await portalOrigin()}${portalLinkPath(rotated.token)}`;
  // 문구에 학생 실명·수업·금전 정보를 담지 않는다 — 링크 자체가 로그인 수단이라
  // 오수신 시 피해가 커진다(portal_invite 템플릿의 설계 이유와 같다).
  const message = `[${tenant.brandName}] ${renderTemplate("portal_invite", {
    name: contact.name,
  })}\n${link}`;

  const sent = await sendNotification({
    tenantId: tenant.id,
    studentId: target.student_id,
    type: "portal_invite",
    phone,
    message,
    isAd: false,
  });
  if (!sent.ok && !sent.skipped) {
    // 발송 실패도 화면에는 같은 문장이다(①). 실패 자체는 notifications 큐에 failed로 남아
    // 재시도 크론과 오늘 업무로 수렴한다 — 발급을 되돌리지는 않는다(업무/전달 분리, N-02).
    console.error("[portal] 포털 링크 문자 발송 실패", sent.error);
  }

  return { ok: true, message: GENERIC_OK };
}
