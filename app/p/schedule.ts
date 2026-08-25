import { createServiceClient } from "@/lib/supabase/server";
import { hasPortalAccess } from "@/lib/portal/data";
import type { PortalSession } from "@/lib/portal/auth";
import type { ClassType, ScheduleItem } from "@/lib/types";

// 보호자 뷰 일정 요약 (P-04 "일정·출결 확인").
//
// lib/data/crm.ts listSchedules는 테넌트 전체 범위(관리자 달력용)라 포털에 쓸 수 없다 —
// 보호자에게는 연결된 그 학생의 회차만 보여야 한다(검수 18). 그래서 학생 스코프 조회를 여기 둔다.
// 역할 게이트는 lib/portal/data.ts와 같은 규칙을 쓴다: guardian 관계가 없으면 빈 결과이고,
// "권한 없음"과 "일정 없음"을 구분하지 않는다(다른 학생의 존재를 드러내지 않는다).
//
// ⚠️ 금전 없음: 이 조회는 schedules만 본다. 회차·잔액·청구는 한 컬럼도 포함하지 않는다
// (보호자는 청구권한 없음 — P-04 예외 · 검수 17과 같은 경계).

/** 포털에 보이는 회차 한 건 — 관리자 메모·수업기록 본문은 포함하지 않는다. */
export interface PortalScheduleItem {
  id: string;
  scheduledAt: string;
  classType: ClassType;
  status: ScheduleItem["status"];
}

export interface PortalScheduleSummary {
  /** 지금 이후의 예정·보강 회차(가까운 순). */
  upcoming: PortalScheduleItem[];
  /** 최근 완료 회차(최신 순) — "요약"이므로 전체 이력이 아니라 최근 몇 건만. */
  recent: PortalScheduleItem[];
}

const UPCOMING_LIMIT = 5;
const RECENT_LIMIT = 3;

interface ScheduleRow {
  id: string;
  scheduled_at: string;
  class_type: ClassType;
  status: ScheduleItem["status"];
}

function map(rows: ScheduleRow[] | null): PortalScheduleItem[] {
  return (rows ?? []).map((r) => ({
    id: r.id,
    scheduledAt: r.scheduled_at,
    classType: r.class_type,
    status: r.status,
  }));
}

/**
 * 보호자 일정 요약 — 예정(planned·makeup) 다음 몇 건과 최근 완료(done) 몇 건.
 *
 * 취소(canceled) 회차는 싣지 않는다: 취소 안내는 알림(L-05 보강·변경 안내)이 담당하고,
 * 이 화면은 "앞으로 언제 수업이 있는가"를 답하는 요약이다. 여기에 취소분까지 섞으면
 * 다음 수업이 언제인지가 흐려진다.
 */
export async function getGuardianSchedule(
  session: PortalSession,
  studentId: string,
): Promise<PortalScheduleSummary> {
  if (!hasPortalAccess(session, "guardian", studentId)) {
    return { upcoming: [], recent: [] };
  }
  const db = createServiceClient();
  if (!db) return { upcoming: [], recent: [] };

  const nowIso = new Date().toISOString();
  const columns = "id, scheduled_at, class_type, status";
  const [upcomingRes, recentRes] = await Promise.all([
    db
      .from("schedules")
      .select(columns)
      .eq("tenant_id", session.tenantId)
      .eq("student_id", studentId)
      .in("status", ["planned", "makeup"])
      .gte("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true })
      .limit(UPCOMING_LIMIT),
    db
      .from("schedules")
      .select(columns)
      .eq("tenant_id", session.tenantId)
      .eq("student_id", studentId)
      .eq("status", "done")
      .lt("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: false })
      .limit(RECENT_LIMIT),
  ]);
  if (upcomingRes.error || recentRes.error) {
    // 일정만 실패해도 리포트·과제 영역은 그대로 보여야 한다(P-03·P-04 "일부 영역 실패:
    // 이용 가능한 영역 유지"). 빈 요약으로 수렴하고 화면은 "표시할 일정 없음"을 그린다.
    console.error(
      "[portal] guardian schedule lookup failed",
      upcomingRes.error ?? recentRes.error,
    );
    return { upcoming: [], recent: [] };
  }

  return {
    upcoming: map(upcomingRes.data as ScheduleRow[] | null),
    recent: map(recentRes.data as ScheduleRow[] | null),
  };
}
