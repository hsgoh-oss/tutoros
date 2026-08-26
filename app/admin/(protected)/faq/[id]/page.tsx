import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { getFaq } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { updateFaq } from "../actions";
import { FaqFormFields } from "../faq-form-fields";

export default async function FaqDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAdminSession();
  if (!session) notFound();

  const faq = await getFaq(session.tenantId, id);
  if (!faq) notFound();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">FAQ 수정</h1>
      </div>

      <Card className="max-w-2xl">
        <SubmitForm action={updateFaq} submitLabel="저장">
          <input type="hidden" name="id" value={faq.id} />
          <FaqFormFields faq={faq} />
        </SubmitForm>
      </Card>
    </div>
  );
}
