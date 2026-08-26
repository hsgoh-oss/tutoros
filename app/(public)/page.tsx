import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { resolveTenant } from "@/lib/tenant";
import { getSiteContent } from "@/lib/data/content";
import { Container, textLinkClass } from "@/components/public/section";
import { ConsultProcessSummary } from "@/components/public/consult/consult-process";
import { RecruitBanner } from "@/components/public/recruit-banner";
import { DdayBanner } from "@/components/public/dday-banner";
import { buttonClass } from "@/components/ui/button";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://axiommathlab.kr";

export const metadata: Metadata = {
  // 루트 레이아웃 template("%s | AXIOM MATH LAB")이 붙으면 상호가 두 번 나온다.
  title: { absolute: "AXIOM MATH LAB" },
  description:
    "원인 진단 기반 1:1 맞춤 수학 수업. 학생의 현재 상태를 먼저 진단하고, 목표 결과까지 필요한 학습 방향을 설계합니다.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: "/",
    title: "액시엄매스랩",
    description: "원인 진단 기반 1:1 맞춤 수학 수업",
  },
  twitter: {
    card: "summary_large_image",
    title: "액시엄매스랩",
    description: "원인 진단 기반 1:1 맞춤 수학 수업",
  },
};

const teachingSteps = [
  { title: "진단", description: "현재 상태와 문제의 원인을 확인합니다." },
  { title: "교정", description: "개념, 풀이 습관과 오답 원인을 바로잡습니다." },
  { title: "실전", description: "시간 운영과 시험 상황에 적용합니다." },
] as const;

const managementItems = [
  {
    title: "일정·출결",
    description: "예정된 수업 일정과 출결 기록을 확인합니다.",
  },
  {
    title: "학습 기록·과제·피드백",
    description: "수업별 학습 기록과 과제, 피드백을 한 흐름으로 확인합니다.",
  },
  {
    title: "성적 변화·학습 보고",
    description: "평가 결과와 성적 변화, 학습 보고를 확인합니다.",
  },
] as const;

const tutorProof = [
  { term: "실적", value: "김과외 전국 상위 0.2% 이내" },
  { term: "성적 변화", value: "모의고사 수학 4등급 → 수능 수학 1등급" },
  { term: "최근 평가", value: "2026학년도 6월 평가원 모의평가 수학 백분위 99" },
] as const;

// 근거 경로 — 헤더 1등급에서 내렸으므로 본문에서 진입시킨다.
const evidenceLinks = [
  {
    href: "/case",
    title: "성적 향상 사례",
    desc: "검증된 근거와 함께 공개된 사례를 확인합니다.",
  },
  {
    href: "/reviews",
    title: "후기",
    desc: "학생과 학부모가 직접 남긴 수업 후기입니다.",
  },
  {
    href: "/faq",
    title: "자주 묻는 질문",
    desc: "상담과 수업 전 가장 많이 묻는 내용을 정리했습니다.",
  },
  {
    href: "/lesson-policy",
    title: "수업 운영 정책",
    desc: "일정 변경·결석·환불 산정 기준을 공개합니다.",
  },
] as const;

