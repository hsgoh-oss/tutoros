"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import type { ReviewStatus } from "@/lib/types";
import {
  approveReview,
  confirmMasking,
  publishReview,
  rejectReview,
  requestRevision,
  retractReview,
  startReview,
  type ReviewLinkResult,
} from "./actions";
import { IssuedReviewLink } from "./issued-link";

// 후기 상세의 행동 패널 — 지금 상태에서 유효한 전환만 그린다(S-03 운영자 결정 세 갈래 + 게시·철회).
// 본문·마스킹 이름은 여기서 고칠 수 없다. 확인 체크와 사유 입력만 있다.

export interface ReviewActionsProps {
  id: string;
  status: ReviewStatus;
  publicName: string | null;
  hasImages: boolean;
  imagesPublic: boolean;
  isMinor: boolean;
  maskingConfirmed: boolean;
  canRequestRevision: boolean;
}

export function ReviewActions({
  id,
  status,
  publicName,
  hasImages,
  imagesPublic,
  isMinor,
  maskingConfirmed,
  canRequestRevision,
}: ReviewActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ link: string; warnings: string[] } | null>(null);
  const [mode, setMode] = useState<"idle" | "revision" | "reject" | "retract">("idle");
  const [reason, setReason] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string; warning?: string }>) => {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "처리에 실패했습니다.");
        return;
      }
      setError(null);
      setNotice(result.warning ?? null);
      setMode("idle");
      setReason("");
      router.refresh();
    });
  };

  const withReason = (
    action: (fd: FormData) => Promise<ReviewLinkResult | { ok: boolean; error?: string; warning?: string }>,
    confirmText: string,
    fieldName: "note" | "reason",
  ) => {
    if (!reason.trim()) {
      setError("사유를 입력해 주세요.");
      return;
    }
    if (!window.confirm(confirmText)) return;
    const fd = new FormData();
    fd.set("id", id);
    fd.set(fieldName, reason.trim());
    startTransition(async () => {
      const result = await action(fd);
      if (!result.ok) {
        setError(result.error ?? "처리에 실패했습니다.");
        return;
      }
      setError(null);
      const linked = result as ReviewLinkResult;
      if (linked.link) setIssued({ link: linked.link, warnings: linked.warnings ?? [] });
      setNotice("warning" in result && result.warning ? result.warning : null);
      setMode("idle");
      setReason("");
      router.refresh();
    });
  };

  const submitMasking = (fd: FormData) => {
    fd.set("id", id);
    run(() => confirmMasking(fd));
  };

  return (
    <div className="space-y-4">
      {error && <p className="text-sm font-bold text-rose-600">{error}</p>}
      {notice && (
        <p className="rounded-panel border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
          {notice}
        </p>
      )}
      {issued && <IssuedReviewLink link={issued.link} warnings={issued.warnings} />}

      {(status === "draft" || status === "submitted") && (
        <div>
          <p className="mb-3 text-sm text-muted">
            제출본입니다. 검토를 시작하면 개인정보·표현·동의·사실 근거를 확인한 뒤 승인·수정 요청·반려 중
            하나를 결정합니다.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => startReview(id))}
            className={buttonClass("primary", "sm")}
          >
            {pending ? "처리 중..." : "검토 시작"}
          </button>
        </div>
      )}

      {status === "in_review" && (
        <div className="space-y-4">
          {mode === "idle" && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (!window.confirm("이 건을 승인할까요? 승인 뒤 마스킹·최소정보 확인을 거쳐야 게시됩니다.")) return;
                  run(() => approveReview(id));
                }}
                className={buttonClass("primary", "sm")}
              >
                승인
              </button>
              <button
                type="button"
                disabled={pending || !canRequestRevision}
                onClick={() => setMode("revision")}
                className={buttonClass("outline", "sm")}
                title={canRequestRevision ? undefined : "작성자 연락처가 없어 수정 요청 링크를 보낼 수 없습니다"}
              >
                작성자에게 수정 요청
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setMode("reject")}
                className={buttonClass("ghost", "sm", "hover:border-rose-300 hover:text-rose-600")}
              >
                반려
              </button>
            </div>
          )}

          {mode === "revision" && (
            <div className="space-y-3 rounded-panel border border-line bg-soft p-4">
              <Field label="보완이 필요한 내용" required hint="작성자에게 새 작성 링크와 함께 그대로 전달됩니다">
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="예: 학교명이 본문에 들어 있어 지워 주세요 / 시험명을 적어 주세요"
                />
              </Field>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    withReason(
                      requestRevision,
                      "작성자에게 수정 요청을 보낼까요? 새 작성 링크가 발송되고, 재제출되면 다시 검토합니다.",
                      "note",
                    )
                  }
                  className={buttonClass("primary", "sm")}
                >
                  {pending ? "발송 중..." : "수정 요청 보내기"}
                </button>
                <button type="button" disabled={pending} onClick={() => setMode("idle")} className={buttonClass("ghost", "sm")}>
                  취소
                </button>
              </div>
            </div>
          )}

          {mode === "reject" && (
            <div className="space-y-3 rounded-panel border border-rose-100 bg-rose-50 p-4">
              <Field label="반려 사유" required hint="작성자에게 안내됩니다. 공개하지 않는 이유를 정중하게 적어 주세요.">
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="예: 타인의 개인정보가 포함돼 있어 게시하지 않습니다"
                />
              </Field>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    withReason(rejectReview, "이 건을 반려할까요? 공개되지 않으며 작성자에게 사유가 안내됩니다.", "reason")
                  }
                  className={buttonClass("primary", "sm", "border-rose-600 bg-rose-600 hover:border-rose-700 hover:bg-rose-700")}
                >
                  {pending ? "처리 중..." : "반려 확정"}
                </button>
                <button type="button" disabled={pending} onClick={() => setMode("idle")} className={buttonClass("ghost", "sm")}>
                  취소
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {status === "approved" && !maskingConfirmed && (
        <form
          action={submitMasking}
          className="space-y-3 rounded-panel border border-brand-100 bg-brand-50/50 p-4"
        >
          <p className="text-sm font-bold text-ink">공개용 마스킹·최소정보 확인</p>
          <p className="text-xs leading-relaxed text-muted">
            공개 화면에는 아래 마스킹 이름과 본문·등급 변화·학년/계열만 나갑니다. 실명·연락처·학교명은
            나가지 않습니다. 고쳐야 할 것이 보이면 확인하지 말고 뒤로 가서 상태를 되돌릴 수 없으므로,
            승인 전에 수정 요청을 쓰는 것이 원칙입니다.
          </p>
          <p className="rounded-panel border border-line bg-white px-3 py-2 text-sm">
            공개 이름: <b>{publicName ?? "(없음 — 옛 대필 등록분)"}</b>
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="publicNameOk" className="mt-0.5 h-4 w-4 accent-brand-600" />
            <span>공개용 마스킹 이름을 확인했습니다(실명이 아니고, 규칙대로 가려져 있습니다)</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="noIdentifiers" className="mt-0.5 h-4 w-4 accent-brand-600" />
            <span>본문에 학교명·지역·연락처 등 식별 정보가 없음을 확인했습니다</span>
          </label>
          {hasImages && imagesPublic && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="imagesOk" className="mt-0.5 h-4 w-4 accent-brand-600" />
              <span>이미지 공개 동의가 있고, 이미지 안에 타인의 개인정보가 없음을 확인했습니다</span>
            </label>
          )}
          {hasImages && !imagesPublic && (
            <p className="text-xs text-muted">이미지 공개 동의가 없어 첨부 이미지는 게시되지 않습니다(검토 근거로만 보관).</p>
          )}
          {isMinor && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="guardianVerified" className="mt-0.5 h-4 w-4 accent-brand-600" />
              <span>미성년 학생 건 — 법정대리인(보호자)의 게시 동의를 확인했습니다</span>
            </label>
          )}
          <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>
            {pending ? "처리 중..." : "확인 완료"}
          </button>
        </form>
      )}

      {status === "approved" && maskingConfirmed && (
        <div>
          <p className="mb-3 text-sm text-muted">마스킹·최소정보 확인이 끝났습니다. 게시하면 공개 페이지에 바로 노출됩니다.</p>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!window.confirm("이 건을 공개 사이트에 게시할까요?")) return;
              run(() => publishReview(id));
            }}
            className={buttonClass("primary", "sm")}
          >
            {pending ? "게시 중..." : "게시"}
          </button>
        </div>
      )}

      {status === "published" && (
        <div className="space-y-3">
          {mode === "idle" ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => setMode("retract")}
              className={buttonClass("ghost", "sm", "hover:border-rose-300 hover:text-rose-600")}
            >
              철회(공개 중단)
            </button>
          ) : (
            <div className="space-y-3 rounded-panel border border-rose-100 bg-rose-50 p-4">
              <Field label="철회 사유" required hint="작성자 동의 철회 요청·사실 오류 확인 등. 행은 남고 공개만 중단됩니다.">
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
              </Field>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    withReason(
                      retractReview,
                      "이 건을 철회할까요? 공개 페이지에서 즉시 사라지고 공개 이미지 사본이 삭제됩니다. 다시 게시하려면 새 제출이 필요합니다.",
                      "reason",
                    )
                  }
                  className={buttonClass("primary", "sm", "border-rose-600 bg-rose-600 hover:border-rose-700 hover:bg-rose-700")}
                >
                  {pending ? "처리 중..." : "철회 확정"}
                </button>
                <button type="button" disabled={pending} onClick={() => setMode("idle")} className={buttonClass("ghost", "sm")}>
                  취소
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
