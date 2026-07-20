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
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
