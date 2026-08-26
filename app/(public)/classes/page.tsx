import type { Metadata } from "next";
import Link from "next/link";
import { resolveTenant } from "@/lib/tenant";
import { getSiteContent } from "@/lib/data/content";
import { Container } from "@/components/public/section";
import { ConsultProcessSummary } from "@/components/public/consult/consult-process";
import { RateCalculator } from "@/components/public/classes/rate-calculator";
import { buttonClass } from "@/components/ui/button";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://axiommathlab.kr";

export const metadata: Metadata = {
  title: "수업 안내",
  description:
    "정규수업과 시범수업의 수업료, 결제 방식, 기본 운영 기준 안내. AXIOM MATH LAB 수업 안내.",
  alternates: { canonical: "/classes" },
  openGraph: {
    title: "수업 안내",
    url: "/classes",
    description:
      "정규수업과 시범수업의 수업료, 결제 방식, 기본 운영 기준 안내.",
  },
};

/** 8만 원처럼 읽히는 금액만 "N만 원"으로, 나머지는 그대로 원 단위로 쓴다. */
function won(amount: number) {
  return amount % 10_000 === 0
    ? `${amount / 10_000}만 원`
    : `${amount.toLocaleString("ko-KR")}원`;
}

const commonItems = [
  "현재 상태 진단",
  "맞춤 과제 설계",
  "수업 후 피드백",
  "오답 및 복습 관리",
  "카카오톡 질의응답 지원",
  "학생에게 필요한 자체 제작 자료 제공",
  "공부 방법 및 학습 계획 상담",
  "필요 시 입시·진로 방향 상담",
] as const;

const essayItems = ["답안 작성 훈련", "답안 첨삭"] as const;

function InPersonIcon() {
  return (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" className="h-5 w-5">
      <circle cx="26" cy="26" r="11" stroke="currentColor" strokeWidth="4.5" />
      <path
        d="M10 64c2-16 12-24 16-24s14 8 16 24"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <rect
        x="44"
        y="14"
        width="30"
        height="22"
        rx="6"
        stroke="currentColor"
        strokeWidth="4.5"
      />
      <path
        d="M50 36l6 8 6-8"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinejoin="round"
      />
      <circle cx="54" cy="25" r="2.4" fill="currentColor" />
      <circle cx="59" cy="25" r="2.4" fill="currentColor" />
      <circle cx="64" cy="25" r="2.4" fill="currentColor" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" className="h-5 w-5">
      <rect
        x="12"
        y="16"
        width="56"
        height="38"
        rx="6"
        stroke="currentColor"
        strokeWidth="4.5"
      />
      <path
        d="M30 64h20M40 58v6"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <circle cx="40" cy="35" r="10" stroke="currentColor" strokeWidth="4.5" />
      <path d="M40 28v14M33 35h14" stroke="currentColor" strokeWidth="3" />
      <circle cx="60" cy="20" r="4" fill="currentColor" />
    </svg>
  );
}

