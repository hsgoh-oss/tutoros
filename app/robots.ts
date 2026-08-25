import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://axiommathlab.kr";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /p는 역할별 포털(수락 라우트 /p/link/[token]은 라우트 핸들러라 meta robots가 붙지 않는다 —
        // 크롤러의 GET 한 번이 최초 수락 스탬프가 되지 않도록 robots에서도 막는다).
        // /f는 시범·정규 신청폼 작성 링크(T-01·R-01) — 링크 자체가 접근 수단이라 크롤·색인 모두 막는다
        // (페이지 meta robots도 함께 둔다 — Disallow는 크롤 차단일 뿐 색인 차단이 아니다).
        disallow: ["/admin", "/api", "/portal", "/p", "/f"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
