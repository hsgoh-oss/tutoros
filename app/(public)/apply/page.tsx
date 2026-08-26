import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { getSiteContent } from "@/lib/data/content";
import { Container } from "@/components/public/section";
import { buttonClass } from "@/components/ui/button";
import { ConsultForm } from "@/components/public/consult/consult-form";
import {
  ConsultProcess,
  CONSULT_PROCESS_ID,
} from "@/components/public/consult/consult-process";
import { FaqExplorer } from "@/components/public/faq/faq-explorer";

export const metadata: Metadata = {
  title: "상담 신청서",
  description:
    "AXIOM MATH LAB 상담 신청서 — 현재 성적, 학습 목표, 희망 수업 방식을 남겨 주시면 확인 후 안내드립니다.",
  alternates: { canonical: "/apply" },
  // 개인정보 수집 폼이라 색인하지 않는다. 색인되던 상담 절차 설명은 홈 05 블록과
  // /classes 하단의 요약이 대신한다(components/public/consult/consult-process.tsx).
  robots: { index: false, follow: false },
};

export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<{
    mode?: string;
    hours?: string;
    freq?: string;
    waitlist?: string;
  }>;
}) {
  const [tenant, sp] = await Promise.all([resolveTenant(), searchParams]);
  const content = await getSiteContent(tenant.id);

  // O-04 정본 "공개 상태 = 실제 접수 가능 상태": 접수 중단(closed)이면 폼 대신 마감 안내를 보여준다.
  // 배너 노출 여부(isBannerVisible)와 무관하게 상태 자체가 접수 가능 여부를 결정한다.
  // 서버 액션(submitConsult)도 같은 기준으로 거부하므로 화면 우회로는 접수되지 않는다.
  // 대기명단 실동작(정원 산정·자리 제안)은 M2 몫 — 여기서는 안내만 한다.
  const isRecruitClosed = content.recruit.status === "closed";
  const waitlistRequested = sp.waitlist === "1" || isRecruitClosed;

  return (
    <>
      <section className="axm-page-hero">
        <Container>
          <h1>{waitlistRequested ? "대기 상담 신청서" : "상담 신청서"}</h1>
          <p>
            {waitlistRequested
              ? "정규수업 자리가 나면 순서대로 안내할 수 있도록 상담 정보를 남겨 주세요."
              : "아래 신청서를 작성해 주시면 확인 후 순차적으로 안내드립니다."}
          </p>
        </Container>
      </section>

      <section className="axm-section" id="consult-form">
        <Container>
          <h2 className="sr-only">상담 신청서</h2>
          {/* 폼을 마주한 사람이 절차를 확인하러 갈 경로. 접기식이 아니라 같은
              화면 아래에 펼쳐져 있으므로 스크롤 앵커만 제공한다. */}
          <p className="mb-4">
            <a
              href={`#${CONSULT_PROCESS_ID}`}
              className="inline-flex min-h-11 items-center text-sm font-extrabold tracking-[-0.02em] text-brand-600 underline-offset-4 hover:underline"
            >
              상담 절차 보기 ↓
            </a>
          </p>

          {isRecruitClosed ? (
            <div
              role="status"
              className="max-w-[62ch] rounded-[var(--radius-panel)] border border-line bg-soft p-8"
            >
              <p className="axm-label">접수 안내</p>
              <h3 className="m-0 text-[22px] font-extrabold tracking-[-0.035em] text-ink">
                현재 모집이 마감되었습니다
              </h3>
              <p className="mt-4 [font:var(--font-body)] text-muted">
                지금은 신규 상담 접수를 받지 않습니다. 대기 신청은 준비 중이며,
                모집이 재개되면 이 페이지에서 다시 신청하실 수 있습니다. 모집
                재개 안내가 필요하시면 카카오톡으로 문의해 주세요.
              </p>
              <a
                href={content.settings.kakaoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass("primary", "md", "mt-6")}
              >
                카카오톡 문의
              </a>
            </div>
          ) : (
            <>
              <p className="mb-7 max-w-[76ch] [font:var(--font-body)] text-muted">
                아래 신청서를 작성하면 내용을 확인한 뒤 순차적으로 상담을
                안내드립니다. 신청만으로 시범수업·정규수업 일정이나 등록이
                확정되지는 않습니다.
              </p>
              <ConsultForm
                initialMode={sp.mode}
                initialHours={sp.hours}
                initialFreq={sp.freq}
                kakaoUrl={content.settings.kakaoUrl}
              />
            </>
          )}
        </Container>
      </section>

      {/* 폼 아래 상담 절차, 그 아래 FAQ — 두 단계가 한 화면으로 줄어든다. */}
      <ConsultProcess />

      <section
        className="axm-section axm-section-sunken"
        id="faq"
        aria-labelledby="apply-faq-title"
      >
        <Container>
          <h2 id="apply-faq-title" className="axm-section-title">
            자주 묻는 질문
          </h2>
          <p className="axm-section-lead mt-4">
            상담, 수업, 결제·환불에 관한 내용을 한곳에서 확인할 수 있습니다.
          </p>
          <FaqExplorer faqs={content.faqs} />
        </Container>
      </section>
    </>
  );
}
