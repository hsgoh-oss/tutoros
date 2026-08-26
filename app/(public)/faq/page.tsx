import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { getSiteContent } from "@/lib/data/content";
import { Container } from "@/components/public/section";
import { FaqExplorer } from "@/components/public/faq/faq-explorer";

export const metadata: Metadata = {
  title: "자주 묻는 질문",
  description: "상담과 수업 전 자주 묻는 질문을 확인하세요.",
  alternates: { canonical: "/faq" },
  openGraph: {
    title: "자주 묻는 질문",
    url: "/faq",
    description: "상담과 수업 전 자주 묻는 질문을 확인하세요.",
  },
};

export default async function FaqPage() {
  const tenant = await resolveTenant();
  const content = await getSiteContent(tenant.id);

  const faqJsonLd =
    content.faqs.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: content.faqs.map((f) => ({
            "@type": "Question",
            name: f.question,
            acceptedAnswer: { "@type": "Answer", text: f.answer },
          })),
        }
      : null;

  return (
    <>
      {faqJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c"),
          }}
        />
      )}

      <section className="axm-page-hero">
        <Container>
          <h1>자주 묻는 질문</h1>
          <p>
            상담 전 가장 많이 문의 주시는 내용을 정리했습니다.
            <br />
            원하는 답을 찾지 못하셨다면 카카오톡으로 편하게 문의해 주세요.
          </p>
        </Container>
      </section>

      <section className="axm-section">
        <Container>
          <FaqExplorer faqs={content.faqs} />
        </Container>
      </section>
    </>
  );
}
