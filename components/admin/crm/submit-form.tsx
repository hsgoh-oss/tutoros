"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { CrmActionResult } from "./types";

// 서버 액션(FormData 기반, {ok,error} 반환 계약)을 감싸는 공용 폼 래퍼.
// 성공 시 redirectTo로 이동하거나(없으면 router.refresh) 실패 시 에러 문구를 표시한다.
export function SubmitForm({
  action,
  children,
  submitLabel = "저장",
  pendingLabel = "처리 중...",
  redirectTo,
  className,
}: {
  action: (formData: FormData) => Promise<CrmActionResult>;
  children?: ReactNode;
  submitLabel?: string;
  pendingLabel?: string;
  redirectTo?: string;
  className?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    CrmActionResult | null,
    FormData
  >(async (_prev, formData) => action(formData), null);

  useEffect(() => {
    if (state?.ok) {
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    }
  }, [state, redirectTo, router]);

  return (
    <form action={formAction} className={className}>
      {children}
      {state && !state.ok && (
        <p className="mt-3 text-sm font-bold text-rose-600">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className={cn(buttonClass("primary", "md"), "mt-4")}
      >
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}
