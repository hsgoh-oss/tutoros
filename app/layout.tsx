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

// 공유 미리보기(OG)는 이 사업에서 장식이 아니라 유입 경로다 — 상담 링크는 대부분 카카오톡·문자로
// 전달되고, OG가 없으면 제목·이미지 없이 맨 URL만 뜬다. metadataBase가 있어야 하위 페이지의
// 상대 canonical·이미지 경로가 절대 URL로 풀린다.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://axiommathlab.kr";
const BRAND = "AXIOM MATH LAB";
const DESCRIPTION =
  "김과외 전국 상위 0.2% 튜터의 1:1 수학 과외. 내신·수능·수리논술, 매 수업 학부모 리포트까지.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${BRAND} — 1:1 수학 과외`,
    template: `%s | ${BRAND}`,
  },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: BRAND,
    locale: "ko_KR",
    url: "/",
    title: `${BRAND} — 1:1 수학 과외`,
    description: DESCRIPTION,
    images: [
      {
        url: "/img/og-axiom.png",
        width: 1200,
        height: 630,
        alt: `${BRAND} — 1:1 수학 과외`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND} — 1:1 수학 과외`,
    description: DESCRIPTION,
    images: ["/img/og-axiom.png"],
  },
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
