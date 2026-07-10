// AI 리포트 생성 — resolveModel(lib/ai/adapter.ts)로 결정된 모델을 Anthropic Messages API로 직접 호출.
// 실패(4xx/5xx/타임아웃 30s) 시 AI_FALLBACK_MODEL로 1회만 재시도한다.

import { resolveModel } from "./adapter";
import type { ReportType } from "@/lib/types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 2048;
const AI_NOT_CONFIGURED_ERROR = "AI 모델 미설정 — 환경변수 REPORT_AI_*";

export interface GenerateReportResult {
  ok: boolean;
  content?: string;
  modelUsed?: string;
  tokenUsage?: number;
  error?: string;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicMessageResponse {
  content?: AnthropicContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

type CallResult =
  | { ok: true; text: string; tokenUsage: number }
  | { ok: false; error: string };

async function callAnthropic(model: string, prompt: string): Promise<CallResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: AI_NOT_CONFIGURED_ERROR };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `AI 호출 실패(${res.status}): ${body.slice(0, 200)}` };
    }

    const data = (await res.json()) as AnthropicMessageResponse;
    const text = (data.content ?? [])
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (!text) return { ok: false, error: "AI 응답이 비어 있습니다." };

    const tokenUsage = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
    return { ok: true, text, tokenUsage };
  } catch (err) {
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    const timedOut = err instanceof Error && err.name === "AbortError";
    return { ok: false, error: timedOut ? "AI 호출 타임아웃(30초)" : `AI 호출 오류: ${message}` };
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateReport(
  type: ReportType,
  depth: "basic" | "deep",
  prompt: string,
): Promise<GenerateReportResult> {
  const route = resolveModel(type, depth);
  if (!route.configured || !route.model) {
    return { ok: false, error: AI_NOT_CONFIGURED_ERROR };
  }

  const primary = await callAnthropic(route.model, prompt);
  if (primary.ok) {
    return {
      ok: true,
      content: primary.text,
      modelUsed: route.model,
      tokenUsage: primary.tokenUsage,
    };
  }

  if (route.fallback) {
    const fallback = await callAnthropic(route.fallback, prompt);
    if (fallback.ok) {
      return {
        ok: true,
        content: fallback.text,
        modelUsed: route.fallback,
        tokenUsage: fallback.tokenUsage,
      };
    }
    return { ok: false, error: fallback.error };
  }

  return { ok: false, error: primary.error };
}
