import { Fragment } from "react";
import type { GradePathStage } from "@/lib/defaults";

// 9등급 → 1등급 성장 로드맵. 모바일은 세로(↓), 데스크톱은 가로(→) 흐름.
export function GradePath({ stages }: { stages: GradePathStage[] }) {
  return (
    <ol className="flex flex-col gap-4 md:flex-row md:items-stretch md:gap-3">
      {stages.map((stage, i) => (
        <Fragment key={stage.title}>
          <li className="flex flex-1 flex-col gap-3 rounded-card border border-line bg-white p-6 shadow-card">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center rounded-full bg-brand-50 px-3 py-1 text-xs font-extrabold tracking-tight text-brand-700">
                {stage.range}
              </span>
              <span className="text-xs font-black tracking-tight text-brand-200">
                {String(i + 1).padStart(2, "0")}
              </span>
            </div>
            <h3 className="text-lg font-black tracking-tight text-ink">
              {stage.title}
            </h3>
            <p className="text-[15px] leading-[1.7] tracking-tight text-muted">
              {stage.desc}
            </p>
          </li>
          {i < stages.length - 1 && (
            <li
              aria-hidden
              className="flex shrink-0 items-center justify-center text-2xl font-black leading-none text-brand-200"
            >
              <span className="md:hidden">↓</span>
              <span className="hidden md:inline">→</span>
            </li>
          )}
        </Fragment>
      ))}
    </ol>
  );
}
