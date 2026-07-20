"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CrmActionResult } from "@/components/admin/crm/types";

// 학생 상세의 리포트 포털 링크 카드 — 복사 + 재발급(토큰 회전).
export function PortalLinkCard({
  url,
  studentId,
  regenerate,
}: {
  url: string;
  studentId: string;
  regenerate: (id: string) => Promise<CrmActionResult>;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-panel border border-line bg-soft px-3 py-2 text-xs text-ink-soft"
        />
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // 클립보드 접근 불가 — 사용자가 직접 선택·복사할 수 있게 조용히 무시.
            }
          }}
          className="min-h-11 shrink-0 rounded-panel bg-brand-600 px-3 text-xs font-bold text-white hover:bg-brand-700"
        >
          {copied ? "복사됨" : "복사"}
        </button>
      </div>
      <div className="flex items-center justify-between">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-bold text-brand-700 hover:underline"
        >
          새 탭에서 열기 ↗
        </a>
        <button
          type="button"
          disabled={pending}
          onClick={async () => {
            if (
              !window.confirm(
                "링크를 재발급하면 기존 링크는 즉시 무효화됩니다. 계속할까요?",
              )
            )
              return;
            setPending(true);
            const result = await regenerate(studentId);
            setPending(false);
            if (result.ok) router.refresh();
            else window.alert(result.error ?? "재발급에 실패했습니다.");
          }}
          className="text-xs font-bold text-rose-600 hover:underline disabled:opacity-50"
        >
          {pending ? "재발급 중..." : "링크 재발급"}
        </button>
      </div>
    </div>
  );
}
