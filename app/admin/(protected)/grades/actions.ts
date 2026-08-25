"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { getGrade, getStudent, listGrades, formatKDate } from "@/lib/data/crm";
import { createReportRow } from "@/lib/data/reports";
import { generateReport } from "@/lib/ai/generate";
import { pseudonymize } from "@/lib/ai/pseudonym";
import { REPORT_PROMPT_RULES } from "@/lib/ai/validate";
import { runCritical } from "@/lib/data/activity";
import { recordAdjustment } from "@/lib/data/adjustments";
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
  // 성적은 중요 전환(grade) — 감사 선기록(pending) 없이는 등록하지 않는다(fail-closed).
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "create",
      targetType: "grade",
      targetId: null, // insert 전 선기록이라 새 행 id는 아직 없다 — after_data로 식별.
      summary: `성적 등록: ${parsed.examName}`,
      category: "grade",
      after: {
        student_id: parsed.studentId,
        exam_name: parsed.examName,
        raw_score: parsed.rawScore,
        percentile: parsed.percentile,
        grade: parsed.grade,
        exam_date: parsed.examDate,
      },
    },
    async () => {
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
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidatePath("/admin/grades");
  revalidatePath(`/admin/students/${parsed.studentId}`);
  return result;
}

export async function updateGrade(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  const parsed = parseGradeForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  // A-06 정정 이력화: 사유 없는 정정은 없다 — 정정 사유는 필수 입력.
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: "정정 사유를 입력해 주세요." };

  // 수정 전 행을 before_data로 남기기 위해 먼저 조회한다(감사 선기록·조정 이력에 포함).
  const existing = await getGrade(session.tenantId, id);
  if (!existing) return { ok: false, error: "성적 정보를 찾을 수 없습니다." };

  const before = {
    student_id: existing.studentId,
    exam_name: existing.examName,
    raw_score: existing.rawScore,
    percentile: existing.percentile,
    grade: existing.grade,
    exam_date: existing.examDate,
  };
  const after = {
    student_id: parsed.studentId,
    exam_name: parsed.examName,
    raw_score: parsed.rawScore,
    percentile: parsed.percentile,
    grade: parsed.grade,
    exam_date: parsed.examDate,
  };

  const db = createServiceClient()!;
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "update",
      targetType: "grade",
      targetId: id,
      summary: `성적 정정: ${parsed.examName} — ${reason}`,
      category: "grade",
      before,
      after,
    },
    async () => {
      // A-06 '승인된 사실은 덮어쓰지 않는다': 변경 전 값을 조정 이력(adjustments,
      // append-only)에 먼저 남기고, 이력 기록에 실패하면 정정을 실행하지 않는다(fail-closed).
      const adjusted = await recordAdjustment(session.tenantId, {
        domain: "grade",
        targetType: "grade_record",
        targetId: id,
        before,
        after,
        reason,
        actorEmail: session.email,
      });
      if (!adjusted.ok) {
        return {
          ok: false,
          error: `조정 이력 기록에 실패해 정정을 실행하지 않았습니다. (${adjusted.error})`,
        };
      }

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
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidateGrade(id);
  revalidatePath(`/admin/students/${parsed.studentId}`);
  return result;
}

/**
 * 성적 삭제(철회) — 물리 삭제 금지(A-06). 원 행과 원 점수는 그대로 두고
 * deleted_at 스탬프로 철회만 표시한다(00016 ①). 사유는 필수이며, 철회 사실은
 * 조정 이력(adjustments)에 먼저 남긴다 — 이력 기록 실패 시 철회하지 않는다(fail-closed).
 */
export async function deleteGrade(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  // 사유 없는 삭제는 없다(00016 deleted_reason) — 필수 입력.
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: "삭제(철회) 사유를 입력해 주세요." };

  // 삭제 전 행을 before_data로 남기기 위해 먼저 조회한다(감사 선기록·조정 이력에 포함).
  const existing = await getGrade(session.tenantId, id);
  if (!existing) return { ok: false, error: "성적 정보를 찾을 수 없습니다." };

  const before = {
    student_id: existing.studentId,
    exam_name: existing.examName,
    raw_score: existing.rawScore,
    percentile: existing.percentile,
    grade: existing.grade,
    exam_date: existing.examDate,
  };
  const deletedAt = new Date().toISOString();

  const db = createServiceClient()!;
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "delete",
      targetType: "grade",
      targetId: id,
      summary: `성적 삭제(철회): ${existing.examName} — ${reason}`,
      category: "grade",
      before,
    },
    async () => {
      // 철회도 조정 이력이 먼저다 — 새 사실(after)은 "이 결과가 철회되었다"는 상태.
      const adjusted = await recordAdjustment(session.tenantId, {
        domain: "grade",
        targetType: "grade_record",
        targetId: id,
        before,
        after: { deleted_at: deletedAt, deleted_reason: reason },
        reason,
        actorEmail: session.email,
      });
      if (!adjusted.ok) {
        return {
          ok: false,
          error: `조정 이력 기록에 실패해 삭제를 실행하지 않았습니다. (${adjusted.error})`,
        };
      }

      const { error } = await db
        .from("grade_records")
        .update({ deleted_at: deletedAt, deleted_reason: reason })
        .eq("tenant_id", session.tenantId)
        .eq("id", id)
        .is("deleted_at", null); // 이미 철회된 결과의 스탬프를 덮어쓰지 않는다
      if (error) {
        console.error("[grades] soft delete failed", error);
        return { ok: false, error: "성적 삭제 중 오류가 발생했습니다." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidatePath("/admin/grades");
  revalidatePath(`/admin/students/${existing.studentId}`);
  return result;
}

/**
 * 시험 리포트 AI — 학부모·학생용 초안을 각각 생성. 실명 미전송(pseudonymize), 발송은 승인 후에만.
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

  // 성적 기반 리포트 생성도 성적 전환(grade) — 감사 선기록 없이는 생성하지 않는다(fail-closed).
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "generate_exam_report",
      targetType: "grade",
      targetId: grade.id,
      summary: `${grade.examName} 시험 리포트 생성(학부모·학생)`,
      category: "grade",
    },
    async () => {
      for (const { audience, guide } of audiences) {
        const prompt = [
          "다음은 한 학생의 시험 성적 리포트를 작성하기 위한 자료입니다.",
          guide,
          REPORT_PROMPT_RULES,
          "",
          context,
        ].join("\n");

        const generated = await generateReport("exam", "basic", prompt);
        if (!generated.ok || !generated.content) {
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
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidatePath("/admin/reports");
  return { ...result, studentId: grade.studentId };
}
