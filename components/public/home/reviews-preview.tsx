import Link from "next/link";
import { ReviewCard } from "@/components/public/review-card";
import { buttonClass } from "@/components/ui/button";
import type { Review } from "@/lib/types";

const PREVIEW_COUNT = 3;

export function ReviewsPreview({ reviews }: { reviews: Review[] }) {
  const pinned = reviews.filter((r) => r.isPinned);
  const rest = reviews.filter((r) => !r.isPinned);
  const preview = [...pinned, ...rest].slice(0, PREVIEW_COUNT);

  return (
    <div>
      <div className="grid gap-5 md:grid-cols-3">
        {preview.map((review) => (
          <ReviewCard key={review.id} review={review} />
        ))}
      </div>
      <div className="mt-10 text-center">
        <Link href="/reviews" className={buttonClass("outline", "md")}>
          후기 전체 보기
        </Link>
      </div>
    </div>
  );
}
