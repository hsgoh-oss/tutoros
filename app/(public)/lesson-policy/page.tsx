import type { Metadata } from "next";
import {
  LegalDocFrame,
  LegalSection,
  legalSectionId,
} from "@/components/public/legal-doc";
import {
  LESSON_POLICY_BUSINESS_DETAILS,
  LESSON_POLICY_DESCRIPTION,
  LESSON_POLICY_SECTIONS,
  LESSON_POLICY_TITLE,
} from "@/lib/content/legal";

export const metadata: Metadata = {
  title: "수업 운영 정책",
  description:
    "AXIOM MATH LAB 수업 운영 정책 — 계약·결제 흐름, 일정 변경, 지각·노쇼, 환불 산정 기준 안내.",
  alternates: { canonical: "/lesson-policy" },
  openGraph: { title: "수업 운영 정책", url: "/lesson-policy" },
};

const toc = LESSON_POLICY_SECTIONS.map(([heading], index) => ({
  id: legalSectionId(index),
  label: heading,
}));

export default function LessonPolicyPage() {
  return (
    <LegalDocFrame
      title={LESSON_POLICY_TITLE}
      description={LESSON_POLICY_DESCRIPTION}
      toc={toc}
      details={LESSON_POLICY_BUSINESS_DETAILS}
    >
      {LESSON_POLICY_SECTIONS.map(([heading, body], index) => (
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