export default async function HomePage() {
  const tenant = await resolveTenant();
  const content = await getSiteContent(tenant.id);

  // 검색·AI 답변에서 "어떤 사업체인지"를 읽을 수 있게 하는 최소 구조화 데이터.
  // 후기 평점은 실제 등록된 후기가 있을 때만 싣는다 — 없는 평점을 지어내지 않는다.
  const reviewCount = content.reviews.length;
  const ratingValue =
    reviewCount > 0
      ? content.reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount
      : null;

  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": ["EducationalOrganization", "LocalBusiness"],
        "@id": `${SITE_URL}/#org`,
        name: tenant.brandName,
        alternateName: content.settings.bizName,
        url: `${SITE_URL}/`,
        image: `${SITE_URL}/img/og-axiom.png`,
        email: content.settings.email,
        description: "원인 진단 기반 1:1 맞춤 수학 수업.",
        address: {
          "@type": "PostalAddress",
          addressCountry: "KR",
          addressRegion: "경기도",
          addressLocality: "수원시 영통구",
        },
        areaServed: ["수도권 일부 지역(대면 수업)", "전국(화상 수업)"],
        priceRange: "₩₩",
        sameAs: [
          content.settings.kakaoUrl,
          content.settings.kimProfileUrl,
          content.settings.instagramUrl,
        ],
        ...(ratingValue !== null
          ? {
              aggregateRating: {
                "@type": "AggregateRating",
                ratingValue: Number(ratingValue.toFixed(1)),
                reviewCount,
                bestRating: 5,
                worstRating: 1,
              },
            }
          : {}),
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: `${SITE_URL}/`,
        name: tenant.brandName,
        alternateName: ["액시엄매스랩", "액시엄 매스랩"],
        inLanguage: "ko",
      },
    ],
  };

  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <RecruitBanner recruit={content.recruit} />
      <DdayBanner ddays={content.ddays} />

      {/*
        히어로는 2열이다. 좌측은 주장과 행동, 우측은 수업 방식 색인.
        스크롤 없이 "왜"와 "어떻게"가 동시에 전달된다.
      */}
      <section
        className="border-b border-line pt-20 pb-16 max-[900px]:pt-12 max-[900px]:pb-10"
        aria-labelledby="home-title"
        data-home-block="01"
      >
        <Container className="grid items-start gap-[clamp(32px,5vw,72px)] min-[901px]:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]">
          <div>
            <p className="mb-4 text-[clamp(1rem,2.2vw,1.25rem)] font-extrabold tracking-[-0.02em] text-brand-600">
              AXIOM <span aria-hidden="true">⊢</span> RESULT{" "}
              <span className="text-faint" aria-hidden="true">
                □
              </span>
            </p>
            <h1
              id="home-title"
              className="m-0 [font:var(--font-display-1)] [letter-spacing:var(--tracking-display)]"
            >
              원인 진단 기반
              <br />
              1:1 맞춤 수학 수업
            </h1>
            <p className="mt-5 max-w-[46ch] [font:var(--font-body-lg)] [letter-spacing:var(--tracking-body)] text-muted">
              학생의 풀이 과정과 학습 상태를 먼저 진단하고, 목표 결과까지 필요한
              학습 순서를 설계합니다.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 max-[640px]:grid max-[640px]:grid-cols-1">
              <Link href="/apply" className={buttonClass("primary", "md")}>
                상담 신청하기
              </Link>
              <Link href="/classes" className={buttonClass("outline", "md")}>
                수업 안내
              </Link>
            </div>
          </div>

          {/* 우측 색인은 규칙선으로 좌측 주장과 분리한다. */}
          <div className="min-[901px]:border-l min-[901px]:border-line min-[901px]:pl-[clamp(20px,3vw,40px)]">
            <p className="axm-eyebrow" aria-hidden="true">
              <b>01</b>METHOD
            </p>
            {/* 아이브로우는 장식이므로 제목 계층은 별도로 세운다. h1 → h2 → h3 유지. */}
            <h2 className="sr-only">수업 방식</h2>
            <ol className="axm-statements">
              {teachingSteps.map((step) => (
                <li key={step.title}>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </li>
              ))}
            </ol>
          </div>
        </Container>
      </section>

      <section
        className="axm-section axm-section-sunken"
        aria-labelledby="tutor-title"
        data-home-block="02"
      >
        <Container>
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <p className="axm-eyebrow">
                <b aria-hidden="true">02</b>TUTOR
              </p>
              <h2 id="tutor-title" className="axm-section-title">
                고현서 튜터
              </h2>
            </div>
            <Link href="/tutor" className={textLinkClass}>
              튜터 소개 자세히 보기 →
            </Link>
          </div>

          {/* 근거 세 줄과 인물 사진은 높이가 다르다. 목록을 사진 높이에 맞춰 늘려
              규칙선이 사진 아래까지 이어지게 한다 — 그러지 않으면 목록 아래로
              300px짜리 빈 칸이 남아 섹션이 끊긴 것처럼 보인다. */}
          <div className="grid items-stretch gap-[clamp(28px,4vw,56px)] min-[901px]:grid-cols-[minmax(0,1fr)_300px]">
            <dl className="m-0 flex h-full flex-col border-t border-line-strong p-0">
              {tutorProof.map((item) => (
                <div
                  key={item.term}
                  className="grid flex-1 content-center gap-4 border-b border-line py-4 min-[901px]:grid-cols-[128px_minmax(0,1fr)] max-[900px]:gap-1"
                >
                  <dt className="m-0 text-[13px] font-extrabold tracking-[-0.01em] text-faint">
                    {item.term}
                  </dt>
                  <dd className="m-0 text-[15px] font-bold leading-[1.6] tracking-[-0.02em] text-ink">
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="max-w-[300px] self-start overflow-hidden rounded-[var(--radius-panel)] border border-line">
              <Image
                src="/img/profile.jpg"
                alt="AXIOM MATH LAB 고현서 튜터"
                width={720}
                height={1080}
                sizes="(max-width: 900px) calc(100vw - 32px), 300px"
                className="block h-auto w-full"
              />
            </div>
          </div>
        </Container>
      </section>

      <section
        className="axm-section"
        aria-labelledby="portal-title"
        data-home-block="03"
      >
        <Container>
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <p className="axm-eyebrow">
                <b aria-hidden="true">03</b>PORTAL
              </p>
              <h2 id="portal-title" className="axm-section-title">
                학습 관리 방식
              </h2>
            </div>
            <Link href="/p" className={textLinkClass}>
              포털 열기 →
            </Link>
          </div>
          <p className="axm-section-lead">
            수업 이후의 기록과 확인까지 포털에서 이어집니다.
          </p>
          <div className="axm-statements">
            {managementItems.map((item) => (
              <article key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </article>
            ))}
          </div>
        </Container>
      </section>

      <section
        className="axm-section axm-section-sunken"
        aria-labelledby="evidence-title"
        data-home-block="04"
      >
        <Container>
          <p className="axm-eyebrow">
            <b aria-hidden="true">04</b>EVIDENCE
          </p>
          <h2 id="evidence-title" className="axm-section-title">
            더 확인할 자료
          </h2>
          <ul className="mt-6 grid list-none border-t border-line-strong p-0 sm:grid-cols-2">
            {evidenceLinks.map((item, i) => (
              <li
                key={item.href}
                className={
                  i % 2 === 0
                    ? "border-b border-line sm:border-r"
                    : "border-b border-line"
                }
              >
                <Link
                  href={item.href}
                  className={`grid min-h-11 gap-1 py-4 pr-6 ${i % 2 === 1 ? "sm:pl-6" : ""} group`}
                >
                  <strong className="text-[15px] font-extrabold tracking-[-0.03em] group-hover:text-brand-600">
                    {item.title}
                  </strong>
                  <span className="text-[13.5px] leading-[1.7] text-muted">
                    {item.desc}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section
        className="on-dark bg-brand-700 py-[var(--section-y)] text-white"
        aria-labelledby="consult-title"
        data-home-block="05"
      >
        <Container>
          <p className="axm-eyebrow">
            <b aria-hidden="true">05</b>CONSULTATION
          </p>
          <h2
            id="consult-title"
            className="m-0 [font:var(--font-display-2)] [letter-spacing:var(--tracking-display)]"
          >
            현재 상태에서 시작하는 상담
          </h2>
          <p className="mt-4 mb-8 max-w-[52ch] [font:var(--font-body-lg)] text-white/82">
            학생의 현재 상태와 목표를 기준으로, 필요한 학습 방향을 함께
            확인합니다.
          </p>
          {/* /apply 는 개인정보 수집 폼이라 noindex 다. 색인에서 빠지는 상담 절차
              설명을 여기에 요약으로 남겨 색인 경로를 유지한다. */}
          <ConsultProcessSummary headingId="consult-process-summary" />
          <Link
            href="/apply"
            className={buttonClass("white", "md", "mt-8")}
          >
            상담 신청하기
          </Link>
        </Container>
      </section>
    </div>
  );
}
