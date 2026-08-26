"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import type { IntakeFormKind, IntakeFormStatus } from "@/lib/types";
import {
  DUPLICATE_CHECK_HINT,
  DUPLICATE_CHECK_LABEL,
  INTAKE_KIND_LABEL,
  INTAKE_KIND_SHORT_LABEL,
  intakeFormStatusLabel,
  intakeFormStatusTone,
} from "./intake-constants";
import type { IntakeFormIssueResult } from "./actions";
import { closeIntakeForm, issueIntakeForm, resendIntakeForm } from "./actions";

// 상담 상세의 「신청폼」 카드 — 시범·정규 신청폼 발급·재발급(링크 회전)·닫기.
// 정본: docs/flow-canon/01_atlas_01_intake.md C-05(상담 결과)·T-01(시범 신청폼)·R-01(정규 신청폼)
//      · 03_scenarios_133.md 검수 5(중복 판단 전 발송 금지)·6(다음 단계 하나만 활성)·7(이전 폼 닫힘)
//
// 이 파일은 화면만 담당한다 — 게이트 판정·이전 폼 닫기·토큰 발급·감사·발송은 전부 actions.ts에 있다.
// 체크박스는 발급 버튼을 여는 UI 게이트일 뿐이고, 실제 거부는 서버 액션이 한다(UI만의 게이트는 우회된다).

/** 화면에 필요한 폼 한 건 — lib/data/intake.ts IntakeForm의 표시용 부분집합(payload는 쓰지 않는다). */
export interface IntakeFormView {
  id: string;
  kind: IntakeFormKind;
  status: IntakeFormStatus;
  sentAt: string | null;
  submittedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  expiresAt: string | null;
  isExpired: boolean;
}

/** 이 상담에 열려 있는 다른 다음 단계 — 검수 6("하나만 활성")이 지금 지켜지는지 보여준다. */
export interface OpenBranchSummary {
  activeTrials: number;
  openEnrollments: number;
  openOffers: number;
}

/** 서버 모듈(lib/data/crm.ts)을 클라이언트 번들에 끌어오지 않으려고 표시용 포맷만 여기 둔다. */
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

/**
 * 방금 발급된 링크 — 이 화면을 벗어나면 다시 볼 수 없다(intake_forms에는 해시만 남는다).
 * 다시 필요하면 재발급(링크 회전)뿐이고, 그때 이전 링크는 무효가 된다.
 */
function IssuedLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 rounded-panel border border-brand-100 bg-brand-50 p-3">
      <p className="text-xs font-bold text-brand-700">
        신청폼 링크가 발급되었습니다. 새로고침하면 다시 볼 수 없으니 지금 복사해 두세요.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-panel border border-line bg-white px-3 py-2 text-xs text-ink-soft"
        />
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // 클립보드 접근 불가 — 직접 선택·복사할 수 있으므로 조용히 무시한다.
            }
          }}
          className="min-h-11 shrink-0 rounded-panel bg-brand-600 px-3 text-xs font-bold text-white hover:bg-brand-700"
        >
          {copied ? "복사됨" : "링크 복사"}
        </button>
      </div>
    </div>
  );
}

