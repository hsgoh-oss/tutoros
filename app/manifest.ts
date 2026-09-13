import type { MetadataRoute } from "next";

// PWA 매니페스트 — 홈 화면 추가(설치)를 위한 최소 선언.
//
// 여기까지가 "PWA"의 첫 단계다: 아이콘·이름·독립 창 실행. 오프라인 캐시(서비스 워커)와
// 웹 푸시는 넣지 않았다 — 푸시는 구독 저장·VAPID 키·발송 크론·수신 동의 UI가 따로 필요하고
// (이용약관 제12조 "PWA Push로 최소한 알릴 수 있다"), 그 범위는 별도 회차로 잡는다.
// 서비스 워커 없이도 Chrome·Safari 모두 홈 화면 추가가 된다.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AXIOM MATH LAB",
    short_name: "AXIOM",
    description: "원인 진단 기반 1:1 맞춤 수학 수업",
    lang: "ko",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2353ef",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
