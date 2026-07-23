"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CrmActionResult } from "@/components/admin/crm/types";

export interface BackupPanelEntry {
  id: string;
  createdAt: string;
}

// 사이트 설정 백업/복원 UI — target별 최근 12개 스냅샷을 펼쳐 보여주고
// 선택 시 restoreAction(backupId)으로 즉시 복원한다.
export function BackupPanel({
  entries,
  restoreAction,
}: {
  entries: BackupPanelEntry[];
  restoreAction: (backupId: string) => Promise<CrmActionResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (entries.length === 0) return null;

  return (
    <div className="mt-5 border-t border-line pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-bold text-muted hover:text-ink"
      >
        {open ? "백업/복원 닫기" : `백업/복원 (${entries.length})`}
      </button>
      {open && (
        <ul className="mt-3 space-y-2">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-muted">{entry.createdAt}</span>
              <button
                type="button"
                disabled={pendingId !== null}
                onClick={async () => {
                  if (
                    !window.confirm(
                      "이 시점으로 복원하시겠습니까? 현재 내용은 되돌릴 수 없습니다.",
                    )
                  ) {
                    return;
                  }
                  setPendingId(entry.id);
                  const result = await restoreAction(entry.id);
                  setPendingId(null);
                  if (result.ok) {
                    router.refresh();
                  } else {
                    window.alert(result.error ?? "복원에 실패했습니다.");
                  }
                }}
                className="shrink-0 font-bold text-brand-700 hover:underline disabled:opacity-50"
              >
                {pendingId === entry.id ? "복원 중..." : "이 시점으로 복원"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
