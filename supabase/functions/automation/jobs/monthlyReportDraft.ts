// job=monthly_report_draft — 매월 1일: 지난 30일 lessons 기록이 있는 active 학생에 한해
// ai_reports monthly draft 행만 삽입한다(실제 AI 생성은 관리자 화면). weekly_report_draft 미러.
// 멱등성: 이번 달 1일 00:00 KST 이후 이미 monthly draft가 있으면 스킵.

import type { SupabaseClient } from "../../_shared/db.ts";
import { kstDateString, kstMidnightUtc, kstParts } from "../../_shared/kst.ts";

interface StudentRow {
  id: string;
  tenant_id: string;
}

export async function runMonthlyReportDraft(db: SupabaseClient) {
  const monthStart = kstDateString(-30); // 지난 30일(lessons.lesson_date 비교용)
  const monthEnd = kstDateString(0);
  const { y, m } = kstParts();
  const thisMonthStart = kstMidnightUtc(y, m, 1); // 이번 달 1일 00:00 KST — 중복 방지 기준

  const { data: students, error } = await db
    .from("students")
    .select("id, tenant_id")
    .eq("status", "active");
  if (error) throw error;

  let created = 0;
  let skipped = 0;

  for (const student of (students ?? []) as StudentRow[]) {
    const { count: lessonCount, error: lessonError } = await db
      .from("lessons")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", student.tenant_id)
      .eq("student_id", student.id)
      .gte("lesson_date", monthStart)
      .lt("lesson_date", monthEnd);
    if (lessonError) throw lessonError;
    if (!lessonCount) {
      skipped++;
      continue;
    }

    const { data: existing, error: existingError } = await db
      .from("ai_reports")
      .select("id")
      .eq("tenant_id", student.tenant_id)
      .eq("student_id", student.id)
      .eq("type", "monthly")
      .gte("created_at", thisMonthStart.toISOString());
    if (existingError) throw existingError;
    if (existing && existing.length > 0) {
      skipped++;
      continue;
    }

    const { error: insertError } = await db.from("ai_reports").insert({
      tenant_id: student.tenant_id,
      student_id: student.id,
      type: "monthly",
      audience: "parent",
      depth: "basic",
      content: "",
      status: "draft",
    });
    if (insertError) {
      console.error("[monthly_report_draft] ai_reports insert failed", insertError);
      skipped++;
      continue;
    }
    created++;
  }

  return { targeted: students?.length ?? 0, created, skipped };
}