export default async function ClassesPage() {
  const tenant = await resolveTenant();
  const content = await getSiteContent(tenant.id);
  const { rates } = content;

  const serviceJsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: `${tenant.brandName} 1:1 수학 과외`,
    serviceType: "1:1 수학 과외 (내신·수능·수리논술·약술형 논술)",
    provider: {
      "@type": "EducationalOrganization",
      name: tenant.brandName,
      url: `${SITE_URL}/`,
    },
    areaServed: ["수도권 일부 지역(대면 수업)", "전국(화상 수업)"],
    url: `${SITE_URL}/classes`,
    // 정규수업료는 고정가가 아니라 최소 시작가이므로 minPrice로 표현한다.
    offers: [
      {
        "@type": "Offer",
        name: "정규수업 대면 (시간당, 최소 시작가)",
        priceSpecification: {
          "@type": "PriceSpecification",
          minPrice: String(rates.inperson),
          priceCurrency: "KRW",
        },
      },
      {
        "@type": "Offer",
        name: "정규수업 화상 (시간당, 최소 시작가)",
        priceSpecification: {
          "@type": "PriceSpecification",
          minPrice: String(rates.video),
          priceCurrency: "KRW",
        },
      },
      {
        "@type": "Offer",
        name: "시범수업 (화상 1시간)",
        price: String(rates.trial),
        priceCurrency: "KRW",
      },
    ],
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "홈", item: `${SITE_URL}/` },
      {
        "@type": "ListItem",
        position: 2,
        name: "수업 안내",
        item: `${SITE_URL}/classes`,
      },
    ],
  };

  const courseJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        name: "내신 수학 1:1 과외",
        description:
          "학교별 시험 범위와 출제 경향에 맞춰 개념 정리, 유형 훈련, 서술형 대비, 시험 직전 점검까지 진행하는 1:1 내신 대비 과정입니다.",
      },
      {
        name: "수능 수학 1:1 과외",
        description:
          "평가원·수능 기출을 중심으로 개념 이해, 문제 접근 방식, 시간 운영, 실수 관리까지 실전 점수 향상에 필요한 흐름을 훈련하는 1:1 수능 대비 과정입니다.",
      },
      {
        name: "수리논술 1:1 과외",
        description:
          "대학별 기출과 답안 작성 방식을 바탕으로 논리 전개, 풀이 과정 정리, 서술형 답안 작성 훈련을 진행하는 1:1 수리논술 과정입니다.",
      },
      {
        name: "약술형 논술 1:1 과외",
        description:
          "짧은 시간 안에 핵심 풀이를 정확히 정리할 수 있도록 개념 적용, 답안 구성, 서술 표현을 훈련하는 1:1 약술형 논술 과정입니다.",
      },
    ].map((course) => ({
      "@type": "Course",
      ...course,
      provider: {
        "@type": "EducationalOrganization",
        name: tenant.brandName,
        url: `${SITE_URL}/`,
      },
      url: `${SITE_URL}/classes`,
      hasCourseInstance: {
        "@type": "CourseInstance",
        courseMode: ["Onsite", "Online"],
      },
    })),
  };

  return (
    <>
      {[serviceJsonLd, breadcrumbJsonLd, courseJsonLd].map((data, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
        />
      ))}

      <section className="axm-page-hero">
        <Container>
          <h1>수업 안내</h1>
          <p>
            정규수업과 시범수업의 수업료, 결제 방식, 기본 운영 기준을
            안내드립니다.
          </p>
        </Container>
      </section>

      <section className="axm-section" aria-labelledby="modes-title">
        <Container>
          <h2 id="modes-title" className="axm-section-title">
            진행 형태
          </h2>
          <div className="mt-6 grid overflow-hidden rounded-[var(--radius-panel)] border border-line bg-white sm:grid-cols-2">
            {[
              {
                icon: <InPersonIcon />,
                title: "대면 수업",
                lines: [
                  "학생의 손풀이와 반응을 확인하고, 종이 풀이와 판서를 통해 풀이 과정을 교정합니다.",
                  "수도권 일부 지역에서 진행하며 세부 가능 지역은 학생 거주지, 수업 요일, 시간대, 이동 가능 범위를 함께 확인한 뒤 안내드립니다.",
                ],
              },
              {
                icon: <VideoIcon />,
                title: "화상 수업",
                lines: [
                  "화면 공유와 온라인 필기로 실시간 풀이를 확인하고, 자료와 과제, 피드백을 연결합니다.",
                  "지역 제한 없이 Google Meet, Zoom 등 실시간 화상 플랫폼을 활용해 진행합니다.",
                ],
              },
            ].map((mode, i) => (
              <article
                key={mode.title}
                className={
                  i === 0
                    ? "p-7 max-sm:border-b max-sm:border-line sm:border-r sm:border-line"
                    : "p-7"
                }
              >
                <span className="mb-5 grid h-10 w-10 place-items-center rounded-[var(--radius-panel)] border border-brand-100 bg-brand-50 text-brand-600">
                  {mode.icon}
                </span>
                <h3 className="m-0 text-[17px] font-extrabold tracking-[-0.028em] text-ink">
                  {mode.title}
                </h3>
                {mode.lines.map((line) => (
                  <p key={line} className="mt-2.5 [font:var(--font-body)] text-muted">
                    {line}
                  </p>
                ))}
              </article>
            ))}
          </div>
        </Container>
      </section>

      <section
        className="axm-section axm-section-sunken"
        aria-labelledby="tuition-title"
      >
        <Container>
          <h2 id="tuition-title" className="axm-section-title">
            정규수업료
          </h2>
          <p className="axm-section-lead mt-4 max-w-[76ch]">
            고등 내신 수학 · 수능 수학 기준의 정규수업료입니다.
            <br />
            수업료 결제는 4주 단위 사전 결제로 진행됩니다. 회당 수업 시간은 최소
            2시간이며 주당 수업 횟수는 상담 후 확정됩니다.
          </p>

          <div
            className="grid overflow-hidden rounded-[var(--radius-panel)] border border-line bg-white sm:grid-cols-2"
            aria-label="정규수업료 비교"
          >
            {[
              { label: "대면 수업", area: "수도권 일부 지역", rate: rates.inperson },
              { label: "화상 수업", area: "지역 제한 없음", rate: rates.video },
            ].map((option, i) => (
              <article
                key={option.label}
                className={
                  i === 0
                    ? "min-w-0 p-7 max-sm:border-b max-sm:border-line sm:border-r sm:border-line"
                    : "min-w-0 p-7"
                }
              >
                <p className="m-0 mb-4 text-sm font-extrabold text-brand-600">
                  {option.label}
                </p>
                <h3 className="m-0 text-[21px] font-extrabold tracking-[-0.025em] text-ink">
                  1:1 맞춤 수업
                </h3>
                <p className="mt-1.5 text-sm text-faint">{option.area}</p>
                <strong className="mt-6 block border-t border-line pt-5 text-[clamp(18px,2vw,22px)] font-extrabold tracking-[-0.025em] text-ink">
                  시간당 {won(option.rate)}부터
                </strong>
              </article>
            ))}
          </div>

          <p className="mt-5 [font:var(--font-body)] text-ink-soft">
            학년, 현재 수준과 수업 구성에 따라 수업료가 달라질 수 있으며, 상담 후
            정확하게 안내드립니다.
          </p>
          <p className="mt-2 [font:var(--font-body)] text-muted">
            수리논술 · 약술형 논술은 목표 대학, 현재 수준, 준비 기간, 첨삭 비중에
            따라 수업 구성이 달라질 수 있으므로 상담을 통해 안내드립니다.
          </p>

          <div className="mt-8">
            <RateCalculator rates={rates} />
          </div>

          <h2 className="axm-section-title mt-14">수업 제공 항목</h2>
          {/* items-start — 오른쪽 묶음은 두 줄뿐이라 높이를 맞추면 200px짜리 빈 상자가 된다.
              칸은 내용만큼만 차지한다. */}
          <div className="mt-6 grid items-start gap-5 min-[901px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            {[
              { title: "공통 제공 항목", items: commonItems },
              { title: "수리논술 · 약술형 논술 추가 포함 항목", items: essayItems },
            ].map((group) => (
              <section
                key={group.title}
                className="rounded-[var(--radius-panel)] border border-line bg-white p-7"
              >
                <h3 className="m-0 mb-4.5 border-b border-line pb-4.5 text-[17px] leading-[1.5] font-extrabold tracking-[-0.025em] text-ink">
                  {group.title}
                </h3>
                <ul className="m-0 grid list-none gap-3.5 p-0">
                  {group.items.map((item) => (
                    <li
                      key={item}
                      className="relative pl-4 text-[15px] leading-[1.55] font-bold text-ink-soft before:absolute before:top-[0.68em] before:left-0 before:h-[5px] before:w-[5px] before:rounded-full before:bg-brand-600 before:content-['']"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <p className="mt-8 text-[13.5px] leading-[1.8] text-faint">
            ※ 표시된 수업료는 부가세가 추가되지 않는 최종 금액입니다.
            <br />※ 교재비는 수업료에 포함되지 않습니다.
            <br />※ 수업 일정 변경, 결석, 보강, 환불 기준은 수업 운영 정책에
            따릅니다.
          </p>
        </Container>
      </section>

      <section className="axm-section" aria-labelledby="trial-title">
        <Container>
          <h2 id="trial-title" className="axm-section-title">
            시범수업 안내
          </h2>
          <p className="axm-section-lead mt-4 max-w-[76ch]">
            시범수업은 상담과 시범수업을 합한 화상 1시간 단일 상품으로, 정규수업
            시작 전 학생의 실력을 1:1로 점검하는 진단 과정입니다.
            <br />
            단순한 체험 수업이 아니라, 실제 문제 풀이를 통해 학생의 개념 이해도,
            문제 접근 방식, 오답 패턴과 실수 습관을 구체적으로 파악하는 진단
            수업입니다.
            <br />
            진단 결과를 바탕으로 현재 보완해야 할 부분과 학생의 목표에 맞는 학습
            방향을 함께 점검합니다.
          </p>

          <div
            className="grid overflow-hidden rounded-[var(--radius-panel)] border border-line bg-white sm:grid-cols-3"
            aria-label={`시범수업료: 화상 1시간, ${won(rates.trial)}`}
          >
            <div className="p-5.5 text-[15px] font-bold text-ink-soft max-sm:border-b max-sm:border-line sm:border-r sm:border-line">
              시범수업료
            </div>
            <div className="p-5.5 text-[15px] font-bold text-ink-soft max-sm:border-b max-sm:border-line sm:border-r sm:border-line">
              화상 1시간
            </div>
            <div className="p-5.5 text-xl font-extrabold text-brand-600">
              {won(rates.trial)}
            </div>
          </div>

          <p className="mt-6 [font:var(--font-body)] text-muted">
            시범수업은 화상 수업으로 진행됩니다.
            <br />
            시범수업은 정규수업과 독립적으로 운영되는 별도 진단 과정입니다.
          </p>
          <p className="mt-4 [font:var(--font-body)] font-bold text-ink">
            시범수업 신청도 상담 신청서를 통해 접수됩니다.
            <br />
            상담 과정에서 시범수업 진행 여부와 일정을 함께 안내드립니다.
          </p>
          <p className="mt-4 text-[13.5px] leading-[1.8] text-faint">
            시범수업은 일정 조율 및 결제 완료 후 확정됩니다.
            <br />
            확정 이후 이용자 사유로 인한 일정 변경, 취소 및 환불은 수업 운영 정책
            기준에 따라 처리됩니다.
            <br />※ 표시된 시범수업료는 부가세가 추가되지 않는 최종 금액입니다.
            <br />※ 시범수업료는 정규수업료에서 차감되지 않습니다.
          </p>
        </Container>
      </section>

      <section
        className="axm-section axm-section-sunken"
        aria-labelledby="payment-title"
      >
        <Container>
          <h2 id="payment-title" className="axm-section-title">
            결제 방식
          </h2>
          <div className="mt-6 rounded-[var(--radius-panel)] border border-line bg-white p-7">
            <p className="[font:var(--font-body)] text-muted">
              결제는 계좌이체와 카드 결제 모두 가능합니다.
              <br />
              계좌이체 결제 시 현금영수증을 발급해드립니다.
              <br />
              카드 결제는 별도 결제 링크를 통해 진행되며, 결제 시스템에서 결제
              내역을 확인하실 수 있습니다.
              <br />
              수업 일정은 상담 및 결제 확인 후 최종 확정됩니다.
            </p>
            <p className="mt-6 [font:var(--font-body)] text-muted">
              자세한 상담을 원하시는 경우 상담 신청하기 버튼을 통해 신청서를
              작성해 주세요.
              <br />
              가능 지역, 일정, 수업 방식 등 간단한 문의는 카카오톡 문의하기 버튼을
              통해 확인하실 수 있습니다.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/apply" className={buttonClass("primary", "md")}>
                상담 신청하기
              </Link>
              <Link
                href="/lesson-policy"
                className={buttonClass("outline", "md")}
              >
                수업 운영 정책
              </Link>
            </div>
          </div>
        </Container>
      </section>

      {/* /apply 통합으로 색인에서 빠지는 상담 절차를 여기에도 요약으로 남긴다.
          수업 조건을 확인한 사람이 곧바로 다음 단계를 알 수 있어야 한다. */}
      <section className="axm-section" aria-labelledby="classes-consult-process">
        <Container>
          <ConsultProcessSummary headingId="classes-consult-process" />
        </Container>
      </section>
    </>
  );
}
