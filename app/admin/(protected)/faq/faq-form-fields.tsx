import { Field, Input, Textarea } from "@/components/ui/form";
import type { Faq } from "@/lib/types";

export function FaqFormFields({ faq }: { faq?: Faq }) {
  return (
    <div className="grid gap-5">
      <Field label="카테고리" hint="기본값: 일반">
        <Input name="category" defaultValue={faq?.category ?? ""} placeholder="일반" />
      </Field>

      <Field label="질문" required>
        <Input
          name="question"
          defaultValue={faq?.question ?? ""}
          placeholder="수업은 어떻게 진행되나요?"
        />
      </Field>

      <Field label="답변" required>
        <Textarea name="answer" defaultValue={faq?.answer ?? ""} placeholder="답변을 입력해 주세요." />
      </Field>
    </div>
  );
}
