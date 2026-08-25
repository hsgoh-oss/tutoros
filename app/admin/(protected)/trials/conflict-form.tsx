"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { TrialActionResult } from "./actions";

// 일정 충돌을 "경고 후 강행 선택"으로 처리하는 폼 래퍼(T-02 "충돌 확인").
//
// 정본은 충돌을 금지하지 않는다 — 겹치는 일정이 있다는 사실을 보여주고 그래도 진행할지
// 운영자가 고르게 한다. 그래서 서버 액션은 첫 제출에서 conflicts를 담아 ok:false로 돌아오고,
// 여기서 목록을 펼친 뒤 두 번째 제출에만 force=1을 실어 보낸다.
// (SubmitForm은 성공/실패 두 갈래뿐이라 이 3단 흐름을 담지 못해 별도 컴포넌트를 둔다.)
export function ConflictAwareForm({
  action,
  children,
  submitLabel,
  pendingLabel = "처리 중...",
  forceLabel = "충돌을 확인했고 이대로 진행",
  className,
}: {
  action: (formData: FormData) => Promise<TrialActionResult>;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  forceLabel?: string;
  className?: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);

  function submit(force: boolean) {
    const form = formRef.current;
    if (!form) return;
    const formData = new FormData(form);
    if (force) formData.set("force", "1");
    startTransition(async () => {
      const result = await action(formData);
      if (result.ok) {
        setError(null);
        setConflicts([]);
        // 재예약처럼 보던 회차가 닫힌 경우에는 액션이 이어서 볼 곳을 알려준다.
        if (result.redirectPath) router.push(result.redirectPath);
        router.refresh();
        return;
      }
      setError(result.error ?? "처리에 실패했습니다.");
      // 충돌이 아닌 오류(권한·경합 등)로 되돌아왔으면 이전 충돌 목록은 지운다.
      setConflicts(result.conflicts ?? []);
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
      className={className}
    >
      {children}

      {error && (
        <p className="mt-3 text-sm font-bold text-rose-600" role="alert">
          {error}
        </p>
      )}

      {conflicts.length > 0 && (
        <div className="mt-3 rounded-panel border border-amber-100 bg-amber-50 p-4">
          <p className="text-xs font-black text-amber-700">겹치는 일정 {conflicts.length}건</p>
          <ul className="mt-2 space-y-1 text-xs text-amber-700">
            {conflicts.map((c, i) => (
              <li key={`${c}-${i}`}>· {c}</li>
            ))}
          </ul>
          <button
            type="button"
            disabled={pending}
            onClick={() => submit(true)}
            className={cn(buttonClass("outline", "sm"), "mt-3")}
          >
            {pending ? pendingLabel : forceLabel}
          </button>
        </div>
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
