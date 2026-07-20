"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { buttonClass } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";
import type { Rates } from "@/lib/types";

type Mode = "inperson" | "video";

const HOURS = ["2", "2.5", "3", "3.5", "4", "4.5", "5", "5.5", "6"] as const;
const FREQS = ["1", "2", "3", "4", "5", "6", "7"] as const;
const WEEKS = 4;

// 기획 고정 계산식: 시간당 단가 × 회당 시간 × 주당 횟수 × 4주.
// 인수 기준 5케이스로 검증(예: 대면 2.5h·주2회 → 1,600,000원).

export function RateCalculator({ rates }: { rates: Rates }) {
  const [mode, setMode] = useState<Mode>("inperson");
  const [hours, setHours] = useState<(typeof HOURS)[number]>("2.5");
  const [freq, setFreq] = useState<(typeof FREQS)[number]>("2");

  const rate = mode === "inperson" ? rates.inperson : rates.video;
  const hoursNum = Number(hours);
  const freqNum = Number(freq);
  const total = rate * hoursNum * freqNum * WEEKS;

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
          <Select
            value={hours}
            onChange={(e) => setHours(e.target.value as (typeof HOURS)[number])}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}시간
              </option>
            ))}
          </Select>
        </Field>

        <Field label="주당 횟수">
          <Select
            value={freq}
            onChange={(e) => setFreq(e.target.value as (typeof FREQS)[number])}
          >
            {FREQS.map((f) => (
              <option key={f} value={f}>
                주 {f}회
              </option>
            ))}
          </Select>
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
