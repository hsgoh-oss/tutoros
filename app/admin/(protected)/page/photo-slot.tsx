"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { buttonClass } from "@/components/ui/button";
import { ActionButton } from "@/components/admin/crm/action-button";
import type { CrmActionResult } from "@/components/admin/crm/types";

export function PhotoSlot({
  slot,
  url,
  uploadAction,
  deleteAction,
}: {
  slot: number;
  url: string;
  uploadAction: (formData: FormData) => Promise<CrmActionResult>;
  deleteAction: (id: string) => Promise<CrmActionResult>;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState<CrmActionResult | null, FormData>(
    async (_prev, formData) => uploadAction(formData),
    null,
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <div className="space-y-2">
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-panel border border-line bg-soft">
        {url ? (
          // 관리자 미리보기 전용 — next.config remotePatterns 미설정으로 next/image 대신 img 사용
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`사진 ${slot + 1}`} className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs text-muted">슬롯 {slot + 1}</span>
        )}
      </div>

      <form ref={formRef} action={formAction}>
        <input type="hidden" name="slot" value={slot} />
        <input
          ref={fileRef}
          type="file"
          name="file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={() => formRef.current?.requestSubmit()}
        />
      </form>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => fileRef.current?.click()}
          className={cn(buttonClass("ghost", "sm"), "flex-1 justify-center px-2 text-xs")}
        >
          {pending ? "업로드 중..." : url ? "교체" : "업로드"}
        </button>
        {url && (
          <ActionButton
            action={deleteAction}
            id={String(slot)}
            label="삭제"
            confirmText="이 사진을 삭제하시겠습니까?"
            tone="danger"
          />
        )}
      </div>
      {state && !state.ok && <p className="text-xs font-bold text-rose-600">{state.error}</p>}
    </div>
  );
}
