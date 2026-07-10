"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { nextSessionNumber } from "@/lib/data/crm";
import type { CrmActionResult } from "@/components/admin/crm/types";
import { RATING_OPTIONS } from "./constants";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";

interface LessonFormPayload {
  studentId: string;
  lessonDate: string;
  content: string;
  homework: string | null;
  concentration: number | null;
  attitude: number | null;
  absent: boolean;
}

function parseRating(raw: FormDataEntryValue | null): number | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const n = Number(value);
  return RATING_OPTIONS.includes(n) ? n : null;
}

function parseLessonForm(formData: FormData): LessonFormPayload | { error: string } {
  const studentId = String(formData.get("studentId") ?? "").trim();
  const lessonDate = String(formData.get("lessonDate") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  if (!studentId) return { error: "학생을 선택해 주세요." };
  if (!lessonDate) return { error: "수업일을 입력해 주세요." };
  if (!content) return { error: "수업 내용을 입력해 주세요." };

  return {
    studentId,
    lessonDate,
    content,
    homework: String(formData.get("homework") ?? "").trim() || null,
    concentration: parseRating(formData.get("concentration")),
    attitude: parseRating(formData.get("attitude")),
    absent: formData.get("absent") === "on",
  };
}

/**
 * 수업 기록 신규 등록.
 * session_number(회차)는 입력받지 않고 해당 학생의 기존 기록 수 + 1로 서버에서 자동 계산(기획 요구).
 */
export async function createLesson(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const parsed = parseLessonForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const sessionNumber = await nextSessionNumber(session.tenantId, parsed.studentId);

  const db = createServiceClient()!;
  const { error } = await db.from("lessons").insert({
    tenant_id: session.tenantId,
    student_id: parsed.studentId,
    lesson_date: parsed.lessonDate,
    session_number: sessionNumber,
    content: parsed.content,
    homework: parsed.homework,
    concentration: parsed.concentration,
    attitude: parsed.attitude,
    absent: parsed.absent,
  });
  if (error) {
    console.error("[lessons] insert failed", error);
    return { ok: false, error: "수업 기록 등록 중 오류가 발생했습니다." };
  }

  revalidatePath("/admin/lessons");
  return { ok: true };
}

/** 수업 기록 수정 — 학생(student_id)·회차(session_number)는 등록 시점에 고정되어 수정 대상에서 제외한다. */
export async function updateLesson(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  const parsed = parseLessonForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const db = createServiceClient()!;
  const { error } = await db
    .from("lessons")
    .update({
      lesson_date: parsed.lessonDate,
      content: parsed.content,
      homework: parsed.homework,
      concentration: parsed.concentration,
      attitude: parsed.attitude,
      absent: parsed.absent,
    })
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[lessons] update failed", error);
    return { ok: false, error: "수업 기록 수정 중 오류가 발생했습니다." };
  }

  revalidatePath("/admin/lessons");
  revalidatePath(`/admin/lessons/${id}`);
  return { ok: true };
}

export async function deleteLesson(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const { error } = await db
    .from("lessons")
    .delete()
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[lessons] delete failed", error);
    return { ok: false, error: "수업 기록 삭제 중 오류가 발생했습니다." };
  }

  revalidatePath("/admin/lessons");
  return { ok: true };
}
