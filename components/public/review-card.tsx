import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { Review } from "@/lib/types";

export function ReviewCard({ review }: { review: Review }) {
  return (
    <Card className="flex h-full flex-col gap-4 rounded-[var(--radius-panel)] p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={review.reviewerType === "parent" ? "brand" : "soft"}>
          {review.reviewerType === "parent" ? "학부모" : "학생"}
        </Badge>
        {review.grade && <Badge tone="soft">{review.grade}</Badge>}
        {review.track && <Badge tone="soft">{review.track}</Badge>}
        {review.region && <Badge tone="soft">{review.region}</Badge>}
      </div>
      <p
        className="text-brand-600"
        aria-label={`별점 5점 만점에 ${review.rating}점`}
      >
        {"★".repeat(review.rating)}
        <span className="text-line">{"★".repeat(5 - review.rating)}</span>
      </p>
      <p className="grow [font:var(--font-body)] text-ink-soft">
        {review.content}
      </p>
      {review.screenshots.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {review.screenshots.map((src) => (
            <div
              key={src}
              className="relative h-20 w-20 overflow-hidden rounded-[var(--radius-sm)] border border-line bg-soft sm:h-24 sm:w-24"
            >
              <Image
                src={src}
                alt="후기 스크린샷"
                fill
                sizes="(min-width: 640px) 96px, 80px"
                className="object-cover"
              />
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-faint">
        <span>{review.source && `${review.source} 후기`}</span>
        <span>{review.reviewedAt}</span>
      </div>
    </Card>
  );
}
