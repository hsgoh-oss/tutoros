import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { getReview } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { ActionButton } from "@/components/admin/crm/action-button";
import { approveReview, updateReview } from "../actions";
import { ReviewFormFields } from "../review-form-fields";
import { reviewStatusLabel } from "../constants";
import { getReviewStatus, screenshotViewsFor } from "../storage";

export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAdminSession();
  if (!session) notFound();

  const review = await getReview(session.tenantId, id);
  if (!review) notFound();

  // 게시 상태(00016 — S-01 승인 게시 흐름)와 증빙 표시 URL(비공개 원본은 만료 서명 URL)을 보강 조회.
  const statusRow = await getReviewStatus(session.tenantId, id);
  const screenshotViews = await screenshotViewsFor(review.screenshots);
  const status = statusRow?.status;
  const pendingApproval = status === "draft" || status === "approved";

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-black tracking-tight">후기 수정</h1>
          {status && (
            <Badge
              tone={
                status === "published" ? "success" : status === "retracted" ? "danger" : "warning"
              }
            >
              {reviewStatusLabel(status)}
            </Badge>
          )}
        </div>
        {/* S-01: 승인 전(draft)에는 공개 사이트에 노출되지 않는다 — 게시는 이 승인 버튼으로만 */}
        {pendingApproval && (
          <ActionButton
            action={approveReview}
            id={id}
            label="게시 승인"
            confirmText="이 후기를 공개 사이트에 게시하시겠습니까? 증빙 스크린샷의 공개 사본이 생성됩니다."
          />
        )}
      </div>

      {pendingApproval && (
        <p className="mb-6 max-w-3xl rounded-panel border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
          이 후기는 아직 공개되지 않았습니다. 내용·증빙 검토 후 게시 승인을 눌러야 공개 사이트에
          노출됩니다.
        </p>
      )}

      <Card className="max-w-3xl">
        <SubmitForm action={updateReview} submitLabel="저장">
          <input type="hidden" name="id" value={review.id} />
          <ReviewFormFields review={review} screenshotViews={screenshotViews} />
        </SubmitForm>
      </Card>
    </div>
  );
}
