import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "관리자", template: "%s | TUTOR OS 관리자" },
  robots: { index: false, follow: false },
};

// admin-surface: 표면 변수를 도구 쪽으로 바꾸는 스코프(app/globals.css).
//
// (protected)가 아니라 여기에 거는 이유: 로그인 화면은 보호 레이아웃 밖이라 아래에 걸면
// 혼자 랜딩 표면(28px 반경·그림자·알약 버튼)으로 남는다. 관리자로 들어가는 첫 화면부터
// 같은 얼굴이어야 한다.
export default function AdminRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="admin-surface">{children}</div>;
}
