import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { getSiteContent } from "@/lib/data/content";
import { Container, Section, SectionHeading } from "@/components/public/section";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { ReviewTabs } from "@/components/public/reviews/review-tabs";

export const metadata: Metadata = { title: "수강 후기" };

export default async function ReviewsPage() {
  const tenant = await resolveTenant();
  const content = await getSiteContent(tenant.id);
  const gradeChanges = content.reviews.filter((r) => r.beforeGrade && r.afterGrade);
  const reviewCount = content.reviews.length;
  const avgRating =
    reviewCount > 0
      ? content.reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount
      : 0;
  const avgStars = Math.round(avgRating);

  return (
    <>
      <Section className="pt-14 md:pt-20">
        <Container>
          <SectionHeading
            as="h1"
            eyebrow="수강 후기"
            title="학생·학부모가 남긴 실제 이야기"
            desc="과장 없이, 실제로 수업을 들은 학생과 학부모의 후기만 싣습니다."
          />

          {reviewCount > 0 && (
            <div className="mb-14 flex flex-col items-center gap-4 rounded-card border border-line bg-soft px-6 py-8 text-center sm:flex-row sm:justify-center sm:gap-8 sm:text-left">
              <div className="flex items-baseline gap-1">
                <span className="text-5xl font-black tracking-[-0.03em] text-ink md:text-6xl">
                  {avgRating.toFixed(1)}
                </span>
                <span className="text-lg font-bold text-muted">/ 5</span>
              </div>
              <div>
                <p
                  className="text-xl text-brand-600"
                  aria-label={`평균 별점 5점 만점에 ${avgRating.toFixed(1)}점`}
                >
                  {"★".repeat(avgStars)}
                  <span className="text-line">{"★".repeat(5 - avgStars)}</span>
                </p>
                <p className="mt-1 text-sm font-bold tracking-tight text-muted">
                  수강생·학부모 후기 {reviewCount}건
                </p>
              </div>
            </div>
          )}

          {gradeChanges.length > 0 && (
            <div className="mb-14 grid gap-5 md:grid-cols-2">
              {gradeChanges.map((r) => (
                <Card
                  key={r.id}
                  className="flex flex-col gap-4 border-brand-100 bg-brand-50/40 p-7"
                >
                  <div className="flex items-center gap-3">
                    <Badge tone="brand">성적 변화</Badge>
                    <span className="text-sm font-black tracking-tight text-ink">
                      {r.beforeGrade} → {r.afterGrade}
                    </span>
                  </div>
                  <p className="text-[15px] leading-[1.86] tracking-tight text-ink-soft">
                    {r.content}
                  </p>
                </Card>
              ))}
            </div>
          )}

          {content.reviews.length > 0 && <ReviewTabs reviews={content.reviews} />}
        </Container>
      </Section>

      <Section className="pt-0">
        <Container>
          <Card className="flex flex-col items-start gap-4 border-brand-100 bg-brand-50/40 p-8 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-extrabold text-brand-600">외부 후기 채널</p>
              <p className="mt-2 text-lg font-black tracking-tight text-ink">
                김과외에서 실제 후기 보기
              </p>
              <p className="mt-1 text-sm tracking-tight text-muted">
                김과외 플랫폼에 등록된 실제 학생·학부모 후기를 직접
                확인하실 수 있습니다.
              </p>
            </div>
            <a
              href={content.settings.kimReviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass("primary", "md")}
            >
              김과외 후기 보기
            </a>
          </Card>
        </Container>
      </Section>
    </>
  );
}
