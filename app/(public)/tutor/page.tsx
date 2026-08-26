import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/public/section";
import { ProofGallery } from "@/components/public/tutor/proof-gallery";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "튜터 소개",
  description:
    "2026학년도 한양대학교 서울캠퍼스 논술전형 최초합격 (수리논술), 김과외 전국 상위 0.2% 이내 튜터 고현서 — AXIOM MATH LAB 튜터 소개.",
  alternates: { canonical: "/tutor" },
  openGraph: {
    title: "AXIOM MATH LAB 튜터 소개",
    description: "튜터 소개 — 이력과 수업 철학, 지도 분야 안내",
    url: "/tutor",
  },
  twitter: {
    card: "summary_large_image",
    title: "AXIOM MATH LAB 튜터 소개",
    description: "튜터 소개 — 이력과 수업 철학, 지도 분야 안내",
  },
};

const teachingSteps = [
  {
    title: "풀이 과정 진단",
    description:
      "학생의 풀이 과정, 개념 이해도, 오답 원인, 실수 패턴과 시간 운영 방식을 확인합니다.",
  },
  {
    title: "원인별 교정",
    description:
      "오답 원인을 개념, 조건 누락, 접근, 계산, 시간 문제로 나누어 교정합니다.",
  },
  {
    title: "재현 가능한 풀이",
    description:
      "맞은 문제도 우연이나 불필요한 우회가 없는지 확인해 시험에서 재현 가능한 풀이로 정리합니다.",
  },
] as const;

const fields = [
  {
    title: "내신 수학",
    description:
      "학교별 시험 범위와 출제 경향에 맞춰 개념 정리, 유형 훈련, 서술형 대비, 시험 직전 점검까지 진행합니다.",
  },
  {
    title: "수능 수학",
    description:
      "평가원·수능 기출을 중심으로 개념 이해, 문제 접근 방식, 시간 운영, 실수 관리까지 실전 점수 향상에 필요한 흐름을 훈련합니다.",
  },
  {
    title: "수리논술",
    description:
      "대학별 기출과 답안 작성 방식을 바탕으로 논리 전개, 풀이 과정 정리, 서술형 답안 작성 훈련을 진행합니다.",
  },
  {
    title: "약술형 논술",
    description:
      "짧은 시간 안에 핵심 풀이를 정확히 정리할 수 있도록 개념 적용, 답안 구성, 서술 표현을 훈련합니다.",
  },
] as const;

const career = [
  <>
    김과외 전국 <b className="font-extrabold text-ink">상위 0.2% 이내</b> 튜터
  </>,
  <>
    모의고사 수학 4등급 → 독학으로 수능{" "}
    <b className="font-extrabold text-ink">수학 1등급</b>
  </>,
  <>
    2026학년도 6월 평가원 모의평가{" "}
    <b className="font-extrabold text-ink">수학 백분위 99</b>
  </>,
  <>
    2026학년도{" "}
    <b className="font-extrabold text-ink">
      한양대학교 서울캠퍼스 논술전형 최초합격
    </b>{" "}
    (수리논술)
  </>,
];

