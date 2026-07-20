import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { getSiteContent } from "@/lib/data/content";
import { Container, Section, SectionHeading } from "@/components/public/section";
import { Card } from "@/components/ui/card";
import { RateToggle } from "@/components/public/classes/rate-toggle";
import { RateCalculator } from "@/components/public/classes/rate-calculator";

export const metadata: Metadata = { title: "수업 안내" };

export default async function ClassesPage() {
  const tenant = await resolveTenant();
  const content = await getSiteContent(tenant.id);

  return (
    <>
      <Section className="pt-14 md:pt-20">
        <Container>
          <SectionHeading
            as="h1"
            eyebrow="수업 안내"
            title="내신부터 수리논술까지, 목표에 맞춘 1:1 수업"
            desc="학생의 현재 위치를 먼저 진단하고, 시험에 나오는 것부터 순서대로 채워갑니다."
          />

          {/* 세 트랙 동등한 흰 카드 3열 — 특정 과목 강조 없이 균형 배치 */}
          <div className="grid gap-6 md:grid-cols-3">
            {content.subjects.map((s) => (
              <Card key={s.key} className="flex flex-col gap-3 p-7">
                <p className="text-xs font-extrabold tracking-tight text-brand-600">
                  {s.target}
                </p>
                <h3 className="text-xl font-black tracking-tight text-ink">
                  {s.title}
                </h3>
                <p className="text-sm leading-[1.86] tracking-tight text-muted">
                  {s.summary}
                </p>
                <ul className="mt-1 space-y-1.5 text-[13px] leading-relaxed text-ink-soft">
                  {s.points.map((p) => (
                    <li key={p}>· {p}</li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </Container>
      </Section>

      <Section className="pt-0">
        <Container>
          <SectionHeading eyebrow="수업료" title="시간당 단가" />
          <RateToggle rates={content.rates} />
        </Container>
      </Section>

      <Section className="pt-0">
        <Container>
          <SectionHeading
            eyebrow="수업료 계산기"
            title="원하는 구성으로 4주 수업료를 확인해 보세요"
          />
          <RateCalculator rates={content.rates} />
          <p className="mt-6 rounded-panel bg-soft px-5 py-4 text-sm leading-relaxed text-muted">
            정규 수업은 회당 최소 2시간부터(0.5시간 단위) 진행됩니다.
            시범수업은 1시간 5만 원으로 별도 운영되며, 등록 시 수업료에서
            차감되지 않습니다.
          </p>
        </Container>
      </Section>

      <Section className="pt-0">
        <Container>
          <SectionHeading eyebrow="결제 안내" title="투명한 4주 단위 선납" />
          <div className="grid gap-6 md:grid-cols-3">
            <Card className="p-7">
              <p className="text-sm font-extrabold text-brand-600">결제 주기</p>
              <p className="mt-3 text-[15px] leading-[1.86] tracking-tight text-ink-soft">
                4주 단위 선납으로 진행됩니다. 결제 예정일 3일 전(D-3)에 안내
                메시지를 보내드립니다.
              </p>
            </Card>
            <Card className="p-7">
              <p className="text-sm font-extrabold text-brand-600">결제 수단</p>
              <p className="mt-3 text-[15px] leading-[1.86] tracking-tight text-ink-soft">
                결제 링크(카드·간편결제) 또는 계좌이체로 결제하실 수
                있습니다. 결제 링크는 담당 선생님이 직접 발송합니다.
              </p>
            </Card>
            <Card className="p-7">
              <p className="text-sm font-extrabold text-brand-600">사전 안내</p>
              <p className="mt-3 text-[15px] leading-[1.86] tracking-tight text-ink-soft">
                자동 결제가 아닌 사전 안내 후 결제 방식으로, 예정 금액과
                기간을 미리 확인하실 수 있습니다.
              </p>
            </Card>
          </div>
        </Container>
      </Section>
    </>
  );
}
