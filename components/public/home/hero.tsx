import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Container, Section } from "@/components/public/section";

export function Hero({ badges }: { badges: string[] }) {
  return (
    <Section>
      <Container className="grid items-center gap-12 md:grid-cols-[1.1fr_0.9fr] md:gap-10">
        <div>
          <div className="mb-6 flex flex-wrap gap-2">
            {badges.map((badge) => (
              <Badge key={badge}>{badge}</Badge>
            ))}
          </div>

          <h1 className="text-[34px] font-black leading-[1.22] tracking-[-0.04em] text-ink md:text-[52px]">
            성적이 오르는 데는,
            <br />
            분명한 이유가 있습니다
          </h1>

          <p className="mt-6 max-w-md text-[17px] leading-[1.86] tracking-tight text-muted">
            감으로 가르치지 않습니다. 원인을 정확히 진단하고, 근거로 증명하는
            수업을 합니다.
          </p>

          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/consult" className={buttonClass("primary", "lg")}>
              무료 상담 신청
            </Link>
            <Link href="/classes" className={buttonClass("outline", "lg")}>
              수업 안내 보기
            </Link>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[300px] md:mx-0 md:ml-auto md:max-w-[360px]">
          <div
            aria-hidden
            className="absolute -top-4 -right-4 h-full w-full rounded-card bg-brand-50 md:-top-6 md:-right-6"
          />
          <Image
            src="/img/profile.jpg"
            alt="AXIOM MATH LAB 고현서 선생님"
            width={720}
            height={1080}
            priority
            fetchPriority="high"
            sizes="(max-width: 767px) 88vw, 720px"
            className="relative rounded-card object-cover shadow-soft"
          />
        </div>
      </Container>
    </Section>
  );
}
