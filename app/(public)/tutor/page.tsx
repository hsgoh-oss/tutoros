import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import {
  Container,
  Section,
  SectionHeading,
} from "@/components/public/section";
import { Timeline } from "@/components/public/tutor/timeline";
import { ProofGallery } from "@/components/public/tutor/proof-gallery";

export const metadata: Metadata = {
  title: "튜터 소개",
  description:
    "한양대 수리논술 최초합격, 김과외 전국 상위 0.2% 튜터 고현서 선생님을 소개합니다.",
  alternates: { canonical: "/tutor" },
  openGraph: {
    title: "튜터 소개",
    url: "/tutor",
  },
};

const CREDENTIALS = [
  "한양대학교 서울캠퍼스 재학",
  "수능 수학 1등급",
  "한양대 수리논술 최초합격",
  "김과외 전국 상위 0.2%",
] as const;

const PHILOSOPHY = [
  {
    title: "원인 진단",
    desc: "성적이 안 오르는 이유를 먼저 찾습니다. 개념 이해 부족인지, 문제 적용력 부족인지 정확히 진단합니다.",
  },
  {
    title: "맞춤 설계",
    desc: "진단 결과를 바탕으로 학생에게 맞는 커리큘럼과 진도를 설계합니다.",
  },
  {
    title: "투명한 리포트 소통",
    desc: "매 수업 후 리포트를 보내드려, 묻지 않아도 진행 상황을 정확히 아실 수 있습니다.",
  },
] as const;

export default function TutorPage() {
  return (
    <>
      <Section>
        <Container className="flex flex-col items-center gap-8 text-center md:flex-row md:items-center md:gap-12 md:text-left">
          <div className="relative w-full max-w-[240px] shrink-0 md:max-w-[280px]">
            <div
              aria-hidden
              className="absolute -top-4 -left-4 h-full w-full rounded-card bg-brand-50"
            />
            <Image
              src="/img/profile.jpg"
              alt="AXIOM MATH LAB 고현서 선생님"
              width={560}
              height={840}
              priority
              className="relative rounded-card object-cover shadow-soft"
            />
          </div>

          <div>
            <p className="text-sm font-extrabold tracking-tight text-brand-600">
              튜터 소개
            </p>
            <h1 className="mt-3 text-[32px] font-black leading-[1.25] tracking-[-0.04em] text-ink md:text-[44px]">
              고현서 선생님
            </h1>
            <p className="mx-auto mt-4 max-w-md text-[17px] leading-[1.86] tracking-tight text-muted md:mx-0">
              감이 아니라 근거로 가르칩니다. 왜 틀렸는지 증명할 수 있어야,
              다시 틀리지 않습니다.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2 md:justify-start">
              {CREDENTIALS.map((credential) => (
                <Badge key={credential}>{credential}</Badge>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      <Section className="bg-soft">
        <Container>
          <SectionHeading
            eyebrow="성장 과정"
            title="증명으로 쌓아온 실력"
          />
          <Timeline />
        </Container>
      </Section>

      <Section>
        <Container>
          <SectionHeading
            eyebrow="증빙 자료"
            title="숫자와 기록으로 보여드립니다"
          />
          <ProofGallery />
        </Container>
      </Section>

      <Section className="bg-soft">
        <Container>
          <SectionHeading eyebrow="수업 철학" title="가르치는 세 가지 원칙" />
          <div className="grid gap-6 md:grid-cols-3">
            {PHILOSOPHY.map((item, i) => (
              <div
                key={item.title}
                className="rounded-card border border-line bg-white p-7 shadow-card"
              >
                <p className="text-3xl font-black tracking-tight text-brand-200">
                  {`0${i + 1}`}
                </p>
                <h3 className="mt-3 text-lg font-black tracking-tight text-ink">
                  {item.title}
                </h3>
                <p className="mt-2 text-[15px] leading-[1.75] tracking-tight text-muted">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <section className="bg-brand-600 py-20 md:py-24">
        <Container className="flex flex-col items-center gap-6 text-center">
          <h2 className="text-[26px] font-black leading-[1.3] tracking-[-0.03em] text-white md:text-[36px]">
            직접 상담해 보시면 압니다
          </h2>
          <Link href="/consult" className={buttonClass("white", "lg")}>
            상담 신청하기
          </Link>
        </Container>
      </section>
    </>
  );
}
