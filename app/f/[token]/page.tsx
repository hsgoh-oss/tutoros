import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { getFormByTokenHash } from "@/lib/data/intake";
import { hashIntakeToken } from "@/lib/intake/token";
import { IntakeForm } from "@/components/public/intake/intake-form";
import { IntakeNotice } from "@/components/public/intake/notice";

// 공개 신청폼 작성 화면 — T-01(시범수업 신청폼)·R-01(정규수업 신청폼).
//
// 링크(토큰)가 곧 접근 수단이다: 운영자가 상담 결과에 맞는 폼을 발급해 문자로 보내고,
// 신청자는 그 링크로 들어와 작성한다. 원문 토큰은 DB에 없고 해시만 대조한다(lib/intake/token.ts).
//
// 열리는 조건은 하나뿐이다 — status='sent'이고 기한 전(lib/data/intake.ts의 isOpen).
// 닫힘(결과 변경·상담 종결·재발급)·만료·이미 제출·없는 토큰·다른 테넌트는 사유를 구분하지 않고
// 같은 안내로 수렴한다(존재 비노출). 상담 상세를 URL로 넘겨받지 않으므로 토큰 하나가 전부다.
//
// 색인 금지: 링크 자체가 접근 수단이라 검색엔진에 경로를 남기지 않는다. robots.txt의 Disallow는
// 크롤 차단일 뿐 색인 차단이 아니라서 meta robots(아래)와 app/robots.ts의 "/f"를 함께 둔다.
// (/p 레이아웃과 같은 규율 — app/p/layout.tsx)
export const metadata: Metadata = {
  title: "신청서 작성",
  robots: { index: false, follow: false },
};

export default async function IntakeFormPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const tenant = await resolveTenant();

  // 토큰은 해시해서만 조회한다. 못 찾아도 이유를 만들지 않는다(null 하나로 수렴).
  const form = token ? await getFormByTokenHash(tenant.id, hashIntakeToken(token)) : null;

  if (!form || !form.isOpen) {
    return <IntakeNotice brandName={tenant.brandName} />;
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-12 md:py-16">
      <p className="mb-4 text-xs font-extrabold tracking-tight text-brand-600">
        {tenant.brandName}
      </p>
      <IntakeForm
        token={token}
        kind={form.kind}
        // 상담에 남은 접수자 이름만 인사말로 쓴다 — 연락처 등 나머지 상담 정보는 화면에 되돌리지 않는다.
        recipientName={form.consultationName}
      />
    </main>
  );
}
