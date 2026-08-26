// 변호사 검수 전 초안 — 갑 확정 필요.

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Container, Section, SectionHeading } from "@/components/public/section";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "이용약관",
  alternates: { canonical: "/terms" },
  openGraph: {
    title: "이용약관",
    url: "/terms",
  },
};

function Article({
  no,
  title,
  children,
}: {
  no: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-line py-8 first:pt-0 last:border-none">
      <h2 className="text-lg font-black tracking-tight text-ink">
        제{no}조 ({title})
      </h2>
      <div className="mt-4 space-y-3 text-[15px] leading-[1.86] tracking-tight text-ink-soft">
        {children}
      </div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <Section className="pt-14 md:pt-20">
      <Container className="max-w-3xl">
        <SectionHeading as="h1" eyebrow="약관" title="이용약관" />

        <div className="mb-10 flex flex-wrap items-center gap-3 rounded-panel border border-line bg-soft px-5 py-4 text-sm text-muted">
          <Badge tone="warning">v0.9 초안</Badge>
          <span>시행 예정일 2026-08-14</span>
        </div>

        <Article no={1} title="목적">
          <p>
            이 약관은 액시엄매스랩(이하 &ldquo;회사&rdquo;)이 제공하는 1:1
            수학 과외 서비스(이하 &ldquo;서비스&rdquo;)의 이용과 관련하여
            회사와 이용자(수강생 또는 보호자)의 권리·의무 및 책임사항을
            정함을 목적으로 합니다.
          </p>
        </Article>

        <Article no={2} title="수업 운영">
          <p>
            정규 수업은 회당 최소 2시간부터 0.5시간 단위로 구성하며, 주
            1회부터 7회까지 신청할 수 있습니다. 수업료는 시간당 단가 × 회당
            수업 시간 × 주당 횟수 × 4주로 산정되며, 4주 단위로 선납합니다.
          </p>
        </Article>

        <Article no={3} title="일정 변경 및 보강">
          <p>
            학생 또는 보호자의 사정으로 예정된 수업이 어려운 경우 사전에
            연락하면 상호 협의하여 보강 일정을 조율합니다. 보강 일정이
            확정되면 별도로 안내드립니다.
          </p>
        </Article>

        <Article no={4} title="지각 및 결석">
          <p>
            사전 통보 없는 결석은 보강 대상에서 제외될 수 있습니다. 지각한
            경우 수업은 원래 종료 시각까지 진행하며, 지각 시간만큼
            연장하지 않습니다.
          </p>
        </Article>

        <Article no={5} title="교재">
          <p>
            수업에 필요한 교재는 상담 시 안내드리며, 별도 구입이 필요한
            교재의 비용은 수강생이 부담합니다.
          </p>
        </Article>

        <Article no={6} title="학부모 리포트 제공">
          <p>
            매 수업 후 수업 내용·과제·학습 태도를 담은 리포트를
            보호자에게 발송합니다. 주간·월간 리포트 및 시험 분석 리포트도
            제공됩니다.
          </p>
        </Article>

        <Article no={7} title="책임의 한계">
          <p>
            회사는 천재지변, 통신 장애 등 회사의 귀책사유 없는 사유로
            발생한 서비스 중단에 대해 책임을 지지 않습니다. 성적 향상은
            학생 개개인의 학습 태도와 여건에 따라 달라질 수 있으며, 회사는
            특정 결과를 보장하지 않습니다.
          </p>
        </Article>
      </Container>
    </Section>
  );
}
