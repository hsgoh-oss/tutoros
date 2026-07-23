import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// 서브셋(KS X 1001 한글+라틴) + 가변 축을 실사용 굵기 구간으로 제한해 1MB→296KB.
// 축 45~930을 그대로 두면 쓰지도 않는 구간의 델타까지 실려 122KB를 더 받는다.
// 실제 사용 굵기는 400(본문)·600·700·800·900뿐이라 400~900이면 충분하다(scripts/subset-font.sh).
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  display: "swap",
  weight: "400 900",
  variable: "--font-pretendard",
});
// preload:false도 재봤지만 Load Delay가 준 만큼 Render Delay가 늘어(94→389ms) 상쇄돼 되돌렸다.

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
