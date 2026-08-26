import { resolveTenant } from "@/lib/tenant";
import { getSiteContent } from "@/lib/data/content";
import { SiteHeader } from "@/components/public/site-header";
import { SiteFooter } from "@/components/public/site-footer";
import { FloatingCtas } from "@/components/public/floating-ctas";

// 공개 사이트 셸.
//
// 정본(axiom-platform)과 같은 순서다: 본문 바로가기 → 헤더 → 상시 CTA → 본문 → 푸터.
// 모집 띠·D-day 띠는 여기 두지 않는다 — 홈에서만 띄운다(app/(public)/page.tsx).
// 매 화면 위에 띠 두 줄을 얹으면 정작 그 화면이 하려던 말이 세 번째 줄로 밀린다.
export default async function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const tenant = await resolveTenant();
  const content = await getSiteContent(tenant.id);

  return (
    <>
      <a className="skip-link" href="#main-content">
        본문 바로가기
      </a>
      <SiteHeader kakaoUrl={content.settings.kakaoUrl} />
      <FloatingCtas kakaoUrl={content.settings.kakaoUrl} />
      <main id="main-content">{children}</main>
      <SiteFooter settings={content.settings} />
    </>
  );
}
