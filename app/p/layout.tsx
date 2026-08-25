import type { Metadata } from "next";

// 역할별 포털(/p) 셸 — 학생·보호자·납부자·계약자가 초대 링크로 로그인해 들어오는 화면.
// 정본: docs/flow-canon/01_atlas_02_portal_lessons.md P-01(역할별 초대)·P-02(로그인·세션·복구)
//       · P-03(학생)·P-04(보호자)·P-05(납부자).
//
// 기존 /portal/[token](학생당 단일 비밀 토큰)은 그대로 병행 운영한다 — 이 경로는 그것을
// 대체하거나 은퇴시키지 않는다(전환은 운영자 판단).
//
// 색인 금지: 링크 자체가 로그인 수단이므로 검색엔진에 어떤 경로도 남기지 않는다.
// (robots.txt의 Disallow는 크롤 차단일 뿐 색인 차단이 아니라서 meta robots까지 함께 둔다.
//  app/robots.ts의 disallow 목록에 "/p"를 추가하는 일은 그 파일 소유자 몫으로 남긴다.)
export const metadata: Metadata = {
  title: "학습 포털",
  robots: { index: false, follow: false },
};

export default function PortalRoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-soft">{children}</div>;
}