export default function TutorPage() {
  return (
    <div>
      <section
        className="axm-section pt-16"
        aria-labelledby="tutor-title"
      >
        {/* 사진+증빙 열이 이력 네 줄보다 훨씬 길다. 오른쪽 열을 함께 늘려
            규칙선이 사진 아래까지 이어지게 한다 — 그러지 않으면 이력 아래로
            250px짜리 빈 칸이 남는다. */}
        <Container className="grid items-stretch gap-[clamp(28px,4vw,56px)] min-[901px]:grid-cols-[360px_minmax(0,1fr)]">
          <ProofGallery />

          <div className="flex flex-col">
            <h1
              id="tutor-title"
              className="m-0 [font:var(--font-display-2)] [letter-spacing:var(--tracking-display)]"
            >
              고현서 튜터
            </h1>
            <p className="mt-3 text-[15px] font-bold tracking-[-0.02em] text-brand-600">
              AXIOM MATH LAB(액시엄매스랩)
            </p>
            <ul className="mt-6 flex flex-1 list-none flex-col border-t border-line-strong p-0">
              {career.map((line, i) => (
                <li
                  key={i}
                  className="flex flex-1 items-center border-b border-line py-3.5 text-[15px] leading-[1.7] tracking-[-0.02em] text-muted"
                >
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      <section
        className="axm-section axm-section-sunken"
        aria-labelledby="philosophy-title"
      >
        <Container className="grid items-start gap-[clamp(28px,4vw,56px)] min-[901px]:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div>
            <h2 id="philosophy-title" className="axm-section-title">
              성장 경험과 브랜드 철학
            </h2>
            <p className="mt-5 max-w-[62ch] [font:var(--font-body-lg)] [letter-spacing:var(--tracking-body)] text-muted">
              저 역시 처음부터 수학을 잘했던 학생은 아니었습니다. 여러 번의 수능
              준비를 직접 겪으며 성적이 정체되는 이유와 공부 방향이 잘못되었을
              때의 시행착오를 경험했습니다.
            </p>
            <p className="mt-4 max-w-[62ch] [font:var(--font-body-lg)] [letter-spacing:var(--tracking-body)] text-muted">
              모의고사 수학 4등급에서 공부 방법을 바꾸고 오답 원인을 하나씩
              확인하며 수능 수학 1등급까지 올린 경험은, 지금 수업에서 학생이
              막히는 지점을 진단하는 기준이 되고 있습니다.
            </p>
          </div>

          <div className="rounded-[var(--radius-panel)] border border-line bg-white p-7">
            <p className="m-0 text-[clamp(1rem,2.2vw,1.25rem)] font-extrabold tracking-[-0.02em] text-brand-600">
              AXIOM <span aria-hidden="true">⊢</span> RESULT{" "}
              <span className="text-faint" aria-hidden="true">
                □
              </span>
            </p>
            <p className="mt-4 [font:var(--font-body)] text-muted">
              학생의 현재 상태를 출발점(AXIOM)으로 삼아 논리적인 학습 과정(⊢)을
              거쳐 목표한 결과(RESULT)를 향해 나아가고, 그 과정을 완성해
              간다(<span aria-hidden="true">□</span>)는 의미를 담은 AXIOM MATH
              LAB의 수업 철학입니다.
            </p>
          </div>
        </Container>
      </section>

      <section className="axm-section" aria-labelledby="method-title">
        <Container>
          <h2 id="method-title" className="axm-section-title">
            지도 방식
          </h2>
          <p className="axm-section-lead mt-4">
            학생이 막히는 지점을 먼저 찾고, 원인에 맞는 교정을 실전 적용까지
            연결합니다.
          </p>
          <ol className="axm-statements">
            {teachingSteps.map((step) => (
              <li key={step.title}>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section
        className="axm-section axm-section-sunken"
        aria-labelledby="fields-title"
      >
        <Container>
          <h2 id="fields-title" className="axm-section-title">
            지도 분야
          </h2>
          <p className="axm-section-lead mt-4">
            고등수학, 미적분, 확률과통계를 바탕으로 학생의 목표에 맞는 과정을
            안내합니다.
          </p>
          <div className="grid overflow-hidden rounded-[var(--radius-panel)] border border-line bg-white sm:grid-cols-2">
            {fields.map((field, i) => (
              <article
                key={field.title}
                className={cnCell(i, fields.length)}
              >
                <h3 className="m-0 text-[17px] font-extrabold tracking-[-0.028em] text-ink">
                  {field.title}
                </h3>
                <p className="mt-2.5 [font:var(--font-body)] text-muted">
                  {field.description}
                </p>
              </article>
            ))}
          </div>

          <div className="mt-8 flex flex-col items-start justify-between gap-5 border-t border-line pt-8 md:flex-row md:items-center">
            <div>
              <h2 className="m-0 text-xl font-extrabold tracking-[-0.03em] text-ink">
                상담 안내
              </h2>
              <p className="mt-2 [font:var(--font-body)] text-muted">
                학생의 현재 상태와 목표를 바탕으로, 필요한 학습 방향을 함께
                확인해 보세요.
              </p>
            </div>
            <Link href="/apply" className={buttonClass("primary", "md")}>
              상담 신청하기
            </Link>
          </div>
        </Container>
      </section>
    </div>
  );
}

/**
 * 지도 분야 2열 격자 — 칸을 카드로 띄우지 않고 규칙선으로만 나눈다.
 * 마지막 행은 아래 선을 지워 표가 열린 채 끝나지 않게 한다.
 */
function cnCell(index: number, total: number) {
  const lastRowStart = total - (total % 2 === 0 ? 2 : 1);
  const isLastRow = index >= lastRowStart;
  return [
    "p-7",
    index % 2 === 0 ? "sm:border-r sm:border-line" : "",
    isLastRow ? "" : "border-b border-line",
    // 1열로 접히면 마지막 칸만 아래 선을 지운다.
    index === total - 1 ? "max-sm:border-b-0" : "max-sm:border-b max-sm:border-line",
  ]
    .filter(Boolean)
    .join(" ");
}
