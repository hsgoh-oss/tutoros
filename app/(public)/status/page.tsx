import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { getSiteContent } from "@/lib/data/content";
import { Container } from "@/components/public/section";
import { buttonClass } from "@/components/ui/button";
import { CONSULT_PROGRESS_NOTICE } from "@/components/public/consult/consult-process";

export const metadata: Metadata = {
  title: "상담 신청 후 진행 안내",
  description: "상담 신청 후 진행 사항 확인 방법을 안내합니다.",
  // 접수번호·진행 상태를 다루는 화면이라 색인하지 않는다.
  robots: { index: false, follow: false },
};

export default async function StatusPage() {
  const tenant = await resolveTenant();
  const content = await getSiteContent(tenant.id);

  return (
    <>
      <section className="axm-page-hero">
        <Container>
          <h1>상담 신청 후 진행 안내</h1>
          <p>{CONSULT_PROGRESS_NOTICE}</p>
        </Container>
      </section>

      <section className="axm-section">
        <Container>
          <a
            className={buttonClass("primary", "md")}
            href={content.settings.kakaoUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            카카오톡 문의하기
          </a>
        </Container>
      </section>
    </>
  );
}
