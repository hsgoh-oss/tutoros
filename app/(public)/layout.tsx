import { resolveTenant } from "@/lib/tenant";
import { getSiteContent } from "@/lib/data/content";
import { SiteHeader } from "@/components/public/site-header";
import { SiteFooter } from "@/components/public/site-footer";
import { DdayBanner } from "@/components/public/dday-banner";
import { RecruitBanner } from "@/components/public/recruit-banner";
import { StickyCta } from "@/components/public/sticky-cta";

export default async function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const tenant = await resolveTenant();
  const content = await getSiteContent(tenant.id);

  return (
    <>
      <SiteHeader kakaoUrl={content.settings.kakaoUrl} />
      <RecruitBanner recruit={content.recruit} />
      <DdayBanner ddays={content.ddays} />
      <main className="pb-20 md:pb-0">{children}</main>
      <SiteFooter settings={content.settings} />
      <StickyCta kakaoUrl={content.settings.kakaoUrl} />
    </>
  );
}
