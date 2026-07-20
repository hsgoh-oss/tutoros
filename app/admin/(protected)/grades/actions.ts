"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { getGrade, getStudent, listGrades, formatKDate } from "@/lib/data/crm";
import { createReportRow } from "@/lib/data/reports";
import { generateReport } from "@/lib/ai/generate";
import { pseudonymize } from "@/lib/ai/pseudonym";
import { logActivity } from "@/lib/data/activity";
import type { ReportAudience } from "@/lib/types";
import type { CrmActionResult } from "@/components/admin/crm/types";
import { AI_REPORT_DISCLAIMER } from "../reports/constants";

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
  const { data, error } = await db
    .from("grade_records")
    .insert({
      tenant_id: session.tenantId,
      student_id: parsed.studentId,
      exam_name: parsed.examName,
      raw_score: parsed.rawScore,
      percentile: parsed.percentile,
      grade: parsed.grade,
      exam_date: parsed.examDate,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[grades] insert failed", error);
    return { ok: false, error: "성적 등록 중 오류가 발생했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "create",
    "grade",
    data.id,
    `성적 등록: ${parsed.examName}`,
  );

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

  await logActivity(
    session.tenantId,
    session.email,
    "update",
    "grade",
    id,
    `성적 수정: ${parsed.examName}`,
  );

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

  await logActivity(
    session.tenantId,
    session.email,
    "delete",
    "grade",
    id,
    "성적 삭제",
  );

  revalidatePath("/admin/grades");
  return { ok: true };
}

/**
 * 시험 리포트 AI — 성적과 최근 추이를 가명화해 학부모용·학생용 리포트 초안(draft)을 각각 생성한다.
 * 실명은 프롬프트에 전달되지 않는다(pseudonymize). 발송은 승인 후 별도 흐름에서만.
 */
export async function generateExamReport(
  id: string,
): Promise<CrmActionResult & { studentId?: string }> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const grade = await getGrade(session.tenantId, id);
  if (!grade) return { ok: false, error: "성적 정보를 찾을 수 없습니다." };

  const student = await getStudent(session.tenantId, grade.studentId);
  if (!student) return { ok: false, error: "학생 정보를 찾을 수 없습니다." };

  // 같은 학생의 이전 시험을 시간순으로 함께 제공해 추이 맥락을 만든다(listGrades는 exam_date asc).
  const trend = await listGrades(session.tenantId, grade.studentId);
  const trendLines = trend.map((g) => {
    const score = g.rawScore != null ? `원점수 ${g.rawScore}점` : "원점수 -";
    const pct = g.percentile != null ? `백분위 ${g.percentile}` : "백분위 -";
    const gr = g.grade ? `${g.grade}등급` : "등급 -";
    return `- ${g.examName}(${formatKDate(g.examDate)}): ${score}, ${pct}, ${gr}`;
  });

  const lines = [
    `학생: ${student.name}`,
    `시험명: ${grade.examName}`,
    `시험일: ${formatKDate(grade.examDate)}`,
    `원점수: ${grade.rawScore != null ? `${grade.rawScore}점` : "-"}`,
    `백분위: ${grade.percentile != null ? grade.percentile : "-"}`,
    `등급: ${grade.grade ? `${grade.grade}등급` : "-"}`,
  ];
  if (trendLines.length > 0) {
    lines.push("", "지금까지의 성적 추이:", ...trendLines);
  }

  let context = lines.join("\n");
  context = pseudonymize(context, student.name);

  // 대상별(학부모→학생) 리포트를 각각 생성해 초안으로 저장한다.
  const audiences: { audience: ReportAudience; guide: string }[] = [
    {
      audience: "parent",
      guide:
        "학부모가 이해하기 쉽도록 이번 시험 결과와 성적 추이, 강점과 보완점, 가정에서 도울 수 있는 방향을 한국어로 정리해 주세요.",
    },
    {
      audience: "student",
      guide:
        "학생이 스스로 읽고 동기를 얻도록 이번 시험 결과와 성적 추이, 잘한 점과 다음 목표, 학습 조언을 격려하는 어조의 한국어로 정리해 주세요.",
    },
  ];

  for (const { audience, guide } of audiences) {
    const prompt = [
      "다음은 한 학생의 시험 성적 리포트를 작성하기 위한 자료입니다.",
      guide,
      "이름은 실명이 아닌 표기(예: 김○○)로 되어 있으니, 그 표기를 그대로 사용해 자연스럽게 작성하세요.",
      "",
      context,
    ].join("\n");

    const generated = await generateReport("exam", "basic", prompt);
    if (!generated.ok || !generated.content) {
      // AI 키 미설정·호출 실패 시 초안을 만들지 않고 안전하게 실패 반환.
      return { ok: false, error: generated.error ?? "시험 리포트 생성에 실패했습니다." };
    }

    const created = await createReportRow({
      tenantId: session.tenantId,
      studentId: grade.studentId,
      type: "exam",
      audience,
      depth: "basic",
      content: generated.content + AI_REPORT_DISCLAIMER,
      modelUsed: generated.modelUsed ?? null,
      tokenUsage: generated.tokenUsage ?? null,
    });
    if (!created.ok) return created;
  }

  await logActivity(
    session.tenantId,
    session.email,
    "generate_exam_report",
    "grade",
    grade.id,
    `${grade.examName} 시험 리포트 생성(학부모·학생)`,
  );

  revalidatePath("/admin/reports");
  return { ok: true, studentId: grade.studentId };
}
