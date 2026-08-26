import { Card } from "@/components/ui/card";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { createFaq } from "../actions";
import { FaqFormFields } from "../faq-form-fields";

export default function NewFaqPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">FAQ 신규 등록</h1>
      </div>

      <Card className="max-w-2xl">
        <SubmitForm action={createFaq} submitLabel="등록" redirectTo="/admin/faq">
          <FaqFormFields />
        </SubmitForm>
      </Card>
    </div>
  );
}
