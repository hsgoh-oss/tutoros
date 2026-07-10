"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import type { CrmActionResult } from "@/components/admin/crm/types";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";

interface GradeFormPayload {
  studentId: string;
  examName: string;
  examDate: string | null;
  rawScore: number | null;
  percentile: number | null;
  grade: string | null;
}

function parseNullableNumber(raw: FormDataEntryValue | null): number | null {
  const str = String(raw ?? "").trim();
  if (!str) return null;
  const num = Number(str);
  return Number.isFinite(num) ? num : null;
}

function parseGradeForm(formData: FormData): GradeFormPayload | { error: string } {
  const studentId = String(formData.get("studentId") ?? "").trim();
  const examName = String(formData.get("examName") ?? "").trim();
  if (!studentId) return { error: "학생을 선택해 주세요." };
  if (!examName) return { error: "시험명을 입력해 주세요." };

  return {
    studentId,
    examName,
    examDate: String(formData.get("examDate") ?? "").trim() || null,
    rawScore: parseNullableNumber(formData.get("rawScore")),
    percentile: parseNullableNumber(formData.get("percentile")),
    grade: String(formData.get("grade") ?? "").trim() || null,
  };
}

function revalidateGrade(id: string) {
  revalidatePath("/admin/grades");
  revalidatePath(`/admin/grades/${id}`);
}

export async function createGrade(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const parsed = parseGradeForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const db = createServiceClient()!;
  const { error } = await db.from("grade_records").insert({
    tenant_id: session.tenantId,
    student_id: parsed.studentId,
    exam_name: parsed.examName,
    raw_score: parsed.rawScore,
    percentile: parsed.percentile,
    grade: parsed.grade,
    exam_date: parsed.examDate,
  });
  if (error) {
    console.error("[grades] insert failed", error);
    return { ok: false, error: "성적 등록 중 오류가 발생했습니다." };
  }

  revalidatePath("/admin/grades");
  revalidatePath(`/admin/students/${parsed.studentId}`);
  return { ok: true };
}

export async function updateGrade(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  const parsed = parseGradeForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const db = createServiceClient()!;
  const { error } = await db
    .from("grade_records")
    .update({
      student_id: parsed.studentId,
      exam_name: parsed.examName,
      raw_score: parsed.rawScore,
      percentile: parsed.percentile,
      grade: parsed.grade,
      exam_date: parsed.examDate,
    })
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[grades] update failed", error);
    return { ok: false, error: "성적 수정 중 오류가 발생했습니다." };
  }

  revalidateGrade(id);
  revalidatePath(`/admin/students/${parsed.studentId}`);
  return { ok: true };
}

export async function deleteGrade(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const { error } = await db
    .from("grade_records")
    .delete()
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[grades] delete failed", error);
    return { ok: false, error: "성적 삭제 중 오류가 발생했습니다." };
  }

  revalidatePath("/admin/grades");
  return { ok: true };
}
