import { createHmac, randomBytes } from "crypto";

// 후기·사례 작성 초대 링크 토큰(review_invitations.token_hash) — S-01 "작성 초대 발급 → 전달".
//
// 규약은 lib/intake/token.ts(신청폼)와 같다: 원문 토큰은 링크(알림톡·문자)에만 존재하고 DB에는
// HMAC-SHA256(AUTH_SECRET) 해시만 남는다. 초대를 닫는 것(status='closed')만으로 링크가 즉시 무효가 된다.
//
// ⚠️ 발급(운영자)과 작성(공개 화면) 양쪽의 유일한 해시 정의다 — 새 호출부는 반드시 여기서 import할 것.

const DEV_SECRET = "dev-only-secret-change-me";

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s === DEV_SECRET) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "AUTH_SECRET 미설정 — 프로덕션에서는 강력한 무작위 값이 필수입니다(작성 링크 위조 방지).",
      );
    }
    return DEV_SECRET;
  }
  return s;
}

/** 링크 토큰 → DB에 저장·대조할 해시. 접두사로 신청폼('intake-form:')·포털과 도메인을 분리한다. */
export function hashReviewToken(token: string): string {
  return createHmac("sha256", secret())
    .update(`review-invite:${token}`)
    .digest("hex");
}

/** 새 링크 토큰 원문(32바이트 난수). 발급 시 한 번만 노출되고 이후에는 해시만 남는다. */
export function newReviewToken(): string {
  return randomBytes(32).toString("base64url");
}

/** 작성 링크 경로 — 라우트는 app/w/[token]/page.tsx. robots.ts·meta robots로 색인 제외. */
export function reviewFormPath(rawToken: string): string {
  return `/w/${rawToken}`;
}
