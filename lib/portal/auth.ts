import { createHmac, randomBytes } from "crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveTenant } from "@/lib/tenant";

// 이용자(학생·보호자·납부자·계약자) 포털 인증 — 역할별 초대 링크 + 서버측 세션.
// 정본: docs/flow-canon/01_atlas_02_portal_lessons.md P-01(역할별 초대)·P-02(로그인·세션·복구)·P-06(관계 변경·권한 회수).
//
// 모델(간편 — 비밀번호·OTP 없음, 초대 링크만):
//   portal_contacts     사람 1명(tenant_id + 정규화 전화번호 유니크).
//   portal_relations    contact × student × role — 한 사람이 여러 역할을 가지면 역할별로 행이 하나씩
//                       생기고 권한도 각각 독립이다(검수 16). status: invited → active → revoked.
//   portal_access_links 관계당 지속 로그인 링크. 재발급하면 이전 링크는 즉시 무효(검수 20).
//                       만료 시각은 두지 않는다 — 무효화는 회수(revoked_at)로만 일어난다.
//   portal_sessions     admin_sessions와 같은 패턴의 서버측 세션(30일·revoked_at 즉시 회수).
//
// 토큰 취급은 lib/auth/session.ts(관리자)와 동일하다: 링크·쿠키에는 32바이트 랜덤 원문만 두고
// DB에는 HMAC-SHA256(AUTH_SECRET) 해시만 저장한다. DB가 유출돼도 링크·세션을 역산할 수 없고,
// revoked_at 갱신 한 번으로 즉시 회수된다.
//
// 관리자 세션과 다른 점 두 가지:
//  1. 개발 모드(DB 미연결) 폴백이 없다. 무상태 서명 토큰으로 폴백하면 회수할 서버측 행이 없어
//     "관계 종료 → 다음 요청부터 차단"(P-02·검수 21) 계약이 깨진다 — DB가 없으면 그냥 비로그인이다.
//  2. 세션 유효성이 관계에 매여 있다. 세션 행이 살아 있어도 active 관계가 하나도 남지 않으면
//     세션 자체를 무효로 본다(검수 21·109 — 관계 종료 후 상세정보·직접 이동 차단).
//
// 기존 /portal/[token](학생당 단일 비밀 토큰)은 그대로 병행 운영한다 — 이 모듈은 그 경로를 건드리지 않는다.

export const PORTAL_COOKIE = "tutoros_portal";
const PORTAL_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일
/** 쿠키 maxAge(초) — TTL은 이 파일에서만 정의한다(라우트 핸들러 등에서 재정의 금지). */
export const PORTAL_SESSION_MAX_AGE_S = PORTAL_SESSION_TTL_MS / 1000;

/**
 * 포털 세션 쿠키 옵션 — 호출부가 httpOnly·secure·sameSite를 빠뜨리지 않도록 여기서 한 벌로 고정한다
 * (관리자 로그인 app/admin/login/actions.ts와 동일 정책). 쿠키를 심는 쪽은 이 상수를 그대로 쓸 것.
 */
export const PORTAL_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: PORTAL_SESSION_MAX_AGE_S,
} as const;

/** 초대 링크 경로 규약 — 발송 호출부(알림 템플릿)와 수락 라우트가 같은 형태를 쓰도록 여기서 정한다. */
export function portalLinkPath(rawToken: string): string {
  // 수락 라우트는 app/p/link/[token]/route.ts — 기존 /portal/[token](단일 토큰 뷰어)과
  // 경로가 갈라져야 병행 운영이 가능하다(이행 정책: 구 링크 자동 은퇴 없음).
  return `/p/link/${rawToken}`;
}

/** 세션이 이 역할로 이 학생에 접근할 수 있는지. 관계는 역할별로 독립이다(검수 16). */
export function hasPortalAccess(
  session: PortalSession,
  role: PortalRole,
  studentId: string,
): boolean {
  return session.relations.some(
    (r) => r.role === role && r.studentId === studentId,
  );
}

const DEV_SECRET = "dev-only-secret-change-me";

