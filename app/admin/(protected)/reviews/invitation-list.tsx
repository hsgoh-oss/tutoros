"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import type { ReviewInvitation } from "@/lib/types";
import { invitationStatusLabel, invitationStatusTone } from "./constants";
import { closeReviewInvitation, resendReviewInvitation, type ReviewLinkResult } from "./actions";
import { IssuedReviewLink } from "./issued-link";

// 작성 초대 이력 — 후기 목록의 "열린 작성 초대" 카드·학생 상세 카드·후기 상세가 함께 쓴다.
// 재발급(링크 회전)·닫기만 한다. 발급은 각 호스트 화면의 폼이 맡는다.

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function InvitationList({
  invitations,
  showStudent = true,
  emptyText = "아직 발급한 작성 초대가 없습니다.",
}: {
  invitations: ReviewInvitation[];
  showStudent?: boolean;
  emptyText?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [issued, setIssued] = useState<{ id: string; link: string; warnings: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = (sourceId: string, result: ReviewLinkResult) => {
    if (!result.ok) {
      setError(result.error ?? "처리에 실패했습니다.");
      return;
    }
    setError(null);
    if (result.link) setIssued({ id: sourceId, link: result.link, warnings: result.warnings ?? [] });
    router.refresh();
  };

  const resend = (inv: ReviewInvitation) => {
    if (!window.confirm("재발급하면 새 링크가 나가고 지금 링크는 즉시 무효가 됩니다. 계속할까요?")) return;
    startTransition(async () => {
      apply(inv.id, await resendReviewInvitation(inv.id));
    });
  };

  const close = (inv: ReviewInvitation) => {
    const reason = window.prompt(
      "초대를 닫는 사유를 입력해 주세요. (예: 작성자 철회 · 대상 관계 종료 · 잘못 발급)",
      "",
    );
    if (reason === null) return;
    if (!reason.trim()) {
      setError("닫는 사유를 입력해 주세요.");
      return;
    }
    const fd = new FormData();
    fd.set("id", inv.id);
    fd.set("reason", reason.trim());
    startTransition(async () => {
      const result = await closeReviewInvitation(fd);
      if (!result.ok) {
        setError(result.error ?? "닫기에 실패했습니다.");
        return;
      }
      setError(null);
      router.refresh();
    });
  };

  if (invitations.length === 0) {
    return <p className="text-sm text-muted">{emptyText}</p>;
  }

  return (
    <div>
      {error && <p className="mb-3 text-sm font-bold text-rose-600">{error}</p>}
      <ul className="space-y-3">
        {invitations.map((inv) => (
          <li key={inv.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              {showStudent && <span className="text-sm font-bold">{inv.studentName}</span>}
              <span className="text-sm text-ink-soft">
                {inv.authorName} ({inv.authorRole === "student" ? "학생 본인" : "보호자"})
              </span>
              <Badge tone={invitationStatusTone(inv.status)}>{invitationStatusLabel(inv.status)}</Badge>
              {inv.status === "sent" && !inv.isOpen && <Badge tone="warning">기한 경과</Badge>}
              {inv.reviewId && <Badge tone="soft">수정 요청 링크</Badge>}
            </div>
            <p className="mt-1 text-xs text-muted">
              발송 {formatDateTime(inv.sentAt)}
              {inv.status === "sent" && inv.expiresAt && ` · 기한 ${formatDateTime(inv.expiresAt)}`}
              {inv.submittedAt && ` · 제출 ${formatDateTime(inv.submittedAt)}`}
              {inv.closedAt && ` · 닫힘 ${formatDateTime(inv.closedAt)}`}
            </p>
            {inv.closeReason && <p className="mt-0.5 text-xs text-muted">사유: {inv.closeReason}</p>}
            {inv.status === "sent" && (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => resend(inv)}
                  className="text-xs font-bold text-brand-700 hover:underline disabled:opacity-50"
                >
                  재발급(링크 회전)
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => close(inv)}
                  className="text-xs font-bold text-rose-600 hover:underline disabled:opacity-50"
                >
                  닫기
                </button>
              </div>
            )}
            {issued?.id === inv.id && <IssuedReviewLink link={issued.link} warnings={issued.warnings} />}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">
        링크 원문은 발급 직후 한 번만 볼 수 있습니다(저장되는 값은 해시뿐). 다시 전달해야 하면
        재발급으로 새 링크를 만드세요 — 이전 링크는 즉시 무효가 됩니다.
      </p>
    </div>
  );
}
