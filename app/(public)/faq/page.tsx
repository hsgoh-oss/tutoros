import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { getSiteContent } from "@/lib/data/content";
import { Container, Section, SectionHeading } from "@/components/public/section";
import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { FaqExplorer } from "@/components/public/faq/faq-explorer";
import Link from "next/link";

export const metadata: Metadata = { title: "자주 묻는 질문" };

export default async function FaqPage() {
  const tenant = await resolveTenant();
  const content = await getSiteContent(tenant.id);

  return (
    <>
      <Section className="pt-14 md:pt-20">
        <Container className="max-w-3xl">
          <SectionHeading
            eyebrow="FAQ"
            title="자주 묻는 질문"
            desc="상담 전 궁금한 점을 먼저 확인해 보세요."
          />
          <FaqExplorer faqs={content.faqs} />
        </Container>
      </Section>

      <Section className="pt-0">
        <Container className="max-w-3xl">
          <Card className="flex flex-col items-start gap-4 border-brand-100 bg-brand-50/40 p-8 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-lg font-black tracking-tight text-ink">
                원하는 답을 못 찾으셨나요?
              </p>
              <p className="mt-1 text-sm tracking-tight text-muted">
                상담 폼을 남겨 주시거나 카카오톡으로 편하게 문의해 주세요.
              </p>
            </div>
            <div className="flex gap-3">
              <a
                href={content.settings.kakaoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass("ghost", "md")}
              >
                카카오톡 문의
              </a>
              <Link href="/consult" className={buttonClass("primary", "md")}>
                상담 신청
              </Link>
            </div>
          </Card>
        </Container>
      </Section>
    </>
  );
}