// 링크·세션 토큰 해시 키. lib/auth/session.ts의 secret()은 모듈 비공개라 같은 규칙을 여기에 둔다
// (키 자체는 AUTH_SECRET 하나 — 값이 갈라지면 안 되므로 환경변수 이름을 공유한다).
// 유출·기본값이면 임의 관계의 포털 세션을 위조할 수 있어, 프로덕션에선 미설정 시 즉시 실패한다.
function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s === DEV_SECRET) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "AUTH_SECRET 미설정 — 프로덕션에서는 강력한 무작위 값이 필수입니다(포털 세션 위조 방지).",
      );
    }
    return DEV_SECRET;
  }
  return s;
}

// 링크 해시와 세션 해시는 접두사로 도메인을 분리한다 — 한쪽 해시를 다른 쪽에 재생할 수 없다
// (관리자 세션 해시 'session:'·OTP 해시와도 겹치지 않는다).
function hashLinkToken(token: string): string {
  return createHmac("sha256", secret())
    .update(`portal-link:${token}`)
    .digest("hex");
}

function hashSessionToken(token: string): string {
  return createHmac("sha256", secret())
    .update(`portal-session:${token}`)
    .digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/* ---------- 타입 ---------- */

/** 포털 역할 — 관계 행마다 하나. 계약자(contractor)는 자리 표시이고 계약 엔티티는 M2. */
export type PortalRole = "student" | "guardian" | "payer" | "contractor";

export const PORTAL_ROLE_LABEL: Record<PortalRole, string> = {
  student: "학생",
  guardian: "보호자",
  payer: "납부자",
  contractor: "계약자",
};

export function isPortalRole(value: string): value is PortalRole {
  return Object.hasOwn(PORTAL_ROLE_LABEL, value);
}

/** 세션이 실제로 열 수 있는 관계 한 건(active만). 권한 판정의 단위다. */
export interface PortalRelationView {
  relationId: string;
  role: PortalRole;
  studentId: string;
  studentName: string;
  acceptedAt: string | null;
}

export interface PortalSession {
  contactId: string;
  tenantId: string;
  contactName: string;
  /** 지금 이 사람에게 열려 있는 관계 전부 — 역할·학생별로 독립이다(검수 16). */
  relations: PortalRelationView[];
  expiresAt: string;
}

const DB_ERROR = "일시적으로 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.";
/** 링크 불일치·회수·관계 종료·학생 종료를 하나로 수렴시키는 문구 — 존재 여부를 드러내지 않는다(P-02). */
const LINK_ERROR = "사용할 수 없는 링크입니다. 담당 선생님께 새 초대를 요청해 주세요.";

/* ---------- 링크 수락 → 세션 발급 ---------- */

// accept_portal_link(00017)의 반환 컬럼. 함수는 "판정"을 앱에 넘기는 값(student_status)까지
// 함께 돌려준다 — 종료 학생·타 테넌트 판정은 아래 issuePortalSessionFromLink이 한다.
interface AcceptLinkRow {
  relation_id: string;
  tenant_id: string;
  contact_id: string;
  student_id: string;
  role: string;
  status: string;
  accepted_at: string | null;
  first_accept: boolean;
  contact_name: string;
  contact_phone: string;
  student_name: string;
  student_status: string;
}

export type IssuePortalSessionResult =
  | {
      ok: true;
      /** 쿠키(PORTAL_COOKIE)에 넣을 원 토큰 — 호출부가 PORTAL_COOKIE_OPTIONS 그대로 심는다. */
      token: string;
      contactId: string;
      tenantId: string;
      contactName: string;
      relationId: string;
      role: PortalRole;
      studentId: string;
      studentName: string;
      /** 이번 클릭이 첫 수락(invited → active 전환)이었는지 — 안내 문구 분기용. */
      firstAccept: boolean;
    }
  | { ok: false; error: string };

/**
 * 초대 링크 클릭 처리 — 첫 클릭이 곧 수락이고, 클릭할 때마다 새 세션을 발급한다(P-01·P-02).
 *
 * 수락(관계 활성화 + accepted_at 스탬프)은 accept_portal_link RPC 안에서 원자적으로 끝난다:
 * 링크·관계·학생을 한 트랜잭션에서 잠그고 확인하므로 "반쪽 수락"이 생기지 않는다(검수 125).
 * 이미 수락된 링크를 다시 열면 새 관계를 만들지 않고 기존 관계로 수렴한다(P-01 재사용 규칙·검수 124).
 * 없는 토큰·회수된 링크·회수된 관계는 RPC가 0행으로 같게 응답하고, 여기서도 한 문구로 수렴한다
 * (유효한 링크를 탐지하는 신호를 주지 않는다: P-02 "계정 존재를 노출하지 않는 확인").
 *
 * RPC가 앱에 넘긴 두 판정을 여기서 마무리한다(00017 함수 주석):
 *  · 종료(ended) 학생의 관계는 열지 않는다 — 등록 종료 시 포털 접근도 닫힌다(E-04·검수 109).
 *  · 반환된 tenant_id가 현재 Host의 테넌트와 다르면 거절한다 — RPC는 service_role로 돌아
 *    테넌트 경계를 스스로 판정하지 않으므로, 경계는 이 지점이 유일하다.
 *
 * 세션 insert가 실패하면 쿠키를 주지 않고 실패로 끝낸다 — 수락 스탬프는 멱등이라
 * 같은 링크를 다시 열면 no-op 수락 + 새 세션으로 복구된다(반쪽 상태가 남지 않는다: 검수 125).
 */
export async function issuePortalSessionFromLink(
  rawToken: string,
): Promise<IssuePortalSessionResult> {
  if (!rawToken) return { ok: false, error: LINK_ERROR };
  const db = createServiceClient();
  if (!db) return { ok: false, error: DB_ERROR };

  // 테넌트는 RPC 인자로 넘긴다 — 거절 판정이 수락 스탬프보다 먼저 일어나야 한다(검수 125).
  const tenant = await resolveTenant();
  const { data, error } = await db.rpc("accept_portal_link", {
    p_token_hash: hashLinkToken(rawToken),
    p_tenant_id: tenant.id,
  });
  if (error) {
    console.error("[portal] accept_portal_link failed", error);
    return { ok: false, error: DB_ERROR };
  }
  const row = (Array.isArray(data) ? data[0] : data) as AcceptLinkRow | null | undefined;
  if (!row) return { ok: false, error: LINK_ERROR };
  if (!isPortalRole(row.role)) {
    console.error("[portal] 알 수 없는 역할", row.role);
    return { ok: false, error: LINK_ERROR };
  }
  // 테넌트 불일치·종료 학생은 RPC가 스탬프 없이 0행으로 거절한다(위 !row 분기에서 수렴).
  // 여기서 다시 검사하지 않는 이유: 앱 층 검사는 이미 찍힌 스탬프를 되돌리지 못한다.

  const token = newToken();
  const { error: insertError } = await db.from("portal_sessions").insert({
    tenant_id: row.tenant_id,
    contact_id: row.contact_id,
    token_hash: hashSessionToken(token),
    expires_at: new Date(Date.now() + PORTAL_SESSION_TTL_MS).toISOString(),
  });
  if (insertError) {
    console.error("[portal] portal_sessions insert failed", insertError);
    return { ok: false, error: DB_ERROR };
  }

  return {
    ok: true,
    token,
    contactId: row.contact_id,
    tenantId: row.tenant_id,
    contactName: row.contact_name,
    relationId: row.relation_id,
    role: row.role,
    studentId: row.student_id,
    studentName: row.student_name,
    firstAccept: Boolean(row.first_accept),
  };
}

/* ---------- 현재 세션 ---------- */

interface RelationRow {
  id: string;
  role: string;
  student_id: string;
  accepted_at: string | null;
}

/**
 * 현재 요청의 포털 세션. 쿠키 토큰 → 해시 → portal_sessions(미회수·미만료) → active 관계 목록.
 * 페이지·레이아웃·서버 액션에서 요청당 수차례 호출되므로 React cache()로 요청 단위 메모화.
 *
 * null을 돌려주는 경우(전부 "비로그인"으로 동일 취급 — 존재 여부를 드러내지 않는다):
 *  - 쿠키 없음·위조·만료·회수(revoked_at)
 *  - active 관계가 하나도 없음 — 관계가 전부 종료되면 세션 행이 살아 있어도 무효다(검수 21)
 *  - 남은 관계의 학생이 전부 종료(ended) — 등록 종료 시 포털 접근도 함께 닫힌다(E-04·검수 109)
 * 조회 오류는 fail-closed로 null이다(불명 상태로 인가하지 않는다).
 */
export const getPortalSession = cache(async (): Promise<PortalSession | null> => {
  const store = await cookies();
  const token = store.get(PORTAL_COOKIE)?.value;
  if (!token) return null;

  const db = createServiceClient();
  if (!db) return null; // 무상태 폴백 없음 — 회수 불가한 세션은 만들지 않는다

  // 현재 Host의 테넌트로 스코프해 조회한다 — 세션은 발급된 테넌트에서만 유효하고,
  // 타 테넌트 호스트에서 재생된 쿠키는 여기서 무효가 된다(관리자 세션과 같은 정책).
  const tenant = await resolveTenant();
  const { data: session, error } = await db
    .from("portal_sessions")
    .select("tenant_id, contact_id, expires_at")
    .eq("tenant_id", tenant.id)
    .eq("token_hash", hashSessionToken(token))
    .is("revoked_at", null)
    .maybeSingle();
  if (error) {
    console.error("[portal] portal_sessions lookup failed", error);
    return null;
  }
  if (!session) return null;

  const tenantId = session.tenant_id as string;
  const contactId = session.contact_id as string;
  const expiresAt = session.expires_at as string;
  if (new Date(expiresAt).getTime() < Date.now()) return null;

  const [contactRes, relationRes] = await Promise.all([
    db
      .from("portal_contacts")
      .select("name")
      .eq("tenant_id", tenantId)
      .eq("id", contactId)
      .maybeSingle(),
    db
      .from("portal_relations")
      .select("id, role, student_id, accepted_at")
      .eq("tenant_id", tenantId)
      .eq("contact_id", contactId)
      .eq("status", "active"),
  ]);
  if (contactRes.error || relationRes.error) {
    console.error(
      "[portal] contact/relation lookup failed",
      contactRes.error ?? relationRes.error,
    );
    return null;
  }
  if (!contactRes.data) return null; // 사람 행이 사라졌으면 세션도 없다

  const rows = (relationRes.data ?? []) as RelationRow[];
  if (rows.length === 0) return null; // 관계 전부 종료 → 접근 종료(검수 21)

  const studentIds = [...new Set(rows.map((r) => r.student_id))];
  const { data: studentData, error: studentError } = await db
    .from("students")
    .select("id, name, status")
    .eq("tenant_id", tenantId)
    .in("id", studentIds);
  if (studentError) {
    console.error("[portal] students lookup failed", studentError);
    return null;
  }
  // 종료(ended) 학생은 링크가 유효해도 열지 않는다 — 기존 포털 토큰 경로와 같은 판단
  // (lib/data/crm.ts getStudentByPortalToken). 재등록으로 다시 활성되면 자연히 복구된다.
  const students = new Map<string, string>();
  for (const s of (studentData ?? []) as {
    id: string;
    name: string;
    status: string;
  }[]) {
    if (s.status === "ended") continue;
    students.set(s.id, s.name);
  }

  const relations: PortalRelationView[] = [];
  for (const row of rows) {
    const studentName = students.get(row.student_id);
    if (!studentName) continue;
    if (!isPortalRole(row.role)) continue;
    relations.push({
      relationId: row.id,
      role: row.role,
      studentId: row.student_id,
      studentName,
      acceptedAt: row.accepted_at,
    });
  }
  if (relations.length === 0) return null;

  return {
    contactId,
    tenantId,
    contactName: contactRes.data.name as string,
    relations,
    expiresAt,
  };
});

/* ---------- 회수 ---------- */

export interface PortalMutationResult {
  ok: boolean;
  error?: string;
}

/**
 * 한 사람(contact)의 활성 세션 전부 회수(revoked_at 갱신 — 행 삭제 없음, 이력 보존).
 * 관계 회수·분쟁 임시 차단·전 기기 로그아웃에서 쓴다.
 */
export async function revokeContactSessions(
  tenantId: string,
  contactId: string,
  reason: string,
): Promise<PortalMutationResult> {
  const db = createServiceClient();
  if (!db) {
    return { ok: false, error: "DB 미연결 — 세션 회수를 실행할 수 없습니다." };
  }
  const { error } = await db
    .from("portal_sessions")
    .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq("tenant_id", tenantId)
    .eq("contact_id", contactId)
    .is("revoked_at", null);
  if (error) {
    console.error("[portal] revokeContactSessions failed", error);
    return { ok: false, error: "세션 회수에 실패했습니다." };
  }
  return { ok: true };
}

/**
 * 현재 쿠키의 세션 한 건만 회수(로그아웃 경로 — P-02 "로그아웃으로 접근 종료").
 * 쿠키 삭제는 호출부(서버 액션·라우트 핸들러)가 한다. 실패해도 던지지 않는다 —
 * 로그아웃은 쿠키 삭제만으로도 성립하고, 회수 실패는 로그로 남긴다.
 */
export async function revokeCurrentPortalSession(reason: string): Promise<void> {
  const store = await cookies();
  const token = store.get(PORTAL_COOKIE)?.value;
  if (!token) return;
  const db = createServiceClient();
  if (!db) return;
  // 조회(getPortalSession)와 동일하게 현재 Host의 테넌트로 스코프한다.
  const tenant = await resolveTenant();
  const { error } = await db
    .from("portal_sessions")
    .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq("tenant_id", tenant.id)
    .eq("token_hash", hashSessionToken(token))
    .is("revoked_at", null);
  if (error) console.error("[portal] revokeCurrentPortalSession failed", error);
}

/* ---------- 초대 링크 발급·재발급 ---------- */

export type RotateAccessLinkResult =
  | {
      ok: true;
      /** 발송에 쓸 원 토큰 — 저장되는 것은 해시뿐이라 이 시점에만 존재한다. */
      token: string;
    }
  | { ok: false; error: string };

/**
 * 관계 하나의 초대 링크를 새로 발급한다. 첫 발급과 재발급이 같은 함수다 —
 * "새 초대 발급: 이전 초대 즉시 무효"(P-01·검수 20)를 한 경로로 강제하기 위해서다.
 *
 * 순서가 중요하다: 이전 링크를 먼저 무효화하고 새 링크를 넣는다. 반대로 하면 새 링크 발급 후
 * 회수가 실패했을 때 살아 있는 링크가 둘이 되어 검수 20이 깨진다. 새 링크 insert가 실패하면
 * 그 관계에는 유효한 링크가 없는 상태(= 접근 차단)로 남고, 운영자가 다시 발급하면 복구된다.
 *
 * 회수된 관계에는 발급하지 않는다. 00017의 재초대 규약은 "같은 관계 행을 invited로 되살린 뒤
 * 새 링크 발급"이므로, 호출부는 관계를 되살리고 나서 이 함수를 부른다 — 순서를 뒤집으면
 * "링크 재발급" 버튼 하나가 회수된 권한을 되살리는 경로가 된다(권한 부활은 늘 명시적이어야 한다).
 *
 * 권한 전환이므로 호출부(운영자 서버 액션)는 runCritical(category "permission")로 감싼다 —
 * 이 파일은 상태 전환만 수행하고 감사 기록은 하지 않는다(한 사건 한 기록).
 */
export async function rotateAccessLink(
  tenantId: string,
  relationId: string,
  reason = "초대 재발급",
): Promise<RotateAccessLinkResult> {
  const db = createServiceClient();
  if (!db) {
    return { ok: false, error: "DB 미연결 — 초대 링크를 발급할 수 없습니다." };
  }

  const { data: relation, error: relationError } = await db
    .from("portal_relations")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("id", relationId)
    .maybeSingle();
  if (relationError) {
    console.error("[portal] relation lookup failed", relationError);
    return { ok: false, error: DB_ERROR };
  }
  if (!relation) return { ok: false, error: "대상 관계를 찾을 수 없습니다." };
  if (relation.status === "revoked") {
    // 회수된 관계에 새 링크를 주면 회수가 무의미해진다 — 재초대(관계 되살리기)가 먼저다(P-06).
    return {
      ok: false,
      error: "회수된 관계입니다. 다시 초대하려면 관계를 되살린 뒤 링크를 발급해 주세요.",
    };
  }

  const now = new Date().toISOString();
  const { error: revokeError } = await db
    .from("portal_access_links")
    .update({ revoked_at: now, revoked_reason: reason, rotated_at: now })
    .eq("tenant_id", tenantId)
    .eq("relation_id", relationId)
    .is("revoked_at", null);
  if (revokeError) {
    console.error("[portal] previous link revoke failed", revokeError);
    return {
      ok: false,
      error: "이전 초대 링크를 무효화하지 못해 새 링크를 발급하지 않았습니다.",
    };
  }

  const token = newToken();
  const { error: insertError } = await db.from("portal_access_links").insert({
    tenant_id: tenantId,
    relation_id: relationId,
    token_hash: hashLinkToken(token),
  });
  if (insertError) {
    console.error("[portal] portal_access_links insert failed", insertError);
    return {
      ok: false,
      error:
        "새 초대 링크 발급에 실패했습니다. 이전 링크는 이미 무효이니 다시 발급해 주세요.",
    };
  }
  return { ok: true, token };
}

/* ---------- 관계 회수 ---------- */

export interface RevokeRelationResult extends PortalMutationResult {
  /** 회수된 관계의 사람 — 호출부가 안내 발송·감사 기록 대상으로 쓴다. */
  contactId?: string;
  /** 남은 active 관계가 없어 이 사람의 세션까지 닫았는지(검수 21). */
  sessionsRevoked?: boolean;
}

/**
 * 포털 관계 종료 — 관계 revoke + 초대 링크 무효 + (남은 관계가 없으면) 세션 회수를 한 흐름으로.
 * "포털 관계가 종료되면 기존 세션·초대·공유경로가 모두 닫힌다"(검수 21·P-06)의 실행 지점이다.
 *
 * 다른 학생·다른 역할 관계가 남아 있으면 세션은 유지한다 — 남은 관계의 범위로만 열린다
 * (getPortalSession이 매 요청 active 관계를 다시 계산하므로, 회수된 관계는 다음 요청부터 사라진다).
 * 이미 회수된 관계에 다시 호출하면 링크·세션 정리만 수행하고 성공으로 수렴한다(중복 회수 안전).
 *
 * 권한 전환이므로 호출부는 runCritical(category "permission")로 감싼다.
 */
export async function revokeRelation(
  tenantId: string,
  relationId: string,
  reason: string,
): Promise<RevokeRelationResult> {
  const db = createServiceClient();
  if (!db) {
    return { ok: false, error: "DB 미연결 — 관계 회수를 실행할 수 없습니다." };
  }

  const { data: relation, error: relationError } = await db
    .from("portal_relations")
    .select("id, contact_id, status")
    .eq("tenant_id", tenantId)
    .eq("id", relationId)
    .maybeSingle();
  if (relationError) {
    console.error("[portal] relation lookup failed", relationError);
    return { ok: false, error: DB_ERROR };
  }
  if (!relation) return { ok: false, error: "대상 관계를 찾을 수 없습니다." };
  const contactId = relation.contact_id as string;
  const now = new Date().toISOString();

  if (relation.status !== "revoked") {
    const { error: updateError } = await db
      .from("portal_relations")
      .update({ status: "revoked", revoked_at: now, revoked_reason: reason })
      .eq("tenant_id", tenantId)
      .eq("id", relationId)
      .neq("status", "revoked");
    if (updateError) {
      console.error("[portal] relation revoke failed", updateError);
      return { ok: false, error: "관계 회수에 실패했습니다.", contactId };
    }
  }

  const { error: linkError } = await db
    .from("portal_access_links")
    .update({ revoked_at: now, revoked_reason: reason })
    .eq("tenant_id", tenantId)
    .eq("relation_id", relationId)
    .is("revoked_at", null);
  if (linkError) {
    // 관계는 이미 닫혔으므로 링크로 새 세션을 만들어도 active 관계가 없어 열리지 않는다.
    // 그래도 공유경로가 남은 상태이므로 실패로 알려 운영자가 다시 실행하게 한다(재실행 안전).
    console.error("[portal] access link revoke failed", linkError);
    return {
      ok: false,
      error: "관계는 회수했으나 초대 링크 무효화에 실패했습니다. 다시 시도해 주세요.",
      contactId,
    };
  }

  // 남은 역할이 있어도 세션은 전부 끊는다 — 열려 있던 화면이 회수된 역할을 계속 보여주는 창을
  // 남기지 않기 위해서다(00017 ④ 주석·운영자 확인 문구와 같은 계약). 남은 역할은 살아 있는
  // 초대 링크로 즉시 다시 로그인하면 되고, 그 재로그인이 관계를 다시 계산한다.
  const revoked = await revokeContactSessions(tenantId, contactId, reason);
  if (!revoked.ok) {
    return {
      ok: false,
      error: "관계는 회수했으나 세션 회수에 실패했습니다. 다시 시도해 주세요.",
      contactId,
    };
  }
  return { ok: true, contactId, sessionsRevoked: true };
}
