import { NextResponse, type NextRequest } from "next/server";
import {
  PORTAL_COOKIE,
  PORTAL_COOKIE_OPTIONS,
  issuePortalSessionFromLink,
} from "@/lib/portal/auth";

// 초대 링크 수락 → 세션 발급 (P-01 수락 · P-02 로그인).
//
// 첫 클릭이 곧 수락이고(accepted_at 원자적 스탬프 — 검수 125), 이후 클릭은 같은 관계로
// 수렴하며(검수 124) 매번 새 세션을 발급한다. 판정·스탬프·세션 insert는 전부
// issuePortalSessionFromLink 안에서 끝난다 — 이 파일은 결과를 쿠키와 리다이렉트로 옮길 뿐이다.
//
// GET인 이유: 문자로 받은 링크를 누르는 것이 유일한 진입 방법이다. 부수효과가 있는 GET이지만
// 수락은 멱등(이미 active면 no-op)이고 세션 발급은 반복해도 안전하므로 재요청 위험이 없다.
//
// 실패는 이유를 구분하지 않는다: 없는 토큰·회수된 링크·재발급으로 대체된 링크·회수된 관계·
// 종료된 학생·다른 테넌트가 전부 같은 안내로 수렴한다(P-02 "계정 존재를 노출하지 않는 확인").
// 오류 문구를 쿼리로 실어 나르지 않고 코드(e=link)만 넘긴다 — 화면 문구는 /p가 고정 문자열로
// 렌더한다(URL에 담긴 임의 텍스트를 그대로 그리는 경로를 만들지 않는다).
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const result = await issuePortalSessionFromLink(token);

  if (!result.ok) {
    const failed = new URL("/p", request.url);
    failed.searchParams.set("e", "link");
    return NextResponse.redirect(failed, 302);
  }

  // 세션이 실제로 만들어진 뒤에만 쿠키를 심는다 — 발급 실패 시 쿠키만 남아
  // "로그인된 것처럼 보이는데 아무것도 열리지 않는" 상태를 만들지 않는다.
  const response = NextResponse.redirect(new URL("/p", request.url), 302);
  response.cookies.set(PORTAL_COOKIE, result.token, PORTAL_COOKIE_OPTIONS);
  return response;
}
