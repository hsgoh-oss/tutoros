// job=weekly_report_draft — 매주 월요일 09:00 KST(00:00 UTC): 재원(active) 학생 중
// 지난주(KST 월~일) lessons 기록이 있는 학생에 한해 ai_reports draft 행만 삽입한다.
// AI 키는 Next 서버 전용이므로 엣지에서 Anthropic을 직접 호출하지 않는다 — 실제 리포트
// 생성은 관리자 화면(생성 대기 draft 확인 후 트리거)에서 이뤄진다.
// 멱등성: 이번 주(KST 이번주 월요일 00:00 이후) 이미 같은 학생·type='weekly' draft가 있으면 스킵.

import type { SupabaseClient } from "../../_shared/db.ts";
import { kstDateString, kstDayRangeUtc } from "../../_shared/kst.ts";

interface StudentRow {
  id: string;
  tenant_id: string;
}

export async function runWeeklyReportDraft(db: SupabaseClient) {
  const weekStart = kstDateString(-7); // 지난주 월요일(KST, lessons.lesson_date 비교용)
  const weekEnd = kstDateString(0); // 이번주 월요일(오늘, KST) — [weekStart, weekEnd) = 지난 한 주
  const thisWeekStart = kstDayRangeUtc(0).start; // 이번주 월요일 00:00 KST — 중복 방지 기준

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
      .gte("lesson_date", weekStart)
      .lt("lesson_date", weekEnd);
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
      .eq("type", "weekly")
      .gte("created_at", thisWeekStart.toISOString());
    if (existingError) throw existingError;
    if (existing && existing.length > 0) {
      skipped++;
      continue;
    }

    const { error: insertError } = await db.from("ai_reports").insert({
      tenant_id: student.tenant_id,
      student_id: student.id,
      type: "weekly",
      audience: "parent",
      depth: "basic",
      content: "",
      status: "draft",
    });
    if (insertError) {
      console.error("[weekly_report_draft] ai_reports insert failed", insertError);
      skipped++;
      continue;
    }
    created++;
  }

  return { targeted: students?.length ?? 0, created, skipped };
}
