import { AdminPageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/card";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { createFaq } from "../actions";
import { FaqFormFields } from "../faq-form-fields";

export default function NewFaqPage() {
  return (
    <div className="dash-page">
      <AdminPageHeader>
        <h1 className="text-xl font-semibold tracking-tight">FAQ 신규 등록</h1>
      </AdminPageHeader>

      <Card className="max-w-2xl">
        <SubmitForm action={createFaq} submitLabel="등록" redirectTo="/admin/faq">
          <FaqFormFields />
        </SubmitForm>
      </Card>
    </div>
  );
}
