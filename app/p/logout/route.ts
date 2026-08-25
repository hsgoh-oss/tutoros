import { NextResponse, type NextRequest } from "next/server";
import {
  PORTAL_COOKIE,
  PORTAL_COOKIE_OPTIONS,
  revokeCurrentPortalSession,
} from "@/lib/portal/auth";

// 로그아웃 — "세션 만료 또는 로그아웃 → 접근 종료"(P-02)의 실행 지점.
//
// 쿠키 삭제만으로 끝내지 않는다: 서버측 세션 행에 revoked_at을 찍어야 그 토큰이 다른 기기·
// 복사된 쿠키에서도 즉시 무효가 된다(회수 가능한 세션이 이 모델의 핵심 — 검수 21).
// 회수 실패는 던지지 않고 로그만 남긴다(revokeCurrentPortalSession 계약) — 쿠키는 어떤 경우에도
// 지운다. 접근 종료가 목적이므로, 실패했을 때 남는 쪽이 "브라우저에 쿠키가 남는" 것이어서는 안 된다.
//
// POST 전용: GET 로그아웃은 <img src>·프리페치 한 번으로 남의 세션을 끊을 수 있는 경로가 된다.
// 세션 쿠키가 SameSite=Lax라 교차 사이트 POST에는 쿠키가 실리지 않으므로, 외부에서 이 경로를
// 호출해도 회수 대상 세션을 찾지 못한다(사용자 쿠키만 지워지는 정도의 무해한 결과로 수렴).
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  await revokeCurrentPortalSession("이용자 로그아웃");

  const url = new URL("/p", request.url);
  url.searchParams.set("e", "out");
  // 303: POST 결과를 GET으로 받게 해 새로고침이 로그아웃을 다시 실행하지 않도록 한다.
  const response = NextResponse.redirect(url, 303);
  // maxAge 0 + 발급 때와 같은 옵션(path·secure·httpOnly) — 옵션이 어긋나면 브라우저가
  // 다른 쿠키로 취급해 원본이 남는다.
  response.cookies.set(PORTAL_COOKIE, "", {
    ...PORTAL_COOKIE_OPTIONS,
    maxAge: 0,
  });
  return response;
}
