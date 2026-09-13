import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { getInvitationByTokenHash } from "@/lib/data/reviews";
import { hashReviewToken } from "@/lib/review/token";
import { screenshotViewsFor } from "@/app/admin/(protected)/reviews/storage";
import { ReviewSubmitForm } from "@/components/public/review-submit/review-submit-form";
import { ReviewSubmitNotice } from "@/components/public/review-submit/notice";

// 후기·성적 향상 사례 작성 화면(공개) — S-01 「작성 초대 발급 → 전달 → 작성자 제출」.
//
// 링크(토큰)가 곧 접근 수단이다: 운영자가 학생 상세·후기 관리에서 초대를 발급해 알림톡으로 보내고,
// 작성자는 그 링크로 들어와 쓴다. 원문 토큰은 DB에 없고 해시만 대조한다(lib/review/token.ts).
//
// 열리는 조건은 하나뿐이다 — status='sent'이고 기한 전(lib/data/reviews.ts의 isOpen).
// 닫힘·만료·이미 제출·없는 토큰·다른 테넌트는 사유를 구분하지 않고 같은 안내로 수렴한다(존재 비노출).
//
// 색인 금지: 링크 자체가 접근 수단이라 검색엔진에 경로를 남기지 않는다. robots.ts의 "/w"와 함께 둔다.
export const metadata: Metadata = {
  title: "후기·사례 작성",
  robots: { index: false, follow: false },
};

export default async function ReviewSubmitPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const tenant = await resolveTenant();

  // 토큰은 해시해서만 조회한다. 못 찾아도 이유를 만들지 않는다(null 하나로 수렴).
  const invitation = token
    ? await getInvitationByTokenHash(tenant.id, hashReviewToken(token))
    : null;

  if (!invitation || !invitation.isOpen) {
    return <ReviewSubmitNotice brandName={tenant.brandName} />;
  }

  // 수정 요청 재발급이면 기존 본과 증빙(만료 서명 URL)을 채워 준다 — 작성자는 자기 글만 본다.
  const existing = invitation.review;
  const existingImages = existing ? await screenshotViewsFor(existing.screenshots) : [];

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-12 md:py-16">
      <p className="mb-4 text-xs font-extrabold tracking-tight text-brand-600">
        {tenant.brandName}
      </p>
      <ReviewSubmitForm
        token={token}
        invitation={{
          studentName: invitation.studentName,
          authorRole: invitation.authorRole,
          authorName: invitation.authorName,
        }}
        existing={
          existing
            ? {
                kind: existing.kind,
                grade: existing.grade,
                track: existing.track,
                rating: existing.rating,
                content: existing.content,
                beforeLabel: existing.beforeLabel,
                beforeGrade: existing.beforeGrade,
                afterLabel: existing.afterLabel,
                afterGrade: existing.afterGrade,
                guardianName: existing.guardianName,
                guardianPhone: existing.guardianPhone,
                revisionNote: existing.revisionNote,
                images: existingImages,
              }
            : null
        }
      />
    </main>
  );
}