export function IntakeFormsCard({
  consultationId,
  forms,
  openBranches,
}: {
  consultationId: string;
  /** 발급 이력 전체 — 발송 최신순. 닫힌·제출된 이력도 남겨 결과 변경 경위를 대조한다. */
  forms: IntakeFormView[];
  openBranches: OpenBranchSummary;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [duplicateChecked, setDuplicateChecked] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const openForm = forms.find((f) => f.status === "sent") ?? null;
  const otherBranchCount =
    openBranches.activeTrials + openBranches.openEnrollments + openBranches.openOffers;

  const apply = (result: IntakeFormIssueResult) => {
    if (!result.ok) {
      setError(result.error ?? "처리에 실패했습니다.");
      return;
    }
    setError(null);
    setLink(result.link ?? null);
    setWarnings(result.warnings ?? []);
    // 발급 직후 확인 선언을 초기화한다 — 다음 발급은 다시 확인하고 눌러야 한다(검수 5).
    setDuplicateChecked(false);
    router.refresh();
  };

  const issue = (kind: IntakeFormKind) => {
    const previous = openForm;
    const confirmText = previous
      ? `${INTAKE_KIND_LABEL[kind]}을(를) 발급하면 열려 있는 ${INTAKE_KIND_LABEL[previous.kind]} 링크가 즉시 무효가 됩니다. 계속할까요?`
      : `${INTAKE_KIND_LABEL[kind]}을(를) 발급하고 신청자에게 링크를 발송할까요?`;
    if (!window.confirm(confirmText)) return;
    startTransition(async () => {
      apply(await issueIntakeForm(consultationId, kind, duplicateChecked));
    });
  };

  const resend = (form: IntakeFormView) => {
    if (
      !window.confirm(
        "재발급하면 새 링크가 나가고 지금 링크는 즉시 무효가 됩니다. 계속할까요?",
      )
    ) {
      return;
    }
    startTransition(async () => {
      apply(await resendIntakeForm(form.id));
    });
  };

  const close = (form: IntakeFormView) => {
    const reason = window.prompt(
      `${INTAKE_KIND_LABEL[form.kind]}을(를) 닫는 사유를 입력해 주세요. (예: 상담 종결 · 신청자 철회 · 결과 변경)`,
      "",
    );
    if (reason === null) return;
    if (!reason.trim()) {
      setError("닫는 사유를 입력해 주세요.");
      return;
    }
    startTransition(async () => {
      const result = await closeIntakeForm(form.id, reason);
      if (!result.ok) {
        setError(result.error ?? "닫기에 실패했습니다.");
        return;
      }
      setError(null);
      setLink(null);
      setWarnings([]);
      router.refresh();
    });
  };

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-soft">신청폼</h2>
        {openForm ? (
          <Badge tone="brand">
            {INTAKE_KIND_SHORT_LABEL[openForm.kind]} 폼 발송됨
          </Badge>
        ) : (
          <Badge tone="soft">열린 폼 없음</Badge>
        )}
      </div>

      <p className="text-sm text-muted">
        상담 결과를 정하면 해당 신청폼 링크를 신청자에게 발송합니다. 다음 단계는 하나만
        열립니다 — 새 폼을 발급하면 이전 폼과 열린 자리 제안이 함께 정리됩니다.
      </p>

      {otherBranchCount > 0 && (
        <p className="mt-3 rounded-panel border border-amber-100 bg-amber-50 p-3 text-xs font-bold text-amber-700">
          이 상담에 다른 다음 단계가 열려 있습니다 —
          {openBranches.activeTrials > 0 && ` 시범 회차 ${openBranches.activeTrials}건`}
          {openBranches.openEnrollments > 0 && ` 등록 ${openBranches.openEnrollments}건`}
          {openBranches.openOffers > 0 && ` 자리 제안 ${openBranches.openOffers}건`}. 새 폼을
          발급하기 전에 해당 화면에서 정리 여부를 확인해 주세요.
        </p>
      )}

      {/* 검수 5의 게이트 — 확인 선언 전에는 발급 버튼이 열리지 않는다. 서버도 같은 조건으로 거부한다. */}
      <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-panel border border-line bg-soft p-3">
        <input
          type="checkbox"
          checked={duplicateChecked}
          disabled={pending}
          onChange={(e) => setDuplicateChecked(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
        />
        <span>
          <span className="block text-sm font-bold text-ink">{DUPLICATE_CHECK_LABEL}</span>
          <span className="mt-0.5 block text-xs text-muted">{DUPLICATE_CHECK_HINT}</span>
        </span>
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || !duplicateChecked}
          onClick={() => issue("trial")}
          className={buttonClass("primary", "sm")}
        >
          {pending ? "처리 중..." : "시범 신청폼 발급"}
        </button>
        <button
          type="button"
          disabled={pending || !duplicateChecked}
          onClick={() => issue("regular")}
          className={buttonClass("outline", "sm")}
        >
          {pending ? "처리 중..." : "정규 신청폼 발급"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm font-bold text-rose-600">{error}</p>}

      {link && <IssuedLink link={link} />}

      {warnings.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-panel border border-amber-100 bg-amber-50 p-3">
          {warnings.map((w) => (
            <li key={w} className="text-xs font-bold text-amber-700">
              {w}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 border-t border-line pt-4">
        <h3 className="mb-3 text-xs font-semibold text-ink-soft">발급 이력</h3>
        {forms.length === 0 ? (
          <p className="text-sm text-muted">아직 발급한 신청폼이 없습니다.</p>
        ) : (
          <ul className="space-y-3">
            {forms.map((form) => (
              <li
                key={form.id}
                className="border-b border-line pb-3 last:border-0 last:pb-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold">{INTAKE_KIND_LABEL[form.kind]}</span>
                  <Badge tone={intakeFormStatusTone(form.status)}>
                    {intakeFormStatusLabel(form.status)}
                  </Badge>
                  {form.isExpired && <Badge tone="warning">기한 경과</Badge>}
                </div>
                <p className="mt-1 text-xs text-muted">
                  발송 {formatDateTime(form.sentAt)}
                  {form.submittedAt && ` · 제출 ${formatDateTime(form.submittedAt)}`}
                  {form.status === "sent" &&
                    form.expiresAt &&
                    ` · 기한 ${formatDateTime(form.expiresAt)}`}
                  {form.closedAt && ` · 닫힘 ${formatDateTime(form.closedAt)}`}
                </p>
                {form.closeReason && (
                  <p className="mt-0.5 text-xs text-muted">사유: {form.closeReason}</p>
                )}
                {form.status === "sent" && (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {/* 링크 원문은 발급 순간에만 존재한다 — 다시 보내려면 회전(새 링크)뿐이다. */}
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => resend(form)}
                      className="text-xs font-bold text-brand-700 hover:underline disabled:opacity-50"
                    >
                      재발급(링크 회전)
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => close(form)}
                      className="text-xs font-bold text-rose-600 hover:underline disabled:opacity-50"
                    >
                      닫기
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">
          링크 원문은 발급 직후 한 번만 볼 수 있습니다(저장되는 값은 해시뿐). 이미 발송한 링크를
          다시 전달해야 하면 재발급을 눌러 새 링크를 만드세요 — 이전 링크는 즉시 무효가 됩니다.
        </p>
      </div>
    </Card>
  );
}
