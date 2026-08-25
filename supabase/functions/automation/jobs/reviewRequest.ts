// job=review_request — 매일: 첫 수업이 4주 이상 지난 active 학생을 "후기 요청 후보"로 수렴.
//
// 정본 S-01 "자동 요청·자동 게시하지 않는다": 이 크론은 후기 요청을 자동 발송하지 않는다.
// (이전 구현은 notifications에 후기 요청 메시지를 자동 큐잉해 flush가 실발송 — 정본과 충돌.)
// 지금은 후보 학생을 work_items(kind 'manual')로만 만들어 운영자 업무 큐에 올리고,
// 요청 여부·문구·발송은 운영자가 관리자 > 메시지(개별 메시지)에서 수동으로 결정한다.

import type { SupabaseClient } from "../../_shared/db.ts";
import { kstDateString } from "../../_shared/kst.ts";

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

  let created = 0;
  let skipped = 0;

  for (const s of (students ?? []) as StudentRow[]) {
    // 대상 선정은 이전과 동일하게 유지(연락처 있는 학생·첫 수업 4주 경과) — 바뀐 것은
    // "자동 발송 → 운영자 수동 판단 업무"라는 후속 행동뿐이다.
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

    // 과거 자동 발송분 호환: 이미 후기 요청 알림이 나간 학생은 다시 후보로 올리지 않는다(1회성 유지).
    const { data: existingNotify, error: existingError } = await db
      .from("notifications")
      .select("id")
      .eq("tenant_id", s.tenant_id)
      .eq("student_id", s.id)
      .eq("type", "review_request")
      .limit(1);
    if (existingError) throw existingError;
    if (existingNotify && existingNotify.length > 0) {
      skipped++;
      continue;
    }

    // 학생당 1회성 후보: 완결(done·dismissed)된 업무까지 포함해 이미 후보로 올린 학생은
    // 재생성하지 않는다 — 부분 유니크(work_items_open_dedup)는 열린 업무만 막으므로,
    // "운영자가 이미 판단(발송 또는 기각)한 학생을 매일 다시 올리는" 재발을 여기서 차단한다.
    const { data: existingWork, error: workError } = await db
      .from("work_items")
      .select("id")
      .eq("tenant_id", s.tenant_id)
      .eq("source_type", "review_request")
      .eq("source_id", s.id)
      .limit(1);
    if (workError) throw workError;
    if (existingWork && existingWork.length > 0) {
      skipped++;
      continue;
    }

    // Deno 환경이라 lib/data/work.ts(createWorkItem)를 못 쓴다 — 직접 insert(notifyRetry 패턴).
    // 경합으로 열린 중복이 생기면 부분 유니크가 23505로 막는다(한 사건 한 업무 — 정상 경로).
    const { error: insertError } = await db.from("work_items").insert({
      tenant_id: s.tenant_id,
      kind: "manual",
      title: `후기 요청 후보 — ${s.name}`,
      detail: `첫 수업 ${first} · 4주 경과 (학부모 ${s.parent_phone})`,
      source_type: "review_request",
      source_id: s.id,
      priority: "normal",
      status: "open",
      next_action:
        "후기 요청 여부 결정 — 발송 시 관리자 > 메시지(개별 메시지)에서 수동 발송(S-01 자동 요청 금지)",
    });
    if (insertError) {
      if (insertError.code !== "23505") {
        console.error("[review_request] work_items insert failed", insertError);
      }
      skipped++;
      continue;
    }
    created++;
  }

  return { targeted: students?.length ?? 0, created, skipped };
}
