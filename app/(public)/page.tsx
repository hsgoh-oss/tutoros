import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { getSiteContent } from "@/lib/data/content";
import { Container, Section, SectionHeading } from "@/components/public/section";
import { Hero } from "@/components/public/home/hero";
import { Checklist } from "@/components/public/home/checklist";
import { SubjectCards } from "@/components/public/home/subjects";
import { CaseResults } from "@/components/public/home/case-results";
import { ReviewsPreview } from "@/components/public/home/reviews-preview";
import { RatesPreview } from "@/components/public/home/rates-preview";
import { ConsultSteps } from "@/components/public/home/consult-steps";
import { CtaBand } from "@/components/public/home/cta-band";

export const metadata: Metadata = {
  description:
    "김과외 전국 상위 0.2% 튜터의 1:1 수학 과외. 내신·수능·수리논술 맞춤 수업, 매 수업 학부모 리포트 발송. 대면·화상 수업 상담 환영.",
};

export default async function HomePage() {
  const tenant = await resolveTenant();
  const content = await getSiteContent(tenant.id);

  return (
    <>
      <Hero badges={content.badges} />

      <Section className="bg-soft">
        <Container>
          <SectionHeading
            eyebrow="자가진단"
            title="혹시, 우리 아이도 그런가요?"
            desc="아래 항목 중 해당하는 것을 선택해 보세요."
          />
          <Checklist items={content.checklist} />
        </Container>
      </Section>

      <Section>
        <Container>
          <SectionHeading
            eyebrow="수업 과목"
            title="내신·수능·수리논술, 세 가지 트랙"
            desc="학생의 목표와 현재 위치에 따라 다른 전략을 적용합니다."
          />
          <SubjectCards subjects={content.subjects} />
        </Container>
      </Section>

      <Section className="bg-soft">
        <Container>
          <SectionHeading
            eyebrow="성적 향상 사례"
            title="숫자로 증명하는 변화"
            desc="실제 수강생의 등급 변화입니다."
          />
          <CaseResults cases={content.cases} />
        </Container>
      </Section>

      <Section>
        <Container>
          <SectionHeading
            eyebrow="수강 후기"
            title="학생과 학부모가 남긴 후기"
          />
          <ReviewsPreview reviews={content.reviews} />
        </Container>
      </Section>

      <Section className="bg-soft">
        <Container>
          <SectionHeading
            eyebrow="수업료"
            title="부담 없이 시작하는 시범수업"
            desc="시간당 단가와 시범수업 비용입니다. 예상 총 비용은 계산기로 확인하세요."
          />
          <RatesPreview rates={content.rates} />
        </Container>
      </Section>

      <Section>
        <Container>
          <SectionHeading
            eyebrow="상담 절차"
            title="상담부터 정규 수업까지, 4단계"
          />
          <ConsultSteps />
        </Container>
      </Section>

      <CtaBand />
    </>
  );
}
