import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { REVIEWER_TYPE_OPTIONS, RATING_OPTIONS } from "./constants";
import type { Review } from "@/lib/types";
import type { ScreenshotView } from "./storage";

export function ReviewFormFields({
  review,
  screenshotViews,
}: {
  review?: Review;
  /**
   * 스크린샷 표시 URL(S-02) — 신규 증빙은 비공개 버킷 경로로 저장되므로 서버 페이지가
   * 만료 서명 URL을 발급해 내려준다. 삭제 체크박스 값은 저장 원문(stored)을 그대로 써야
   * 서버 액션이 DB 항목과 대조할 수 있다. 미전달 시 저장값을 그대로 표시(레거시 URL 호환).
   */
  screenshotViews?: ScreenshotView[];
}) {
  const views: ScreenshotView[] =
    screenshotViews ??
    (review?.screenshots ?? []).map((s) => ({ stored: s, displayUrl: s }));
  return (
    <div className="space-y-6">
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="작성자 유형" required>
          <Select name="reviewerType" defaultValue={review?.reviewerType ?? "student"}>
            {REVIEWER_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="평점" required>
          <Select name="rating" defaultValue={String(review?.rating ?? 5)}>
            {RATING_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}점
              </option>
            ))}
          </Select>
        </Field>

        <Field label="이전 성적" hint="예: 5등급">
          <Input name="beforeGrade" defaultValue={review?.beforeGrade ?? ""} placeholder="5등급" />
        </Field>

        <Field label="이후 성적" hint="예: 2등급">
          <Input name="afterGrade" defaultValue={review?.afterGrade ?? ""} placeholder="2등급" />
        </Field>

        <Field label="지역">
          <Input name="region" defaultValue={review?.region ?? ""} placeholder="서울 강남구" />
        </Field>

        <Field label="학년/구분" hint="고1·고2·고3·재수">
          <Input name="grade" defaultValue={review?.grade ?? ""} placeholder="고2" />
        </Field>

        <Field label="계열" hint="문과·이과">
          <Input name="track" defaultValue={review?.track ?? ""} placeholder="이과" />
        </Field>

        <Field label="출처">
          <Input name="source" defaultValue={review?.source ?? ""} placeholder="김과외" />
        </Field>

        <Field label="후기 작성일">
          <Input type="date" name="reviewedAt" defaultValue={review?.reviewedAt ?? ""} />
        </Field>
      </div>

      <Field label="후기 내용" required>
        <Textarea
          name="content"
          defaultValue={review?.content ?? ""}
          placeholder="후기 내용을 입력해 주세요."
        />
      </Field>

      {review && views.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-bold text-ink-soft">기존 스크린샷 (체크 시 삭제)</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {views.map((view) => (
              <label key={view.stored} className="block cursor-pointer space-y-1.5">
                {/* 레거시 공개 URL 또는 비공개 증빙의 만료 서명 URL — next.config에
                    remotePatterns 미설정이라 next/image 대신 img 사용 (관리자 내부 썸네일, LCP 무관) */}
                {view.displayUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={view.displayUrl}
                    alt="후기 스크린샷"
                    className="h-24 w-full rounded-panel border border-line object-cover"
                  />
                ) : (
                  <span className="flex h-24 w-full items-center justify-center rounded-panel border border-line bg-soft text-xs font-bold text-muted">
                    미리보기 불가
                  </span>
                )}
                <span className="flex items-center gap-1.5 text-xs font-bold text-rose-600">
                  <input
                    type="checkbox"
                    name="removeScreenshots"
                    value={view.stored}
                    className="h-4 w-4"
                  />
                  삭제
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <Field
        label={review ? "스크린샷 추가" : "스크린샷"}
        hint="jpg, png, webp / 10MB 이하 / 최대 5장"
      >
        <Input
          type="file"
          name="screenshots"
          multiple
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          className="file:mr-4 file:cursor-pointer file:rounded-full file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-bold file:text-brand-700"
        />
      </Field>

      {!review && (
        <label className="flex items-start gap-2 rounded-panel bg-soft p-4 text-sm">
          <input
            type="checkbox"
            name="publishConsent"
            required
            className="mt-0.5 h-4 w-4"
          />
          <span className="font-bold text-ink-soft">
            작성자로부터 후기 게시 동의를 받았음을 확인합니다.
            <span className="ml-1 text-brand-600">*</span>
          </span>
        </label>
      )}

      {review && review.aiTags.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-bold text-ink-soft">AI 태그 (읽기 전용)</p>
          <div className="flex flex-wrap gap-2">
            {review.aiTags.map((tag) => (
              <Badge key={tag} tone="soft">
                {tag}
              </Badge>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">
            AI 태깅은 후속 기능으로 제공 예정이며 현재는 편집할 수 없습니다.
          </p>
        </div>
      )}
    </div>
  );
}
