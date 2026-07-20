// job=dday_recalc — 매일: 경과한 시험 D-day(exam_date < 오늘 KST)를 자동 숨김(is_visible=false).
// 임박 강조는 렌더 시점 계산이라 여기선 하지 않는다. 플랫폼 경로 — 전 테넌트 일괄(각 행 tenant_id 보존).

import type { SupabaseClient } from "../../_shared/db.ts";
import { kstDateString } from "../../_shared/kst.ts";

export async function runDdayRecalc(db: SupabaseClient) {
  const today = kstDateString(0); // 오늘(KST) YYYY-MM-DD
  const { data, error } = await db
    .from("ddays")
    .update({ is_visible: false })
    .lt("exam_date", today)
    .eq("is_visible", true)
    .select("id");
  if (error) throw error;
  return { hidden: data?.length ?? 0 };
}
