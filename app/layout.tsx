import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// 폰트 파일은 KS X 1001 완성형(2,350자)+라틴 서브셋(1MB→416KB, scripts/subset-font.sh)
// — 원본 1MB는 시뮬레이션 4G에서 LCP를 7.5s까지 밀어 Lighthouse 모바일 90+(계약)을 깬다.
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  display: "swap",
  weight: "45 920",
  variable: "--font-pretendard",
});

export const metadata: Metadata = {
  title: {
    default: "AXIOM MATH LAB — 1:1 수학 과외",
    template: "%s | AXIOM MATH LAB",
  },
  description:
    "김과외 전국 상위 0.2% 튜터의 1:1 수학 과외. 내신·수능·수리논술, 매 수업 학부모 리포트까지.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={pretendard.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
