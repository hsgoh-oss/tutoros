import type { NextConfig } from "next";

// 보안 헤더 4종 (기획 7-15 NFR). 전 경로 적용.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" }, // 클릭재킹 방지
  { key: "X-Content-Type-Options", value: "nosniff" }, // MIME 스니핑 방지
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  }, // HTTPS 강제(HSTS)
];

const nextConfig: NextConfig = {
  // 과제 제출·자료 업로드는 10MB 파일 검증을 통과해도 서버 액션 기본 본문 한도(1MB)에서
  // 전송이 끊긴다 — 검증 한도보다 약간 크게 열어 폼 오버헤드를 흡수한다.
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
