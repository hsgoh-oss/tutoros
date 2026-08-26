import { NextResponse, type NextRequest } from "next/server";

// ① Host를 x-tenant-host로 전달(테넌트 리졸브) ② /admin 미인증 전체 차단(쿠키 존재 검사).
// 서명 검증은 Node 런타임(app/admin 레이아웃·서버 액션)에서 재수행한다 — 여기서는 1차 차단만.

const SESSION_COOKIE = "tutoros_admin";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";

  // www는 apex로 넘긴다. 보기 좋으라고가 아니라 테넌트 리졸브 때문이다 — tenants.custom_domain은
  // apex 정확 일치라 "www.…"로 들어오면 매칭에 실패하고 기본 테넌트로 떨어진다. 같은 내용이 두
  // 호스트에 뜨는 것도 막는다(canonical과 같은 방향).
  if (host.startsWith("www.")) {
    const url = request.nextUrl.clone();
    url.host = host.slice(4);
    url.port = "";
    return NextResponse.redirect(url, 308);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-tenant-host", host);

  const { pathname } = request.nextUrl;
  const isAdmin = pathname.startsWith("/admin");
  const isLogin = pathname.startsWith("/admin/login");

  if (isAdmin && !isLogin && !request.cookies.get(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|img/|fonts/|favicon.ico).*)"],
};
