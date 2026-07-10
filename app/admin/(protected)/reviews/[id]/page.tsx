import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { getReview } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { updateReview } from "../actions";
import { ReviewFormFields } from "../review-form-fields";

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

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-black tracking-tight">후기 수정</h1>
      </div>

      <Card className="max-w-3xl">
        <SubmitForm action={updateReview} submitLabel="저장">
          <input type="hidden" name="id" value={review.id} />
          <ReviewFormFields review={review} />
        </SubmitForm>
      </Card>
    </div>
  );
}
