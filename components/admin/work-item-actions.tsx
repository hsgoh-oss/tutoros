"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import type { CrmActionResult } from "@/components/admin/crm/types";

export function WorkItemActions({ id, resolveAction }: {
  id: string;
  resolveAction: (id: string, resolution: string, status: "done" | "dismissed") => Promise<CrmActionResult>;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [status, setStatus] = useState<"done" | "dismissed" | null>(null);
  const [resolution, setResolution] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (status) dialog.current?.showModal();
    else dialog.current?.close();
  }, [status]);

  function open(next: "done" | "dismissed") {
    setResolution("");
    setError(null);
    setStatus(next);
  }

  async function submit() {
    if (!status || pending || !resolution.trim()) return;
    setPending(true);
    setError(null);
    try {
      const result = await resolveAction(id, resolution.trim(), status);
      if (result.ok) { setStatus(null); router.refresh(); }
      else setError(result.error ?? "처리에 실패했습니다.");
    } catch {
      setError("요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return <div className="flex shrink-0 items-center gap-3">
    <button type="button" disabled={pending} onClick={() => open("done")}
      className="inline-flex min-h-11 min-w-11 items-center justify-center text-xs font-medium text-ink-soft hover:underline disabled:opacity-50">완료</button>
    <button type="button" disabled={pending} onClick={() => open("dismissed")}
      className="inline-flex min-h-11 min-w-11 items-center justify-center text-xs text-muted hover:underline disabled:opacity-50">무시</button>
    <dialog ref={dialog} className="dash-action-dialog" aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); if (!pending) setStatus(null); }}>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="dash-action-dialog-body">
          <h2 id={titleId}>{status === "done" ? "업무 완료" : "업무 무시"}</h2>
          <Field label={status === "done" ? "처리 내용" : "무시 사유"} required className="mt-5">
            <Textarea autoFocus required value={resolution} onChange={(event) => setResolution(event.target.value)} disabled={pending}
              placeholder={status === "done" ? "예: 재발송 후 성공 확인" : "예: 중복 접수로 조치 불필요"} />
          </Field>
          {error && <p role="alert" className="text-rose-600">{error}</p>}
        </div>
        <div className="dash-action-dialog-footer">
          <button type="button" disabled={pending} className={buttonClass("outline", "sm")} onClick={() => setStatus(null)}>취소</button>
          <button type="submit" disabled={pending || !resolution.trim()} className={buttonClass("primary", "sm")}>{pending ? "처리 중…" : status === "done" ? "완료 처리" : "무시 처리"}</button>
        </div>
      </form>
    </dialog>
  </div>;
}
