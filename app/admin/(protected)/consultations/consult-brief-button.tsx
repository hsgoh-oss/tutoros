"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { generateConsultBrief } from "./actions";

// 브리핑 생성은 성공 시 새로 생성된 리포트 id로 이동해야 해서 ActionButton의 고정 redirectTo로는
// 표현이 안 돼 이 모듈 전용 클라이언트 버튼으로 분리(convert-button.tsx와 동일 패턴).
export function ConsultBriefButton({ consultationId }: { consultationId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const result = await generateConsultBrief(consultationId);
        setPending(false);
        if (result.ok && result.reportId) {
          router.push(`/admin/reports/${result.reportId}`);
        } else {
          window.alert(result.error ?? "브리핑 생성에 실패했습니다.");
        }
      }}
      className="rounded-full border border-line bg-soft px-4 py-2 text-xs font-bold text-ink-soft transition-colors hover:border-brand-600 hover:text-brand-600 disabled:opacity-60"
    >
      {pending ? "생성 중..." : "상담 브리핑 AI"}
    </button>
  );
}
