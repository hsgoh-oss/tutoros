import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { getSiteContent } from "@/lib/data/content";
import { Container, Section, SectionHeading } from "@/components/public/section";
import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
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

  // O-04 정본 "공개 상태 = 실제 접수 가능 상태": 접수 중단(closed)이면 폼 대신 마감 안내를 보여준다.
  // 배너 노출 여부(isBannerVisible)와 무관하게 상태 자체가 접수 가능 여부를 결정한다.
  // 서버 액션(submitConsult)도 같은 기준으로 거부하므로 화면 우회로는 접수되지 않는다.
  // 대기명단 실동작(정원 산정·자리 제안)은 M2 몫 — 여기서는 안내만 한다.
  const isRecruitClosed = content.recruit.status === "closed";

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
          {isRecruitClosed ? (
            <Card
              role="status"
              className="flex flex-col items-start gap-5 p-10"
            >
              <p className="text-sm font-extrabold text-brand-600">접수 안내</p>
              <h3 className="text-2xl font-black tracking-tight text-ink">
                현재 모집이 마감되었습니다
              </h3>
              <p className="text-[15px] leading-[1.86] tracking-tight text-muted">
                지금은 신규 상담 접수를 받지 않습니다. 대기 신청은 준비 중이며,
                모집이 재개되면 이 페이지에서 다시 신청하실 수 있습니다. 모집
                재개 안내가 필요하시면 카카오톡으로 문의해 주세요.
              </p>
              <a
                href={content.settings.kakaoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass("primary", "md")}
              >
                카카오톡 문의
              </a>
            </Card>
          ) : (
            <ConsultForm
              initialMode={sp.mode}
              initialHours={sp.hours}
              initialFreq={sp.freq}
              kakaoUrl={content.settings.kakaoUrl}
            />
          )}
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
