"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { getLesson, getStudent, nextSessionNumber } from "@/lib/data/crm";
import { createReportRow } from "@/lib/data/reports";
import { generateReport } from "@/lib/ai/generate";
import { pseudonymize } from "@/lib/ai/pseudonym";
import { REPORT_PROMPT_RULES } from "@/lib/ai/validate";
import { logActivity } from "@/lib/data/activity";
import type { CrmActionResult } from "@/components/admin/crm/types";
import { RATING_OPTIONS } from "./constants";
import { AI_REPORT_DISCLAIMER } from "../reports/constants";

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

/** session_number(회차)는 입력받지 않고 기존 기록 수 + 1로 서버에서 자동 계산(기획 요구). */
export async function createLesson(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const parsed = parseLessonForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const sessionNumber = await nextSessionNumber(session.tenantId, parsed.studentId);

  const db = createServiceClient()!;
  const { data, error } = await db
    .from("lessons")
    .insert({
      tenant_id: session.tenantId,
      student_id: parsed.studentId,
      lesson_date: parsed.lessonDate,
      session_number: sessionNumber,
      content: parsed.content,
      homework: parsed.homework,
      concentration: parsed.concentration,
      attitude: parsed.attitude,
      absent: parsed.absent,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[lessons] insert failed", error);
    return { ok: false, error: "수업 기록 등록 중 오류가 발생했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "create",
    "lesson",
    data.id,
    `${sessionNumber}회차 수업 기록 등록`,
  );

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

  await logActivity(
    session.tenantId,
    session.email,
    "update",
    "lesson",
    id,
    "수업 기록 수정",
  );

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

  await logActivity(
    session.tenantId,
    session.email,
    "delete",
    "lesson",
    id,
    "수업 기록 삭제",
  );

  revalidatePath("/admin/lessons");
  return { ok: true };
}

/** 한 회차 수업 기록을 가명화해 학부모용·학생용 리포트 초안 2건을 한 번에 생성한다(항상 draft — 선생님 승인 후 발송). */
function buildLessonContext(
  student: { name: string },
  lesson: {
    sessionNumber: number;
    lessonDate: string;
    content: string;
    homework: string | null;
    concentration: number | null;
    attitude: number | null;
    absent: boolean;
  },
): string {
  const lines = [
    `학생: ${student.name}`,
    `회차: ${lesson.sessionNumber}회차`,
    `수업일: ${lesson.lessonDate}`,
    `수업 내용: ${lesson.content}`,
  ];
  if (lesson.homework) lines.push(`숙제: ${lesson.homework}`);
  if (lesson.concentration != null) lines.push(`집중도: ${lesson.concentration}/5`);
  if (lesson.attitude != null) lines.push(`수업 태도: ${lesson.attitude}/5`);
  lines.push(`출결: ${lesson.absent ? "결석" : "출석"}`);
  return lines.join("\n");
}

export async function generateLessonReport(
  id: string,
): Promise<CrmActionResult & { studentId?: string }> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const lesson = await getLesson(session.tenantId, id);
  if (!lesson) return { ok: false, error: "수업 기록을 찾을 수 없습니다." };

  const student = await getStudent(session.tenantId, lesson.studentId);
  if (!student) return { ok: false, error: "학생 정보를 찾을 수 없습니다." };

  // 계약(6-4): AI 프롬프트에 실명이 절대 포함되지 않도록 가명화한 뒤 호출한다.
  const context = pseudonymize(buildLessonContext(student, lesson), student.name);

  const parentPrompt = [
    "다음은 한 학생의 한 회차 수업 기록입니다. 학부모님께 전달할 수업 리포트를 한국어로 작성해 주세요.",
    "이번 수업에서 다룬 내용, 학생의 집중도·태도, 숙제, 가정에서 봐주시면 좋을 점을 3~5문장으로 정중하고 따뜻하게 정리해 주세요.",
    REPORT_PROMPT_RULES,
    "",
    context,
  ].join("\n");

  const parentGenerated = await generateReport("lesson", "basic", parentPrompt);
  if (!parentGenerated.ok || !parentGenerated.content) {
    return { ok: false, error: parentGenerated.error ?? "리포트 생성에 실패했습니다." };
  }

  const parentCreated = await createReportRow({
    tenantId: session.tenantId,
    studentId: lesson.studentId,
    type: "lesson",
    audience: "parent",
    depth: "basic",
    content: parentGenerated.content + AI_REPORT_DISCLAIMER,
    modelUsed: parentGenerated.modelUsed ?? null,
    tokenUsage: parentGenerated.tokenUsage ?? null,
  });
  if (!parentCreated.ok) return parentCreated;

  const studentPrompt = [
    "다음은 한 학생의 한 회차 수업 기록입니다. 학생 본인에게 전달할 수업 리포트를 한국어로, 친근하고 격려하는 말투로 작성해 주세요.",
    "이번에 배운 내용 요약, 잘한 점, 숙제와 다음 수업에서 더 신경 쓰면 좋을 점을 3~5문장으로 정리해 주세요.",
    REPORT_PROMPT_RULES,
    "",
    context,
  ].join("\n");

  const studentGenerated = await generateReport("lesson", "basic", studentPrompt);
  if (!studentGenerated.ok || !studentGenerated.content) {
    return { ok: false, error: studentGenerated.error ?? "리포트 생성에 실패했습니다." };
  }

  const studentCreated = await createReportRow({
    tenantId: session.tenantId,
    studentId: lesson.studentId,
    type: "lesson",
    audience: "student",
    depth: "basic",
    content: studentGenerated.content + AI_REPORT_DISCLAIMER,
    modelUsed: studentGenerated.modelUsed ?? null,
    tokenUsage: studentGenerated.tokenUsage ?? null,
  });
  if (!studentCreated.ok) return studentCreated;

  await logActivity(
    session.tenantId,
    session.email,
    "create",
    "report",
    null,
    `${lesson.sessionNumber}회차 수업 리포트 초안 생성(학부모·학생)`,
  );

  revalidatePath("/admin/reports");
  return { ok: true, studentId: lesson.studentId };
}
