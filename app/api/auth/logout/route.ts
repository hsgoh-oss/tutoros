import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, revokeSessionByToken } from "@/lib/auth/session";

// 로그아웃 — 서버측 세션(admin_sessions)을 회수한 뒤 쿠키를 지운다.
// 회수 실패·토큰 부재여도 쿠키 삭제 + 리다이렉트는 항상 수행한다(로그아웃은 항상 성공).
export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      await revokeSessionByToken(token, "logout");
    } catch (err) {
      console.error("[auth] logout revoke failed", err);
    }
  }

  const response = NextResponse.redirect(
    new URL("/admin/login", request.url),
    { status: 303 },
  );
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
