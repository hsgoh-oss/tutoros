// ai_reports CRUD 헬퍼 — lib/data/crm.ts와 동일 스타일(snake_case DB ↔ camelCase 앱).
import { createServiceClient } from "@/lib/supabase/server";
import type { AiReport, ReportAudience, ReportType } from "@/lib/types";

interface AiReportRow {
  id: string;
  student_id: string | null;
  type: ReportType;
  audience: ReportAudience;
  depth: "basic" | "deep";
  content: string;
  model_used: string | null;
  token_usage: number | null;
  status: AiReport["status"];
  sent_at: string | null;
  created_at: string;
}

interface AiReportJoinRow extends AiReportRow {
  students: { name: string } | null;
}

function mapReport(row: AiReportRow): AiReport {
  return {
    id: row.id,
    studentId: row.student_id,
    type: row.type,
    audience: row.audience,
    depth: row.depth,
    content: row.content,
    modelUsed: row.model_used,
    tokenUsage: row.token_usage,
    status: row.status,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

export interface ReportListItem extends AiReport {
  studentName: string | null;
}

export interface ReportFilters {
  studentId?: string;
  type?: ReportType;
}

export async function listReports(
  tenantId: string,
  filters: ReportFilters = {},
): Promise<ReportListItem[]> {
  const db = createServiceClient();
  if (!db) return [];
  let query = db
    .from("ai_reports")
    .select("*, students(name)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (filters.studentId) query = query.eq("student_id", filters.studentId);
  if (filters.type) query = query.eq("type", filters.type);
  const { data } = await query;
  return (data ?? []).map((r) => {
    const row = r as AiReportJoinRow;
    return { ...mapReport(row), studentName: row.students?.name ?? null };
  });
}

export async function getReport(
  tenantId: string,
  id: string,
): Promise<AiReport | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("ai_reports")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  return data ? mapReport(data as AiReportRow) : null;
}

export interface CreateReportInput {
  tenantId: string;
  studentId: string | null;
  type: ReportType;
  audience: ReportAudience;
  depth: "basic" | "deep";
  content: string;
  modelUsed: string | null;
  tokenUsage: number | null;
}

/** 신규 리포트 저장(항상 status=draft) — reports/actions.ts와 consultations/actions.ts(상담 브리핑) 공용. */
export async function createReportRow(
  input: CreateReportInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const db = createServiceClient();
  if (!db) {
    return { ok: false, error: "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다." };
  }
  const { data, error } = await db
    .from("ai_reports")
    .insert({
      tenant_id: input.tenantId,
      student_id: input.studentId,
      type: input.type,
      audience: input.audience,
      depth: input.depth,
      content: input.content,
      model_used: input.modelUsed,
      token_usage: input.tokenUsage,
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[reports] insert failed", error);
    return { ok: false, error: "리포트 저장 중 오류가 발생했습니다." };
  }
  return { ok: true, id: data.id };
}
