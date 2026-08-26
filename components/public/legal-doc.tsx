import type { ReactNode } from "react";
import { DocContainer } from "@/components/public/section";
import { POLICY_EFFECTIVE_DATE, POLICY_VERSION } from "@/lib/policy";

// 정본(axiom-platform)의 LegalDocFrame — 시각 위계는
// 제목 → 설명 → 시행일·문서 판 → 목차 → 본문 → 문의처(사업자 정보) 순이다.
// 약관은 읽히려고 있는 문서라서 폭을 68ch로 묶고 카드로 감싸지 않는다.

export interface LegalTocEntry {
  id: string;
  label: string;
}

export function legalSectionId(index: number): string {
  return `legal-sec-${index + 1}`;
}

export function LegalDocFrame({
  title,
  description,
  toc,
  details,
  children,
}: {
  title: string;
  description: string;
  toc: readonly LegalTocEntry[];
  details: readonly string[];
  children: ReactNode;
}) {
  return (
    <article className="axm-section pt-16">
      <DocContainer>
        <h1 className="m-0 [font:var(--font-display-2)] [letter-spacing:var(--tracking-display)]">
          {title}
        </h1>
        <p className="mt-4 [font:var(--font-body-lg)] [letter-spacing:var(--tracking-body)] text-muted">
          {description}
        </p>
        <p className="mt-3 text-[13px] font-bold tracking-[-0.01em] text-faint">
          시행일 {POLICY_EFFECTIVE_DATE} · 문서 버전 {POLICY_VERSION}
        </p>

        <nav
          className="mt-8 border-y border-line py-5"
          aria-label={`${title} 목차`}
        >
          <h2 className="axm-label">목차</h2>
          <ol className="m-0 grid list-none gap-1.5 p-0 sm:grid-cols-2">
            {toc.map((entry) => (
              <li key={entry.id}>
                <a
                  href={`#${entry.id}`}
                  // 모바일에서만 44px 히트영역 — 데스크톱 2열 목차는 조밀함이 장점이다.
                  className="flex items-center py-0.5 text-[13.5px] leading-[1.7] text-muted underline-offset-4 max-sm:min-h-11 hover:text-brand-600 hover:underline"
                >
                  {entry.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="legal-body">{children}</div>

        <section aria-label="사업자 정보" className="mt-10 border-t border-line pt-8">
          <h2 className="m-0 text-[17px] font-extrabold tracking-[-0.03em] text-ink">
            문의처·사업자 정보
          </h2>
          <ul className="mt-4 m-0 grid list-none gap-1.5 p-0 text-[13.5px] leading-[1.8] text-muted">
            {details.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </DocContainer>
    </article>
  );
}

/** 조문 하나 — 제목과 한 개 이상의 문단. */
export function LegalSection({
  id,
  heading,
  paragraphs,
}: {
  id: string;
  heading: string;
  paragraphs: readonly string[];
}) {
  return (
    <section id={id} className="scroll-mt-24 border-b border-line py-7">
      <h2 className="m-0 text-[17px] font-extrabold tracking-[-0.03em] text-ink">
        {heading}
      </h2>
      {paragraphs.map((body, i) => (
        <p key={i} className="mt-3 [font:var(--font-body)] text-muted">
          {body}
        </p>
      ))}
    </section>
  );
}

/** 표 — 처리 항목·보유기간처럼 항목이 열로 대응되는 것만 표로 쓴다. */
export function LegalTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}) {
  return (
    <div className="mt-4 overflow-x-auto rounded-[var(--radius-panel)] border border-line">
      <table className="w-full min-w-[560px] border-collapse bg-white text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                scope="col"
                className="border-b border-line-strong bg-soft px-4 py-3 text-[13px] font-extrabold text-ink-soft"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.join("|")}>
              {row.map((cell, i) => (
                <td
                  key={i}
                  className="border-b border-line px-4 py-3 align-top text-[13.5px] leading-[1.75] text-muted last:border-r-0"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
