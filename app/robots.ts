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
        disallow: ["/admin", "/api", "/portal", "/p"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
