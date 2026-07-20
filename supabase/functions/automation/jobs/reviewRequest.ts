// job=review_request — 매일: 첫 수업이 4주 이상 지난 active 학생 학부모에게 후기 요청을 큐잉한다.
// 1회성(멱등): 해당 학생에게 review_request가 한 번이라도 있으면 스킵. 실발송은 flush가 담당.

import type { SupabaseClient } from "../../_shared/db.ts";
import { kstDateString } from "../../_shared/kst.ts";
import { reviewRequestMessage } from "../../_shared/templates.ts";
import { defaultChannel } from "../../_shared/channel.ts";

interface StudentRow {
  id: string;
  tenant_id: string;
  name: string;
  parent_phone: string;
}

const REVIEW_AFTER_DAYS = 28; // 수업 4주차 도달

export async function runReviewRequest(db: SupabaseClient) {
  const cutoff = kstDateString(-REVIEW_AFTER_DAYS); // 4주 전(KST) — 첫 수업이 이보다 이전이면 대상
  const { data: students, error } = await db
    .from("students")
    .select("id, tenant_id, name, parent_phone")
    .eq("status", "active");
  if (error) throw error;

  const channel = defaultChannel();
  let queued = 0;
  let skipped = 0;

  for (const s of (students ?? []) as StudentRow[]) {
    if (!s.parent_phone) {
      skipped++;
      continue;
    }

    const { data: firstLesson, error: lessonError } = await db
      .from("lessons")
      .select("lesson_date")
      .eq("tenant_id", s.tenant_id)
      .eq("student_id", s.id)
      .order("lesson_date", { ascending: true })
      .limit(1);
    if (lessonError) throw lessonError;
    const first = (firstLesson?.[0] as { lesson_date: string } | undefined)?.lesson_date;
    if (!first || first > cutoff) {
      skipped++;
      continue;
    }

    const { data: existing, error: existingError } = await db
      .from("notifications")
      .select("id")
      .eq("tenant_id", s.tenant_id)
      .eq("student_id", s.id)
      .eq("type", "review_request")
      .limit(1);
    if (existingError) throw existingError;
    if (existing && existing.length > 0) {
      skipped++;
      continue;
    }

    const { error: insertError } = await db.from("notifications").insert({
      tenant_id: s.tenant_id,
      student_id: s.id,
      type: "review_request",
      channel,
      phone: s.parent_phone,
      message: reviewRequestMessage(s.name),
      is_ad: false,
      status: "queued",
    });
    if (insertError) {
      console.error("[review_request] notification insert failed", insertError);
      skipped++;
      continue;
    }
    queued++;
  }

  return { targeted: students?.length ?? 0, queued, skipped };
}
