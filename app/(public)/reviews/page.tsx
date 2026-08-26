import type { Metadata } from "next";
import Link from "next/link";
import { resolveTenant } from "@/lib/tenant";
import { getSiteContent } from "@/lib/data/content";
import { Container } from "@/components/public/section";
import { buttonClass } from "@/components/ui/button";
import { ReviewTabs } from "@/components/public/reviews/review-tabs";

export const metadata: Metadata = {
  title: "후기",
  description: "실제로 수업을 들은 학생·학부모가 남긴 후기만 싣습니다.",
  alternates: { canonical: "/reviews" },
  openGraph: {
    title: "후기",
    url: "/reviews",
    description: "실제로 수업을 들은 학생·학부모가 남긴 후기만 싣습니다.",
  },
};

export default async function ReviewsPage() {
  const tenant = await resolveTenant();
  const content = await getSiteContent(tenant.id);

  const reviewCount = content.reviews.length;
  const avgRating =
    reviewCount > 0
      ? content.reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount
      : 0;
  const avgStars = Math.round(avgRating);

  return (
    <>
      <section className="axm-page-hero">
        <Container>
          <h1>후기</h1>
          <p>
            학생과 학부모가 직접 남긴 수업 후기입니다. 과장 없이, 실제로 수업을
            들은 분들의 글만 싣습니다.
          </p>
        </Container>
      </section>

      <section className="axm-section" aria-labelledby="reviews-title">
        <Container>
          <h2 id="reviews-title" className="sr-only">
            후기 목록
          </h2>

          {reviewCount > 0 && (
            <div className="mb-10 flex flex-wrap items-baseline gap-x-6 gap-y-2 border-b border-line-strong pb-6">
              <p className="m-0 flex items-baseline gap-1">
                <span className="text-[clamp(2rem,5vw,2.75rem)] font-extrabold tracking-[-0.04em] text-ink">
                  {avgRating.toFixed(1)}
                </span>
                <span className="text-base font-bold text-faint">/ 5</span>
              </p>
              <p
                className="m-0 text-lg text-brand-600"
                aria-label={`평균 별점 5점 만점에 ${avgRating.toFixed(1)}점`}
              >
                {"★".repeat(avgStars)}
                <span className="text-line">{"★".repeat(5 - avgStars)}</span>
              </p>
              <p className="m-0 text-sm font-bold tracking-[-0.02em] text-faint">
                수강생·학부모 후기 {reviewCount}건
              </p>
            </div>
          )}

          {reviewCount > 0 ? (
            <ReviewTabs reviews={content.reviews} />
          ) : (
            <p className="rounded-[var(--radius-panel)] border border-line bg-soft px-6 py-10 text-center text-sm text-muted">
              공개된 후기가 아직 없습니다.
            </p>
          )}
        </Container>
      </section>

      <section
        className="axm-section axm-section-sunken"
        aria-labelledby="reviews-external-title"
      >
        <Container>
          <div className="flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
            <div>
              <p className="axm-label">외부 후기 채널</p>
              <h2
                id="reviews-external-title"
                className="m-0 text-xl font-extrabold tracking-[-0.03em] text-ink"
              >
                김과외에서 실제 후기 보기
              </h2>
              <p className="mt-2 [font:var(--font-body)] text-muted">
                김과외 플랫폼에 등록된 실제 학생·학부모 후기를 직접 확인하실 수
                있습니다.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a
                href={content.settings.kimReviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass("outline", "md")}
              >
                김과외 후기 보기
              </a>
              <Link href="/apply" className={buttonClass("primary", "md")}>
                상담 신청하기
              </Link>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
