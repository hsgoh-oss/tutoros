import Link from "next/link";
import { Container } from "@/components/public/section";
import { buttonClass } from "@/components/ui/button";

export function CtaBand() {
  return (
    <section className="bg-brand-600 py-20 md:py-24">
      <Container className="flex flex-col items-center gap-6 text-center">
        <h2 className="text-[26px] font-black leading-[1.3] tracking-[-0.03em] text-white md:text-[36px]">
          지금, 원인을 진단할 시간입니다
        </h2>
        <p className="max-w-lg text-[17px] leading-[1.8] tracking-tight text-white/80">
          상담은 무료이며, 등록을 강요하지 않습니다. 편하게 문의해 주세요.
        </p>
        <Link href="/consult" className={buttonClass("white", "lg")}>
          상담 신청하기
        </Link>
      </Container>
    </section>
  );
}
