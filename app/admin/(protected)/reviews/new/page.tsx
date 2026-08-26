import { Card } from "@/components/ui/card";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { createReview } from "../actions";
import { ReviewFormFields } from "../review-form-fields";

export default function NewReviewPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">후기 신규 등록</h1>
        <p className="mt-1 text-sm text-muted">
          등록된 후기는 승인 대기(비공개)로 저장되며, 목록에서 게시 승인해야 공개 사이트에
          노출됩니다.
        </p>
      </div>

      <Card className="max-w-3xl">
        <SubmitForm action={createReview} submitLabel="등록" redirectTo="/admin/reviews">
          <ReviewFormFields />
        </SubmitForm>
      </Card>
    </div>
  );
}
