import type { Metadata } from "next";
import {
  LegalDocFrame,
  LegalSection,
  LegalTable,
} from "@/components/public/legal-doc";
import {
  PRIVACY_BUSINESS_DETAILS,
  PRIVACY_DESCRIPTION,
  PRIVACY_INTRO_NOTE,
  PRIVACY_PROCESSING_ROWS,
  PRIVACY_RETENTION_ROWS,
  PRIVACY_RETENTION_TITLE,
  PRIVACY_SECTIONS_AFTER_RETENTION,
  PRIVACY_SECTIONS_BEFORE_RETENTION,
  PRIVACY_TITLE,
} from "@/lib/content/legal";

export const metadata: Metadata = {
  title: "개인정보 처리방침",
  description:
    "개인정보의 처리 목적·항목·보유기간과 정보주체의 권리를 안내합니다.",
  alternates: { canonical: "/privacy" },
  openGraph: { title: "개인정보 처리방침", url: "/privacy" },
};

// 렌더 순서는 정본 주석이 고정한다: 1(처리 목적과 항목 표) → 2~5 → 6(보유기간 표) → 7~14.
const PROCESSING_TITLE = "1. 처리 목적과 항목";
const PROCESSING_ID = "privacy-processing";
const RETENTION_ID = "privacy-retention";

function sectionId(prefix: string, index: number) {
  return `privacy-${prefix}-${index + 1}`;
}

const toc = [
  { id: PROCESSING_ID, label: PROCESSING_TITLE },
  ...PRIVACY_SECTIONS_BEFORE_RETENTION.map(([heading], index) => ({
    id: sectionId("a", index),
    label: heading,
  })),
  { id: RETENTION_ID, label: PRIVACY_RETENTION_TITLE },
  ...PRIVACY_SECTIONS_AFTER_RETENTION.map(([heading], index) => ({
    id: sectionId("b", index),
    label: heading,
  })),
];

export default function PrivacyPage() {
  return (
    <LegalDocFrame
      title={PRIVACY_TITLE}
      description={PRIVACY_DESCRIPTION}
      toc={toc}
      details={PRIVACY_BUSINESS_DETAILS}
    >
      <section id={PROCESSING_ID} className="scroll-mt-24 border-b border-line py-7">
        <h2 className="m-0 text-[17px] font-extrabold tracking-[-0.03em] text-ink">
          {PROCESSING_TITLE}
        </h2>
        <p className="mt-3 [font:var(--font-body)] text-muted">
          {PRIVACY_INTRO_NOTE}
        </p>
        <LegalTable
          caption="처리 목적과 항목"
          headers={["구분", "목적", "항목"]}
          rows={PRIVACY_PROCESSING_ROWS}
        />
      </section>

      {PRIVACY_SECTIONS_BEFORE_RETENTION.map(([heading, paragraphs], index) => (
        <LegalSection
          key={heading}
          id={sectionId("a", index)}
          heading={heading}
          paragraphs={paragraphs}
        />
      ))}

      <section id={RETENTION_ID} className="scroll-mt-24 border-b border-line py-7">
        <h2 className="m-0 text-[17px] font-extrabold tracking-[-0.03em] text-ink">
          {PRIVACY_RETENTION_TITLE}
        </h2>
        <LegalTable
          caption="보유기간"
          headers={["대상", "보유기간"]}
          rows={PRIVACY_RETENTION_ROWS}
        />
      </section>

      {PRIVACY_SECTIONS_AFTER_RETENTION.map(([heading, paragraphs], index) => (
        <LegalSection
          key={heading}
          id={sectionId("b", index)}
          heading={heading}
          paragraphs={paragraphs}
        />
      ))}
    </LegalDocFrame>
  );
}
