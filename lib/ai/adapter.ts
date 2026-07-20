// AI 4단 모델 어댑터 — 모델명은 전부 환경변수(REPORT_AI_*)로 주입해 코드 수정 없이 교체(기획서 6-4).
// 지금은 라우팅·폴백 골격만 — 실제 생성·품질검증·가명화는 W6.

import type { ReportType } from "@/lib/types";

/** 리포트 유형별 환경변수 키 (기획 고정: REPORT_AI_*) */
const ENV_KEY: Record<ReportType | "monthly_deep", string> = {
  lesson: "REPORT_AI_LESSON",
  weekly: "REPORT_AI_WEEKLY",
  monthly: "REPORT_AI_MONTHLY",
  monthly_deep: "REPORT_AI_MONTHLY_DEEP",
  exam: "REPORT_AI_EXAM",
  consult_brief: "REPORT_AI_CONSULT",
};

export interface ModelRoute {
  model: string | null;
  fallback: string | null;
  configured: boolean;
}

export function resolveModel(
  type: ReportType,
  depth: "basic" | "deep" = "basic",
): ModelRoute {
  const key =
    type === "monthly" && depth === "deep"
      ? ENV_KEY.monthly_deep
      : ENV_KEY[type];
  const model = process.env[key] ?? null;
  const fallback = process.env.AI_FALLBACK_MODEL ?? null;
  return { model, fallback, configured: Boolean(model) };
}
