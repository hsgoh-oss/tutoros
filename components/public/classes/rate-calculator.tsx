"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { buttonClass } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import type { Rates } from "@/lib/types";

type Mode = "inperson" | "video";

// 기획 고정 범위: 회당 2~6시간(0.5 단위), 주 1~7회.
const HOURS_MIN = 2;
const HOURS_MAX = 6;
const HOURS_STEP = 0.5;
const FREQ_MIN = 1;
const FREQ_MAX = 7;
const FREQ_STEP = 1;
const WEEKS = 4;

// 기획 고정 계산식: 시간당 단가 × 회당 시간 × 주당 횟수 × 4주.
// 인수 기준 5케이스로 검증(예: 대면 2.5h·주2회 → 1,600,000원).

function Stepper({
  value,
  min,
  max,
  step,
  onChange,
  format,
  decLabel,
  incLabel,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  format: (value: number) => string;
  decLabel: string;
  incLabel: string;
}) {
  const atMin = value <= min;
  const atMax = value >= max;
  const stepBtn =
    "flex min-h-12 w-12 shrink-0 items-center justify-center text-2xl font-black text-brand-600 transition-colors hover:bg-brand-50 disabled:text-line disabled:hover:bg-transparent";

  return (
    <div className="flex items-stretch overflow-hidden rounded-panel border border-line bg-white">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}
        disabled={atMin}
        aria-label={decLabel}
        className={stepBtn}
      >
        −
      </button>
      <div className="flex min-h-12 flex-1 items-center justify-center border-x border-line px-2 text-[15px] font-extrabold text-ink">
        {format(value)}
      </div>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, +(value + step).toFixed(2)))}
        disabled={atMax}
        aria-label={incLabel}
        className={stepBtn}
      >
        +
      </button>
    </div>
  );
}

export function RateCalculator({ rates }: { rates: Rates }) {
  const [mode, setMode] = useState<Mode>("inperson");
  const [hours, setHours] = useState(2.5);
  const [freq, setFreq] = useState(2);

  const rate = mode === "inperson" ? rates.inperson : rates.video;
  const total = rate * hours * freq * WEEKS;

  const formula = useMemo(
    () =>
      `시간당 ${rate.toLocaleString()}원 × ${hours}시간 × 주 ${freq}회 × ${WEEKS}주 = ${total.toLocaleString()}원`,
    [rate, hours, freq, total],
  );

  const consultHref = `/consult?mode=${mode}&hours=${hours}&freq=${freq}`;

  return (
    <div id="calculator" className="rounded-card border border-line bg-white p-8 shadow-card md:p-10">
      <div className="grid gap-5 md:grid-cols-3">
        <Field label="수업 방식">
          <div className="flex gap-2">
            {(
              [
                ["inperson", "대면"],
                ["video", "화상"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={cn(
                  "flex min-h-12 flex-1 items-center justify-center rounded-panel border px-4 text-sm font-extrabold transition-colors",
                  mode === value
                    ? "border-brand-600 bg-brand-50 text-brand-700"
                    : "border-line text-muted hover:border-brand-200",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="회당 시간" hint="최소 2시간부터 0.5시간 단위">
          <Stepper
            value={hours}
            min={HOURS_MIN}
            max={HOURS_MAX}
            step={HOURS_STEP}
            onChange={setHours}
            format={(v) => `${v}시간`}
            decLabel="회당 시간 30분 줄이기"
            incLabel="회당 시간 30분 늘리기"
          />
        </Field>

        <Field label="주당 횟수">
          <Stepper
            value={freq}
            min={FREQ_MIN}
            max={FREQ_MAX}
            step={FREQ_STEP}
            onChange={setFreq}
            format={(v) => `주 ${v}회`}
            decLabel="주당 횟수 줄이기"
            incLabel="주당 횟수 늘리기"
          />
        </Field>
      </div>

      <div className="mt-8 rounded-panel bg-soft p-6 md:p-8">
        <p className="text-sm font-extrabold text-brand-600">4주 정액 수업료</p>
        <p className="mt-2 text-[36px] font-black tracking-[-0.03em] text-ink md:text-[46px]">
          {total.toLocaleString()}
          <span className="ml-1 text-lg font-bold text-muted">원</span>
        </p>
        <p className="mt-2 text-sm tracking-tight text-muted">{formula}</p>
      </div>

      <Link
        href={consultHref}
        className={cn(buttonClass("primary", "lg"), "mt-8 w-full md:w-auto")}
      >
        이 구성으로 상담 신청
      </Link>
    </div>
  );
}
