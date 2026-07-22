import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { getSiteContent } from "@/lib/data/content";
import { Container, Section, SectionHeading } from "@/components/public/section";
import { ConsultForm } from "@/components/public/consult/consult-form";
import { ConsultSteps } from "@/components/public/home/consult-steps";

export const metadata: Metadata = { title: "상담 신청" };

export default async function ConsultPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; hours?: string; freq?: string }>;
}) {
  const [tenant, sp] = await Promise.all([resolveTenant(), searchParams]);
  const content = await getSiteContent(tenant.id);

  return (
    <>
      <Section className="pt-14 md:pt-20">
        <Container className="max-w-3xl">
          <SectionHeading
            as="h1"
            eyebrow="상담 신청"
            title="지금 상황을 알려주시면 맞춤 상담을 도와드립니다"
            desc="무료 상담이며, 상담 후 등록을 강요하지 않습니다. 확인 후 빠르게 연락드립니다."
          />
          <ConsultForm
            initialMode={sp.mode}
            initialHours={sp.hours}
            initialFreq={sp.freq}
            kakaoUrl={content.settings.kakaoUrl}
          />
        </Container>
      </Section>

      <Section className="pt-0">
        <Container className="max-w-3xl">
          <SectionHeading
            eyebrow="진행 절차"
            title="상담 신청부터 정규 수업까지, 4단계"
          />
          <ConsultSteps />
          <p className="mt-10 rounded-panel bg-soft px-5 py-4 text-sm leading-relaxed text-muted">
            상담은 무료이며, 시범수업(1시간 5만 원)은 선택입니다. 남겨주신
            정보는 상담 안내 목적으로만 사용되며, 상담 후 등록을 강요하지
            않습니다.
          </p>
        </Container>
      </Section>
    </>
  );
}
