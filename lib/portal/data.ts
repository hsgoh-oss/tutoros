import { createServiceClient } from "@/lib/supabase/server";
import type { PortalReport } from "@/lib/data/crm";
import {
  listPortalAssignments,
  listPortalQuestions,
  type PortalHomework,
  type PortalHomeworkQuestion,
} from "@/lib/data/homework";
import type { ReportType } from "@/lib/types";
import { hasPortalAccess, type PortalRole, type PortalSession } from "@/lib/portal/auth";

// 역할 게이트는 auth.ts가 원천이다 — 학습(data.ts)·금전(payments.ts) 두 모듈이 서로를
// import하지 않고도 같은 게이트를 쓰게 하려는 배치다(검수 17 코드 경로 분리).
export { hasPortalAccess };

// 역할별 포털 조회 — 정본 P-03(학생)·P-04(보호자)·P-05(납부자), 검수 17·18·19.
//
// 이 파일의 모든 조회는 두 겹으로 스코프된다.
//   ① 역할 게이트: 세션의 active 관계에 (역할, 학생)이 있어야 통과한다. 없으면 빈 결과다 —
//      "권한 없음"과 "데이터 없음"을 구분하지 않는다(다른 학생의 존재를 드러내지 않는다: P-03·P-04).
//   ② 테넌트·학생 스코프: 실제 쿼리는 세션의 tenantId와 통과한 studentId로만 나간다.
//
// ⚠️ 영역 분리(검수 17) — 이 모듈에는 금전 조회가 아예 없다(lib/portal/payments.ts로 분리).
// 학생·보호자 뷰가 호출하는 함수는 학습 영역 함수뿐이고, 금전 조회는 "금전 영역"의
// listPayerPayments 하나로 모여 있으며 그 함수는 payer 관계 없이는 어떤 경로로도 행을 돌려주지 않는다.
// 즉 학생 역할에는 금전 쿼리로 가는 코드 경로 자체가 없다(필터로 가리는 것이 아니다).
// 반대로 납부자 뷰는 학습 영역 함수를 호출하지 않는다 — 학습 상세는 비노출이다(검수 19,
// 학습공유 플래그는 후속 과제).

/* ---------- 역할 게이트 ---------- */

export interface PortalStudentRef {
  studentId: string;
  studentName: string;
}

/**
 * 이 역할로 열 수 있는 학생 목록 — 보호자 자녀 전환 UI의 유일한 목록 원천이다(검수 18).
 * 세션의 active 관계에서만 만들어지므로, 관계가 끝난 학생은 다음 요청부터 목록에서 사라진다.
 */
export function studentsForRole(
  session: PortalSession,
  role: PortalRole,
): PortalStudentRef[] {
  const seen = new Set<string>();
  const out: PortalStudentRef[] = [];
  for (const r of session.relations) {
    if (r.role !== role) continue;
    if (seen.has(r.studentId)) continue;
    seen.add(r.studentId);
    out.push({ studentId: r.studentId, studentName: r.studentName });
  }
  return out;
}

/* ==================================================================
   학습 영역 — 학생(P-03)·보호자(P-04). payments를 조회하는 코드가 없다(검수 17).
   ================================================================== */

/** 역할별 리포트 대상 — 학생 뷰는 학생용, 보호자 뷰는 학부모용만 본다. */
const REPORT_AUDIENCE: Record<"student" | "guardian", "student" | "parent"> = {
  student: "student",
  guardian: "parent",
};

interface ReportRow {
  id: string;
  type: ReportType;
  content: string;
  created_at: string;
}

/**
 * 포털 리포트 조회 — 승인/발송된 것만(내부용·초안·철회 제외).
 *
 * status 화이트리스트(approved·sent)는 lib/data/crm.ts listPortalReports와 같은 규칙이다.
 * 그 함수는 parent·student를 한꺼번에 돌려주므로(기존 단일 토큰 포털용) 역할별 분리에는 쓸 수 없어,
 * 여기서 audience를 하나로 좁혀 조회한다. ⚠️ 노출 규칙(G-03 철회·대체 포함)이 바뀌면 두 곳을 함께 고칠 것.
 */
async function listReportsForAudience(
  tenantId: string,
  studentId: string,
  audience: "student" | "parent",
): Promise<PortalReport[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("ai_reports")
    .select("id, type, content, created_at")
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId)
    .eq("audience", audience)
    .in("status", ["approved", "sent"])
    .order("created_at", { ascending: false });
  return ((data ?? []) as ReportRow[]).map((row) => ({
    id: row.id,
    type: row.type,
    content: row.content,
    createdAt: row.created_at,
  }));
}

/** 학생 뷰 리포트 — 학생용(audience student) 승인분만. */
export async function listStudentReports(
  session: PortalSession,
  studentId: string,
): Promise<PortalReport[]> {
  if (!hasPortalAccess(session, "student", studentId)) return [];
  return listReportsForAudience(
    session.tenantId,
    studentId,
    REPORT_AUDIENCE.student,
  );
}

/** 보호자 뷰 리포트 — 학부모용(audience parent) 승인분만, 연결된 학생만(검수 18). */
export async function listGuardianReports(
  session: PortalSession,
  studentId: string,
): Promise<PortalReport[]> {
  if (!hasPortalAccess(session, "guardian", studentId)) return [];
  return listReportsForAudience(
    session.tenantId,
    studentId,
    REPORT_AUDIENCE.guardian,
  );
}

/**
 * 학생 뷰 과제 — 기존 포털 조회(lib/data/homework.ts listPortalAssignments)를 그대로 쓴다.
 * 배부·종료만 노출하고 미승인 피드백은 존재째 감춘 채 내려온다(검수 28).
 */
export async function listStudentHomework(
  session: PortalSession,
  studentId: string,
): Promise<PortalHomework[]> {
  if (!hasPortalAccess(session, "student", studentId)) return [];
  return listPortalAssignments(session.tenantId, studentId);
}

/**
 * 보호자 뷰 과제 현황 — 같은 조회를 읽기 전용으로 쓴다(P-04 "과제 현황 확인").
 * 대리 제출은 없다: 제출·철회는 학생 경로의 서버 액션만 수행한다(P-04 보호자 대리 제출 금지).
 */
export async function listGuardianHomework(
  session: PortalSession,
  studentId: string,
): Promise<PortalHomework[]> {
  if (!hasPortalAccess(session, "guardian", studentId)) return [];
  return listPortalAssignments(session.tenantId, studentId);
}

/** 학생 뷰 질의응답 — 본인 질문만, 승인된 답변만(H-04·검수 28). */
export async function listStudentQuestions(
  session: PortalSession,
  studentId: string,
): Promise<PortalHomeworkQuestion[]> {
  if (!hasPortalAccess(session, "student", studentId)) return [];
  return listPortalQuestions(session.tenantId, studentId);
}

/* ==================================================================
   금전 영역 — 납부자(P-05). 이 아래 함수만 payments를 조회한다.
   학생·보호자 역할로는 이 경로에 도달할 수 없다(검수 17·P-04 "청구권한 없음").
   ================================================================== */

/** 납부자에게 보이는 청구 1건 — 청구·수납·환불·증빙을 한 행으로 본다(payments, 00014). */

