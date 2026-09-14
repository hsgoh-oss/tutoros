"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CrmActionResult } from "@/components/admin/crm/types";

export interface BackupPanelEntry {
  id: string;
  createdAt: string;
}

// 사이트 설정 백업/복원 UI — target별 최근 12개 스냅샷을 펼쳐 보여주고
// 선택한 시점을 확인한 뒤 검증과 복원을 실행한다.
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
        <div>
        <ul className="mt-3 space-y-2">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-muted">{entry.createdAt}</span>
              <button
                type="button"
                disabled={pendingId !== null}
                onClick={() => { setSelectedId(entry.id); setMessage(""); setError(""); }}
                className="shrink-0 font-bold text-brand-700 hover:underline disabled:opacity-50"
              >
                {pendingId === entry.id ? "복원 중..." : "이 시점으로 복원"}
              </button>
            </li>
          ))}
        </ul>
        {selectedId && <div className="mt-3 rounded-md border border-line p-3 text-xs">
          <p>{entries.find((entry) => entry.id === selectedId)?.createdAt} 백업을 검증하고 복원합니다. 현재 내용도 백업하며, 후기는 비공개 초안으로 복원합니다.</p>
          <div className="mt-3 flex gap-4"><button type="button" disabled={!!pendingId} onClick={async () => {
            setPendingId(selectedId); setError("");
            try { const result = await restoreAction(selectedId);
              if (result.ok) { setSelectedId(null); setMessage(result.warning || "검증을 마치고 복원했습니다."); router.refresh(); }
              else setError(result.error || "복원에 실패했습니다.");
            } catch { setError("요청 결과를 확인하지 못했습니다. 목록을 새로고침해 확인해 주세요."); }
            finally { setPendingId(null); }
          }} className="font-medium text-brand-700">{pendingId ? "검증·복원 중…" : "복원 실행"}</button><button type="button" disabled={!!pendingId} onClick={() => setSelectedId(null)}>취소</button></div>
        </div>}
        {error && <p role="alert" className="mt-3 text-xs text-rose-600">{error}</p>}
        {message && <p role="status" className="mt-3 text-xs text-brand-700">{message}</p>}
        </div>
      )}
    </div>
  );
}
