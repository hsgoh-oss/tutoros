"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { buttonClass } from "@/components/ui/button";
import type { CrmActionResult } from "./types";

export function ActionButton({
  action, id, label, pendingLabel = "처리 중…", confirmText, redirectTo,
  tone = "default", className,
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
  const [notice, setNotice] = useState<{ kind: "confirm" | "error" | "warning"; text: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (notice) { if (!dialog.current?.open) dialog.current?.showModal(); }
    else dialog.current?.close();
  }, [notice]);

  function complete() {
    setNotice(null);
    if (redirectTo) router.push(redirectTo);
    router.refresh();
  }

  async function run() {
    if (pending) return;
    setPending(true);
    try {
      const result = await action(id);
      if (result.ok) {
        if (result.warning) setNotice({ kind: "warning", text: result.warning });
        else complete();
      } else {
        setNotice({ kind: "error", text: result.error ?? "처리에 실패했습니다." });
      }
    } catch {
      setNotice({ kind: "error", text: "요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    } finally {
      setPending(false);
    }
  }

  function dismiss() {
    if (pending) return;
    if (notice?.kind === "warning") complete();
    else setNotice(null);
  }

  return <>
    <button type="button" disabled={pending}
      onClick={() => confirmText ? setNotice({ kind: "confirm", text: confirmText }) : void run()}
      className={cn(
        "text-xs font-medium underline-offset-2 transition-colors hover:underline disabled:opacity-50 max-md:inline-flex max-md:min-h-11 max-md:items-center max-md:px-1.5",
        tone === "danger" ? "text-muted hover:text-rose-600" : "text-ink-soft hover:text-brand-700",
        className,
      )}>
      {pending ? pendingLabel : label}
    </button>
    <dialog ref={dialog} className="dash-action-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); dismiss(); }}>
      <div className="dash-action-dialog-body">
        <h2 id={titleId}>{notice?.kind === "error" ? "처리하지 못했습니다" : label}</h2>
        <p id={descriptionId} role={notice?.kind === "error" ? "alert" : undefined}>{notice?.text}</p>
      </div>
      <div className="dash-action-dialog-footer">
        {notice?.kind === "confirm" ? <>
          <button type="button" autoFocus disabled={pending} className={buttonClass("outline", "sm")} onClick={dismiss}>취소</button>
          <button type="button" disabled={pending} className={cn(buttonClass("primary", "sm"), tone === "danger" && "dash-danger-button")} onClick={() => void run()}>{pending ? pendingLabel : label}</button>
        </> : <button type="button" autoFocus className={buttonClass("outline", "sm")} onClick={dismiss}>확인</button>}
      </div>
    </dialog>
  </>;
}
