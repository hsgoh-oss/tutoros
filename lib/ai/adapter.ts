// AI 4단 모델 어댑터 — 기획서 6-4. 모델명은 전부 환경변수, 코드 수정 없이 교체.
// 본 파일은 어댑터 계약(환경변수 키·라우팅·폴백 구조)만 확정한 골격이며,
// 실제 생성·품질검증 3층·가명화 파이프라인은 W6(AI 리포트 모듈)에서 구현한다.

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
