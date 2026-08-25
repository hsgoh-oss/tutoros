import { createHmac, randomBytes } from "crypto";

// 신청폼 링크 토큰(intake_forms.token_hash) — T-01(시범 신청폼)·R-01(정규 신청폼).
//
// 규약은 00017 portal_access_links와 같다: 원문 토큰은 링크(문자 발송)에만 존재하고
// DB에는 HMAC-SHA256(AUTH_SECRET) 해시만 남는다. DB가 유출돼도 작성 링크를 역산할 수 없고,
// 폼을 닫는 것(status='closed')만으로 링크가 즉시 무효가 된다(검수 7 — 새 폼 발급 시 이전 폼 닫힘).
//
// ⚠️ 이 파일이 발급(운영자)과 작성(공개 화면) 양쪽의 유일한 해시 정의다. 어느 한쪽이 자기
//    해시를 따로 만들면 발급한 링크가 열리지 않는다 — 새 호출부는 반드시 여기서 import할 것.
//    (lib/data/intake.ts의 getFormByTokenHash는 이미 해시된 값을 인자로 받는다.)

const DEV_SECRET = "dev-only-secret-change-me";

// 해시 키. lib/auth/session.ts·lib/portal/auth.ts와 같은 환경변수 하나(AUTH_SECRET)를 쓴다 —
// 값이 갈라지면 안 되므로 이름을 공유하고, 프로덕션 미설정이면 즉시 실패한다(링크 위조 방지).
function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s === DEV_SECRET) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "AUTH_SECRET 미설정 — 프로덕션에서는 강력한 무작위 값이 필수입니다(신청폼 링크 위조 방지).",
      );
    }
    return DEV_SECRET;
  }
  return s;
}

/**
 * 링크 토큰 → DB에 저장·대조할 해시.
 * 접두사로 도메인을 분리한다(관리자 세션 'session:'·포털 'portal-link:'와 같은 계열) —
 * 한쪽에서 새어 나온 해시를 다른 쪽에 재생할 수 없게 하기 위해서다.
 */
export function hashIntakeToken(token: string): string {
  return createHmac("sha256", secret())
    .update(`intake-form:${token}`)
    .digest("hex");
}

/** 새 링크 토큰 원문(32바이트 난수). 발급 시 한 번만 노출되고 이후에는 해시만 남는다. */
export function newIntakeToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * 작성 링크 경로 규약 — 발송 호출부(알림 템플릿)와 작성 화면이 같은 형태를 쓰도록 여기서 정한다.
 * 라우트는 app/f/[token]/page.tsx이며 robots.ts·meta robots로 색인에서 함께 제외돼 있다.
 */
export function intakeFormPath(rawToken: string): string {
  return `/f/${rawToken}`;
}
