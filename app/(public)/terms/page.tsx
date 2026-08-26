import type { Metadata } from "next";
import {
  LegalDocFrame,
  LegalSection,
  legalSectionId,
} from "@/components/public/legal-doc";
import {
  TERMS_BUSINESS_DETAILS,
  TERMS_DESCRIPTION,
  TERMS_SECTIONS,
  TERMS_TITLE,
} from "@/lib/content/legal";

export const metadata: Metadata = {
  title: "이용약관",
  description: "AXIOM MATH LAB 이용약관입니다.",
  alternates: { canonical: "/terms" },
  openGraph: { title: "이용약관", url: "/terms" },
};

const toc = TERMS_SECTIONS.map(([heading], index) => ({
  id: legalSectionId(index),
  label: heading,
}));

export default function TermsPage() {
  return (
    <LegalDocFrame
      title={TERMS_TITLE}
      description={TERMS_DESCRIPTION}
      toc={toc}
      details={TERMS_BUSINESS_DETAILS}
    >
      {TERMS_SECTIONS.map(([heading, body], index) => (
        <LegalSection
          key={heading}
          id={legalSectionId(index)}
          heading={heading}
          paragraphs={[body]}
        />
      ))}
    </LegalDocFrame>
  );
}
