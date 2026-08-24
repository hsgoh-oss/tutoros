"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CrmActionResult } from "@/components/admin/crm/types";

// 오늘 업무 행의 완료/무시 버튼 — 처리 내용(resolution)을 prompt로 받아 완결한다.
// action-button.tsx와 같은 confirm/alert 관례를 따르되, 완결에는 처리 내용이
// 필수라(결과 불명 방지) prompt 입력이 비면 실행하지 않는다.
export function WorkItemActions({
  id,
  resolveAction,
}: {
  id: string;
  resolveAction: (
    id: string,
    resolution: string,
    status: "done" | "dismissed",
  ) => Promise<CrmActionResult>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const run = async (status: "done" | "dismissed") => {
    const input = window.prompt(
      status === "done"
        ? "처리 내용을 입력해 주세요. (예: 재발송 후 성공 확인)"
        : "무시 사유를 입력해 주세요. (예: 중복 접수로 조치 불필요)",
    );
    if (input == null) return; // 취소
    const resolution = input.trim();
    if (!resolution) {
      window.alert("처리 내용 없이 완결할 수 없습니다.");
      return;
    }
    setPending(true);
    const result = await resolveAction(id, resolution, status);
    setPending(false);
    if (result.ok) {
      router.refresh();
    } else {
      window.alert(result.error ?? "처리에 실패했습니다.");
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => run("done")}
        className="text-xs font-bold text-brand-700 hover:underline disabled:opacity-50"
      >
        {pending ? "처리 중..." : "완료"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => run("dismissed")}
        className="text-xs font-bold text-muted hover:underline disabled:opacity-50"
      >
        무시
      </button>
    </div>
  );
}
