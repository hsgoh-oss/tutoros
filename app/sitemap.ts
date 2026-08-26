import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://axiommathlab.kr";

// 정본(axiom-platform)의 공개 경로 집합.
// /apply·/status는 개인정보 수집·진행 상태 화면이라 noindex이므로 사이트맵에도 넣지 않는다.
const ROUTES: { path: string; priority: number }[] = [
  { path: "/", priority: 1 },
  { path: "/classes", priority: 0.9 },
  { path: "/tutor", priority: 0.9 },
  { path: "/case", priority: 0.8 },
  { path: "/reviews", priority: 0.8 },
  { path: "/faq", priority: 0.7 },
  { path: "/terms", priority: 0.3 },
  { path: "/lesson-policy", priority: 0.3 },
  { path: "/privacy", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map(({ path, priority }) => ({
    url: `${SITE_URL}${path}`,
    lastModified: new Date(),
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority,
  }));
}
