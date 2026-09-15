"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function PortalRefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
      className="min-h-11 shrink-0 px-3 text-xs font-bold text-brand-700 hover:underline disabled:opacity-50"
      aria-label="과제 새로고침"
    >
      {pending ? "불러오는 중..." : "새로고침"}
    </button>
  );
}
