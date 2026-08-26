"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import type { CrmActionResult } from "./types";

// id 하나만 받아 실행하는 서버 액션(삭제·완납 처리·학생 전환 등)을 위한 공용 버튼.
// confirmText가 있으면 실행 전 confirm, 실패 시 alert로 에러를 노출한다.
export function ActionButton({
  action,
  id,
  label,
  pendingLabel = "처리 중...",
  confirmText,
  redirectTo,
  tone = "default",
  className,
}: {
  action: (id: string) => Promise<CrmActionResult>;
  id: string;
  label: string;
  pendingLabel?: string;
  confirmText?: string;
  redirectTo?: string;
  tone?: "default" | "danger";
  className?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        if (confirmText && !window.confirm(confirmText)) return;
        setPending(true);
        const result = await action(id);
        setPending(false);
        if (result.ok) {
          if (redirectTo) router.push(redirectTo);
          router.refresh();
        } else {
          window.alert(result.error ?? "처리에 실패했습니다.");
        }
      }}
      // 표 안에 같은 액션이 열 줄씩 반복된다 — 전부 유채색이면 목록이 시끄럽고,
      // 특히 '삭제'가 늘 빨갛게 켜져 있으면 경보로서의 힘을 잃는다.
      // 평소엔 가라앉히고 커서를 올렸을 때만 성격을 드러낸다.
      className={cn(
        "text-xs font-medium underline-offset-2 transition-colors hover:underline disabled:opacity-50",
        tone === "danger"
          ? "text-muted hover:text-rose-600"
          : "text-ink-soft hover:text-brand-700",
        className,
      )}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
