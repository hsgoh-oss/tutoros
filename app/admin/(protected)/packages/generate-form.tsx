"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import type { GenerateResult } from "./actions";

// 회차 생성 폼 — 공용 SubmitForm 대신 따로 두는 이유는 하나다: 정본 L-01의 마지막 단계가
// "전체 결과 안내"라서 확정·충돌·기존 건수를 화면에 그대로 보여줘야 한다. SubmitForm은
// 오류 문구만 렌더하므로 성공 결과가 사라진다.
// 잘림(요청 수 > 실제 후보)도 함께 알린다 — 조용히 줄이면 "다 만들었다"로 읽힌다.

export function GenerateSessionsForm({
  action,
  defaultCount,
}: {
  action: (formData: FormData) => Promise<GenerateResult>;
  defaultCount: number;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<GenerateResult | null, FormData>(
    async (_prev, formData) => action(formData),
    null,
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="만들 회차 수" required>
          <Input
            name="count"
            type="number"
            min={1}
            max={200}
            required
            defaultValue={defaultCount}
          />
        </Field>
        <Field label="건너뛸 날" hint="YYYY-MM-DD, 쉼표·공백 구분 (휴무·공휴일)">
          <Input name="skipDates" placeholder="2026-09-28, 2026-10-03" />
        </Field>
      </div>

      {state && !state.ok && (
        <p className="mt-3 text-sm font-bold text-rose-600">{state.error}</p>
      )}

      {state?.ok && (
        <div className="mt-3 rounded-lg border border-line bg-soft px-4 py-3 text-sm">
          <p className="font-bold text-ink">
            후보 {state.total}건 — 확정 {state.confirmed} · 충돌 {state.conflicted} · 기존{" "}
            {state.skipped}
          </p>
          {(state.conflicted ?? 0) > 0 && (
            <p className="mt-1 text-xs text-orange-700">
              충돌 {state.conflicted}건은 확정하지 않았습니다. 아래 목록에서 재협의해 시각을
              조정하거나 취소하세요.
            </p>
          )}
          {state.truncatedTo !== undefined && (
            <p className="mt-1 text-xs font-bold text-rose-600">
              요청한 회차 수보다 적게 만들어졌습니다({state.truncatedTo}건) — 반복 조건으로 시작일
              +2년 안에 만들 수 있는 회차가 그만큼입니다.
            </p>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className={`${buttonClass("primary", "md")} mt-4`}
      >
        {pending ? "생성 중..." : "회차 생성"}
      </button>
    </form>
  );
}
