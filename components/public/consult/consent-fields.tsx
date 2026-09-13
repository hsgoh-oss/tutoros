"use client";

import Link from "next/link";
import type { FieldErrors, Path, UseFormRegister } from "react-hook-form";
import { cn } from "@/lib/cn";

// 공개 폼 공용 동의 블록 — 상담 신청서(consult-form.tsx)와 시범·정규 신청서(intake-form.tsx)가 같은 것을 쓴다.
//
// 동의 구조(2026-09 확정):
//   이용약관 — 필수 · 상담 개인정보 처리 — 필수 · AI 처리·국외이전 — 선택 · 마케팅 — 선택
// 후기·사례 공개(건별 선택)·사례 이미지 공개(이미지가 있을 때)·미성년 게시(법정대리인 동의)는
// 상담이 아니라 후기 작성 폼(components/public/review-submit)에서 그 건에 대해서만 받는다 —
// 상담 단계에서 미리 받아 두는 포괄 동의는 "건별"이 아니므로 여기 두지 않는다.
//
// 필수·선택은 라벨 앞 칩으로 구분하고, 선택 항목은 체크하지 않아도 접수가 그대로 진행된다는 사실을
// 항목 옆 한 줄로 말한다 — "거절할 수 있다"가 보이지 않는 동의는 동의가 아니다.

export interface ConsentValues {
  termsConsent: boolean;
  privacyConsent: boolean;
  overseasAiConsent: boolean;
  marketingConsent: boolean;
}

type ConsentKey = keyof ConsentValues;

const ITEMS: {
  key: ConsentKey;
  required: boolean;
  label: string;
  detail?: string;
  href?: string;
}[] = [
  {
    key: "termsConsent",
    required: true,
    label: "이용약관 동의",
    href: "/terms",
  },
  {
    key: "privacyConsent",
    required: true,
    label: "상담 개인정보 처리 동의",
    href: "/privacy",
  },
  {
    key: "overseasAiConsent",
    required: false,
    label: "AI 처리·국외이전 동의",
    detail:
      "AI 리포트 작성을 위해 이름을 가린 학습 기록을 해외 AI 사업자에 전달합니다. 동의하지 않으셔도 상담·수업에는 영향이 없고, 리포트는 선생님이 직접 작성합니다.",
    href: "/privacy",
  },
  {
    key: "marketingConsent",
    required: false,
    label: "마케팅 수신 동의",
    detail: "수업 안내·이벤트 소식을 카카오톡·문자로 받습니다. 언제든 수신 거부할 수 있습니다.",
  },
];

export function ConsentFields<T extends ConsentValues>({
  register,
  errors,
  values,
  onToggleAll,
  idPrefix,
  privacyLabel,
  footnote,
}: {
  register: UseFormRegister<T>;
  errors: FieldErrors<T>;
  values: ConsentValues;
  onToggleAll: (checked: boolean) => void;
  idPrefix: string;
  /** 상담 개인정보 처리 항목의 라벨을 폼별로 바꿀 때(예: 위탁 문구 포함). */
  privacyLabel?: string;
  footnote?: string;
}) {
  const consentErrors = errors as FieldErrors<ConsentValues>;
  const allChecked = ITEMS.every((item) => values[item.key]);
  const requiredChecked = ITEMS.filter((i) => i.required).every((item) => values[item.key]);

  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-3 flex items-baseline justify-between gap-3">
        <span className="text-lg font-black tracking-tight text-ink">동의</span>
        <span className="text-xs font-bold text-muted">
          {requiredChecked ? "필수 동의 완료" : "필수 2개 · 선택 2개"}
        </span>
      </legend>

      {/* 전체 동의 — 필수·선택을 한 번에. 선택을 원치 않으면 아래에서 개별로 푼다. */}
      <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-[var(--radius-panel)] border border-line-strong bg-soft px-4 py-3">
        <input
          type="checkbox"
          checked={allChecked}
          onChange={(e) => onToggleAll(e.target.checked)}
          className="h-5 w-5 rounded border-line-strong text-brand-600 focus:ring-brand-200"
          aria-label="전체 동의"
        />
        <span className="text-[15px] font-extrabold tracking-[-0.02em] text-ink">
          전체 동의
        </span>
        <span className="ml-auto text-xs font-bold text-muted">선택 항목 포함</span>
      </label>

      <ul className="m-0 mt-2 list-none divide-y divide-line p-0">
        {ITEMS.map((item) => {
          const error = consentErrors[item.key]?.message;
          const errorId = `${idPrefix}-${item.key}-error`;
          return (
            <li key={item.key} className="py-1">
              <label className="flex min-h-12 cursor-pointer items-start gap-3 py-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border-line text-brand-600 focus:ring-brand-200"
                  {...register(item.key as Path<T>)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex rounded-[var(--radius-sm)] px-1.5 py-0.5 text-xs font-extrabold tracking-tight",
                        item.required
                          ? "bg-brand-50 text-brand-700"
                          : "bg-soft text-muted",
                      )}
                    >
                      {item.required ? "필수" : "선택"}
                    </span>
                    <span className="text-sm font-bold text-ink-soft">
                      {item.key === "privacyConsent" && privacyLabel ? privacyLabel : item.label}
                    </span>
                    {item.href && (
                      <Link
                        href={item.href}
                        target="_blank"
                        className="inline-flex min-h-9 items-center px-1 text-xs font-bold text-brand-600 underline underline-offset-2"
                      >
                        내용 보기
                      </Link>
                    )}
                  </span>
                  {item.detail && (
                    <span className="mt-1 block text-xs leading-relaxed text-muted">
                      {item.detail}
                    </span>
                  )}
                  {error && (
                    <span
                      id={errorId}
                      role="alert"
                      className="mt-1 block text-xs font-semibold text-rose-600"
                    >
                      {error}
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {footnote && (
        <p className="mt-3 rounded-[var(--radius-panel)] bg-soft px-4 py-3 text-xs leading-relaxed text-muted">
          {footnote}
        </p>
      )}
    </fieldset>
  );
}
