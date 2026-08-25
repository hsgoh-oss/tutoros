"use server";

import { headers } from "next/headers";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { runCritical } from "@/lib/data/activity";
import { recordAdjustment } from "@/lib/data/adjustments";
import { createWorkItem } from "@/lib/data/work";
import { sendNotification } from "@/lib/notify/send";
import { renderTemplate } from "@/lib/notify/templates";
import {
  PORTAL_ROLE_LABEL,
  isPortalRole,
  revokeRelation,
  rotateAccessLink,
  portalLinkPath,
  type PortalRole,
} from "@/lib/portal/auth";
import { resolveTenant } from "@/lib/tenant";
import type { ClassType, Student } from "@/lib/types";
import type { CrmActionResult } from "@/components/admin/crm/types";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";
const VALID_CLASS_TYPES: ClassType[] = ["inperson", "video"];
const VALID_STATUSES: Student["status"][] = ["trial", "active", "paused", "ended"];

interface StudentFormPayload {
  name: string;
  parentPhone: string;
  studentPhone: string | null;
  studentPhoneConsent: boolean;
  school: string | null;
  grade: string | null;
  classType: ClassType;
  subjectType: string | null;
  status: Student["status"];
}

function parseStudentForm(formData: FormData): StudentFormPayload | { error: string } {
  const name = String(formData.get("name") ?? "").trim();
  const parentPhone = String(formData.get("parentPhone") ?? "").trim();
  if (!name) return { error: "이름을 입력해 주세요." };
  if (!parentPhone) return { error: "학부모 연락처를 입력해 주세요." };

  const studentPhoneRaw = String(formData.get("studentPhone") ?? "").trim();
  const studentPhoneConsent = formData.get("studentPhoneConsent") === "on";
  if (studentPhoneRaw && !studentPhoneConsent) {
    return { error: "학생 연락처를 입력하려면 수집 동의 확인이 필요합니다." };
  }

  const classTypeRaw = String(formData.get("classType") ?? "inperson");
  const classType: ClassType = VALID_CLASS_TYPES.includes(classTypeRaw as ClassType)
    ? (classTypeRaw as ClassType)
    : "inperson";

  const statusRaw = String(formData.get("status") ?? "trial");
  const status: Student["status"] = VALID_STATUSES.includes(statusRaw as Student["status"])
    ? (statusRaw as Student["status"])
    : "trial";

  return {
    name,
    parentPhone,
    studentPhone: studentPhoneRaw || null,
    studentPhoneConsent,
    school: String(formData.get("school") ?? "").trim() || null,
    grade: String(formData.get("grade") ?? "").trim() || null,
    classType,
    subjectType: String(formData.get("subjectType") ?? "").trim() || null,
    status,
  };
}

/** 학생 본인 연락처 수집 동의 기록 — 동의 이력은 감사 성격이라 실패를 삼키지 않고 호출부에 알린다. */
async function recordStudentPhoneConsent(
  tenantId: string,
  studentId: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const db = createServiceClient()!;
  const { data, error } = await db
    .from("consents")
    .insert({
      tenant_id: tenantId,
      subject_type: "student",
      subject_id: studentId,
      item: "student_phone",
      via: "admin",
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[students] student_phone consent insert failed", error);
    return { ok: false, error: "학생 연락처 수집 동의 기록에 실패했습니다." };
  }
  return { ok: true, id: (data as { id: string }).id };
}

export async function createStudent(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const parsed = parseStudentForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const db = createServiceClient()!;
  // 학생 등록은 개인정보 전환(privacy) — 감사 선기록(pending) 없이는 실행하지 않는다(fail-closed).
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "create",
      targetType: "student",
      targetId: null, // insert 전 선기록이라 새 행 id는 아직 없다 — after_data로 식별.
      summary: `학생 '${parsed.name}' 등록`,
      category: "privacy",
      // 연락처 원문은 감사 로그에 남기지 않는다 — 보유 여부만 기록(필드 서브셋).
      after: {
        name: parsed.name,
        school: parsed.school,
        grade: parsed.grade,
        class_type: parsed.classType,
        subject_type: parsed.subjectType,
        status: parsed.status,
        has_student_phone: Boolean(parsed.studentPhone),
        student_phone_consent: parsed.studentPhoneConsent,
      },
    },
    async () => {
      const { data: student, error } = await db
        .from("students")
        .insert({
          tenant_id: session.tenantId,
          name: parsed.name,
          parent_phone: parsed.parentPhone,
          student_phone: parsed.studentPhone,
          school: parsed.school,
          grade: parsed.grade,
          class_type: parsed.classType,
          subject_type: parsed.subjectType,
          status: parsed.status,
        })
        .select("id")
        .single();
      if (error || !student) {
        console.error("[students] insert failed", error);
        return { ok: false, error: "학생 등록 중 오류가 발생했습니다." };
      }

      // 동의 기록 실패 시 방금 등록한 학생을 보상 삭제하고 등록 자체를 실패 처리한다
      // (동의 이력 없는 학생 연락처 보유 금지 — lib/actions/consult.ts 보상 삭제 선례).
      if (parsed.studentPhone && parsed.studentPhoneConsent) {
        const consent = await recordStudentPhoneConsent(session.tenantId, student.id);
        if (!consent.ok) {
          const { error: cleanupError } = await db
            .from("students")
            .delete()
            .eq("tenant_id", session.tenantId)
            .eq("id", student.id);
          if (cleanupError) {
            console.error("[students] student cleanup failed", cleanupError);
          }
          return {
            ok: false,
            error:
              "학생 연락처 수집 동의 기록에 실패해 등록을 실행하지 않았습니다. 잠시 후 다시 시도해 주세요.",
          };
        }
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidatePath("/admin/students");
  return result;
}

export async function updateStudent(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  const parsed = parseStudentForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const db = createServiceClient()!;
  // 수정 전 행을 before_data로 남기기 위해 먼저 조회한다(연락처 원문은 보유 여부로만 요약).
  const { data: existing, error: fetchError } = await db
    .from("students")
    .select("name, school, grade, class_type, subject_type, status, student_phone")
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (fetchError || !existing) {
    console.error("[students] fetch before update failed", fetchError);
    return { ok: false, error: "학생 정보를 찾을 수 없습니다." };
  }

  // E-05 재등록 — 「종료 등록 재활성 금지: 종료된 등록을 다시 활성화하지 않고 새 등록을 생성」
  // (01_atlas_04 §17). status 폼 화이트리스트가 ended→active 되돌리기를 그대로 저장하던
  // 충돌(06_gap_summary E-05)을 서버에서 차단한다 — 종료 학생의 활성 전환은
  // reEnrollStudent(재등록 확인 절차)만 허용한다.
  if (existing.status === "ended" && parsed.status !== "ended") {
    return {
      ok: false,
      error:
        "종료된 등록은 수정 폼에서 상태를 되돌릴 수 없습니다. 학생 상세의 '재등록 확인' 절차를 이용해 주세요.",
    };
  }

  // E-04 등록 종료 — 「계약·등록 종료 → 포털 관계·접근 회수」(01_atlas_04 §17).
  // ended 전환은 개인정보 접근이 걸린 종료 사건이므로 요약·사유를 구분해 감사에 남기고,
  // 커밋 후 포털 접근 종료 안내를 발송한다(아래). 접근 회수 자체는
  // getStudentByPortalToken(lib/data/crm.ts)의 ended 차단이 즉시 수행한다.
  const isEnding = existing.status !== "ended" && parsed.status === "ended";

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "update",
      targetType: "student",
      targetId: id,
      summary: isEnding
        ? `학생 '${parsed.name}' 등록 종료(포털 접근 회수)`
        : `학생 '${parsed.name}' 정보 수정`,
      category: "privacy",
      ...(isEnding ? { reason: "등록 종료 — 포털 접근 회수(E-04)" } : {}),
      before: {
        name: existing.name,
        school: existing.school,
        grade: existing.grade,
        class_type: existing.class_type,
        subject_type: existing.subject_type,
        status: existing.status,
        has_student_phone: Boolean(existing.student_phone),
      },
      after: {
        name: parsed.name,
        school: parsed.school,
        grade: parsed.grade,
        class_type: parsed.classType,
        subject_type: parsed.subjectType,
        status: parsed.status,
        has_student_phone: Boolean(parsed.studentPhone),
        student_phone_consent: parsed.studentPhoneConsent,
      },
    },
    async () => {
      // 동의 기록은 감사 성격 — 수정 반영 전에 선기록하고, 실패하면 수정 자체를 실행하지 않는다.
      let consentId: string | null = null;
      if (parsed.studentPhone && parsed.studentPhoneConsent) {
        const consent = await recordStudentPhoneConsent(session.tenantId, id);
        if (!consent.ok) {
          return {
            ok: false,
            error:
              "학생 연락처 수집 동의 기록에 실패해 수정을 실행하지 않았습니다. 잠시 후 다시 시도해 주세요.",
          };
        }
        consentId = consent.id;
      }

      const { error } = await db
        .from("students")
        .update({
          name: parsed.name,
          parent_phone: parsed.parentPhone,
          student_phone: parsed.studentPhone,
          school: parsed.school,
          grade: parsed.grade,
          class_type: parsed.classType,
          subject_type: parsed.subjectType,
          status: parsed.status,
        })
        .eq("tenant_id", session.tenantId)
        .eq("id", id);
      if (error) {
        console.error("[students] update failed", error);
        // 수정이 반영되지 않았으므로 방금 선기록한 동의도 보상 삭제한다 —
        // 반영되지 않은 변경에 대한 동의 이력을 적립하지 않는다(createStudent 보상 삭제와 동일 정책).
        if (consentId) {
          const { error: cleanupError } = await db
            .from("consents")
            .delete()
            .eq("tenant_id", session.tenantId)
            .eq("id", consentId);
          if (cleanupError) {
            console.error("[students] consent cleanup failed", cleanupError);
          }
        }
        return { ok: false, error: "학생 정보 수정 중 오류가 발생했습니다." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  if (isEnding) {
    // E-04 — 종료 확정 후 학부모에게 포털 접근 종료를 안내한다. 안내(전달)는 종료 업무와
    // 분리된 계층이라 실패해도 종료 전환을 되돌리지 않는다 — notifications 큐에 남아
    // 크론 재시도(notifyRetry)·업무 큐로 수렴한다.
    const tenant = await resolveTenant();
    const notice = await sendNotification({
      tenantId: session.tenantId,
      studentId: id,
      type: "custom_message",
      phone: parsed.parentPhone,
      message: `[${tenant.brandName}] ${parsed.name} 학생의 등록이 종료되어 리포트 포털 접근도 함께 종료되었습니다. 그동안 함께해 주셔서 감사합니다.`,
      isAd: false,
    });
    if (!notice.ok) {
      console.error("[students] 등록 종료 안내 발송 실패", notice.error);
    }
  }

  revalidatePath("/admin/students");
  revalidatePath(`/admin/students/${id}`);
  return result;
}

/**
 * E-05 재등록 확인 절차 — 「종료 등록을 재활성하지 않고 새 신청·계약·결제·일정의 새 등록 생성」이
 * 정본이나, 현 모델은 등록이 students.status 하나로 표현되어 별도 등록 엔티티가 없다.
 * 완전한 등록 엔티티 분리(새 등록 행 생성·과거 학습이력 연결)는 M2 몫이고, 여기서는 최소 부합으로
 * ① 일반 수정 폼의 ended→active 직접 전환을 거부하고(updateStudent 가드)
 * ② 이 액션이 "재등록 확인"(관계·결제·일정 재확인 체크 + 사유)을 거쳐 활성 전환하되,
 *    조정 이력 공통 테이블 adjustments(domain 'enrollment')에 재등록을 상태 되돌리기가 아닌
 *    새 이력 사건으로 남긴다(00013 append-only — 승인된 사실은 덮어쓰지 않는다).
 */
export async function reEnrollStudent(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  // 재등록 확인 절차 — 본인·관계, 결제 조건, 일정을 다시 확인했음을 명시적으로 체크해야 한다.
  const relationConfirmed = formData.get("relationConfirmed") === "on";
  const paymentConfirmed = formData.get("paymentConfirmed") === "on";
  const scheduleConfirmed = formData.get("scheduleConfirmed") === "on";
  if (!relationConfirmed || !paymentConfirmed || !scheduleConfirmed) {
    return { ok: false, error: "재등록 확인 항목(관계·결제·일정)을 모두 확인해 주세요." };
  }
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: "재등록 사유를 입력해 주세요." };

  const db = createServiceClient()!;
  const { data: existing, error: fetchError } = await db
    .from("students")
    .select("name, status")
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (fetchError || !existing) {
    console.error("[students] fetch before re-enroll failed", fetchError);
    return { ok: false, error: "학생 정보를 찾을 수 없습니다." };
  }
  if (existing.status !== "ended") {
    return { ok: false, error: "종료(ended) 상태의 학생만 재등록할 수 있습니다." };
  }

  // 재등록은 개인정보 접근(포털 등)이 되살아나는 전환(privacy) — 감사 선기록 없이는 실행하지 않는다.
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "update",
      targetType: "student",
      targetId: id,
      summary: `학생 '${existing.name}' 재등록(종료 → 활성)`,
      category: "privacy",
      before: { status: "ended" },
      after: {
        status: "active",
        re_enrollment: true,
        relation_confirmed: relationConfirmed,
        payment_confirmed: paymentConfirmed,
        schedule_confirmed: scheduleConfirmed,
      },
      reason,
    },
    async () => {
      // 순서: 전환 → 이력 → (이력 실패 시) 전환 원복.
      // adjustments는 append-only(00013 트리거가 DELETE 거부)라 먼저 쌓은 이력을 보상 삭제할 수
      // 없으므로, 이력을 나중에 기록하고 실패하면 전환을 되돌려 "이력 없는 재등록"을 확정하지
      // 않는다(fail-closed — adjustments.ts 계약).
      const { data: updated, error } = await db
        .from("students")
        .update({ status: "active" })
        .eq("tenant_id", session.tenantId)
        .eq("id", id)
        .eq("status", "ended") // 동시 재등록 이중 실행 방지 — ended인 행만 전환된다.
        .select("id")
        .maybeSingle();
      if (error || !updated) {
        console.error("[students] re-enroll update failed", error);
        return { ok: false, error: "재등록 전환 중 오류가 발생했습니다." };
      }

      const adjustment = await recordAdjustment(session.tenantId, {
        domain: "enrollment",
        targetType: "student",
        targetId: id,
        before: { status: "ended" },
        after: {
          status: "active",
          re_enrollment: true,
          relation_confirmed: relationConfirmed,
          payment_confirmed: paymentConfirmed,
          schedule_confirmed: scheduleConfirmed,
        },
        reason,
        actorEmail: session.email,
      });
      if (!adjustment.ok) {
        // 이력 없는 재등록을 확정하지 않는다 — 전환 원복(보상).
        const { error: revertError } = await db
          .from("students")
          .update({ status: "ended" })
          .eq("tenant_id", session.tenantId)
          .eq("id", id)
          .eq("status", "active");
        if (revertError) {
          // 원복까지 실패 — 이력 없는 활성 상태가 남았다. 자동 재시도 대신
          // 정합 확인 업무로 수렴시킨다(복원·불일치는 사람 판정).
          console.error("[students] re-enroll revert failed", revertError);
          await createWorkItem(session.tenantId, {
            kind: "manual",
            title: `재등록 이력 기록 실패 — 학생 '${existing.name}' 정합 확인 필요`,
            sourceType: "student",
            sourceId: id,
            nextAction:
              "adjustments(enrollment) 이력 없이 active로 남은 상태 — 이력을 수기 보완하거나 종료로 원복할 것",
            priority: "privacy",
          });
        }
        return {
          ok: false,
          error: "재등록 이력 기록에 실패해 전환을 확정하지 않았습니다. 잠시 후 다시 시도해 주세요.",
        };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidatePath("/admin/students");
  revalidatePath(`/admin/students/${id}`);
  return result;
}

/** 리포트 포털 링크 재발급 — 기존 토큰을 새 값으로 회전(이전 링크 즉시 무효화). */
export async function regeneratePortalToken(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  const db = createServiceClient()!;
  // 토큰 회전은 접근 권한 전환(permission) — 감사 선기록 없이는 실행하지 않는다. 토큰 값은 기록 금지.
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "update",
      targetType: "student",
      targetId: id,
      summary: "포털 링크 재발급",
      category: "permission",
      reason: "기존 포털 링크 무효화 후 새 토큰 발급",
    },
    async () => {
      const { error } = await db
        .from("students")
        .update({ portal_token: randomBytes(16).toString("hex") })
        .eq("tenant_id", session.tenantId)
        .eq("id", id);
      if (error) {
        console.error("[students] portal token regenerate failed", error);
        return { ok: false, error: "링크 재발급 중 오류가 발생했습니다." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidatePath(`/admin/students/${id}`);
  return result;
}

export interface BulkStudentRow {
  name: string;
  parentPhone: string;
  school?: string;
  grade?: string;
  classType?: string;
}

export async function bulkCreateStudents(
  rows: BulkStudentRow[],
): Promise<CrmActionResult & { created?: number; skipped?: number }> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const valid = rows.filter((r) => r.name?.trim() && r.parentPhone?.trim());
  const skipped = rows.length - valid.length;
  if (valid.length === 0) {
    return { ok: false, error: "등록할 수 있는 유효한 행이 없습니다(이름·학부모 연락처 필수)." };
  }

  const db = createServiceClient()!;
  // 일괄 등록도 개인정보 전환(privacy) — 감사 선기록 없이는 실행하지 않는다(fail-closed).
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "create",
      targetType: "student",
      targetId: null, // 일괄 insert라 개별 행 id는 없다 — after_data의 건수로 요약.
      summary: `학생 CSV 일괄 등록 (${valid.length}건)`,
      category: "privacy",
      after: { count: valid.length, skipped },
    },
    async () => {
      const { error } = await db.from("students").insert(
        valid.map((r) => ({
          tenant_id: session.tenantId,
          name: r.name.trim(),
          parent_phone: r.parentPhone.trim(),
          school: r.school?.trim() || null,
          grade: r.grade?.trim() || null,
          class_type: VALID_CLASS_TYPES.includes(r.classType as ClassType)
            ? (r.classType as ClassType)
            : "inperson",
          status: "trial",
        })),
      );
      if (error) {
        console.error("[students] bulk insert failed", error);
        return { ok: false, error: "CSV 일괄 등록 중 오류가 발생했습니다." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidatePath("/admin/students");
  return { ...result, created: valid.length, skipped };
}

/* ==================================================================
   역할별 포털 초대·관계 관리 (P-01 역할별 초대 · P-06 관계 변경·권한 회수)
   정본: docs/flow-canon/01_atlas_02_portal_lessons.md P-01·P-02·P-06
        · 03_scenarios_133.md 검수 16(역할 조합 독립)·20(재발급 시 이전 초대 무효)
        · 21(관계 종료 = 세션·초대·공유경로 전부 닫힘)·124(기존 대상 재사용)·125(반쪽 수락 금지)

   이 블록은 기존 함수를 건드리지 않는다. students.portal_token 기반 리포트 링크
   (regeneratePortalToken · /portal/[token])는 그대로 병행 운영하고, 자동 은퇴도 하지 않는다
   — 전환 시점은 운영자 판단이다(열린 결정 #1).

   상태 전환의 실체는 전부 lib/portal/auth.ts(rotateAccessLink · revokeRelation)에 있다.
   여기서는 ① 운영자 인증·테넌트 스코프 ② 입력 정규화 ③ 감사(runCritical permission)
   ④ 초대 전달(sendNotification)만 담당한다 — 한 사건 한 기록 원칙에 따라 감사는 이 층에서만 남긴다.
   ================================================================== */

/**
 * 초대 링크의 호스트 — 지금 운영자가 쓰고 있는 요청 호스트를 그대로 쓴다.
 *
 * 고정 상수(NEXT_PUBLIC_SITE_URL)를 쓰면 1호 테넌트가 아닌 운영자가 발급한 링크가 전부
 * 남의 도메인을 가리키고, 수락 라우트는 호스트로 테넌트를 판정하므로(lib/portal/auth.ts)
 * "사용할 수 없는 링크"로 끝난다 — 발급과 수락이 같은 호스트를 보게 여기서 맞춘다.
 * 로컬 개발에서도 자동으로 localhost 링크가 나온다.
 */
async function portalOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-tenant-host") ?? h.get("host") ?? "";
  if (!host) return process.env.NEXT_PUBLIC_SITE_URL ?? "https://axiommathlab.kr";
  const forwarded = h.get("x-forwarded-proto");
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const proto = forwarded ?? (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}

/** 관계당 초대 발급·재발급 결과 — 링크는 발급 순간에만 원문으로 존재한다(DB엔 해시만). */
export interface PortalInviteResult extends CrmActionResult {
  /**
   * 발급된 초대 링크 전체 주소. 알림 발송이 실패해도 발급을 되돌리지 않으므로,
   * 운영자가 직접 전달할 수 있게 화면에 그대로 돌려준다(P-01 「발송 실패: 같은 초대를 다시 전달」).
   * 이 값은 이번 응답에만 존재한다 — 새로고침하면 사라지고, 다시 보려면 재발급뿐이다.
   */
  link?: string;
  /** 발급은 성공했으나 운영자가 알아야 하는 사실(기존 연락처 재사용·알림 실패 등). */
  warnings?: string[];
}

/**
 * 관계 되살리기·발급 과정의 중간 결과 — runCritical의 T로 쓰인다.
 * 성공 시 link가 반드시 있는 판별 유니온이라, 호출부가 non-null 단언 없이 링크를 쓸 수 있다.
 */
type PortalInviteMutation =
  | { ok: true; link: string; warnings?: string[]; error?: undefined }
  | { ok: false; error: string; link?: undefined; warnings?: undefined };

/**
 * 전화번호 정규화 — 숫자만 남긴다.
 *
 * 결제선생 연동에서 얻은 교훈: 같은 사람의 번호가 '010-1234-5678'·'010 1234 5678'·
 * '+82 10-1234-5678'로 제각각 들어오면 대사(對査)가 사람 단위로 모이지 않아 중복 주체가 생긴다.
 * portal_contacts는 (tenant_id, phone) 유니크로 사람을 식별하므로(검수 124), 정규화가 무너지면
 * 같은 사람이 서로 다른 contact 두 개로 갈라지고 회수(검수 21)도 반쪽만 걸린다.
 * 그래서 저장 직전 한 곳에서만 정규화하고, DB에도 같은 규칙의 CHECK(^[0-9]{9,12}$)를 둔다.
 * 국가번호 표기(+82 10…)는 선행 82를 0으로 되돌려 국내 표기 하나로 수렴시킨다.
 */
function normalizePortalPhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("82") && digits.length >= 11) {
    digits = `0${digits.slice(2)}`;
  }
  return digits;
}

/**
 * 초대 링크 전체 주소.
 *
 * 경로는 수락 라우트(app/p/link/[token]/route.ts)가 정본이다 — 발송한 주소와 수락하는 주소가
 * 어긋나면 초대가 전부 404가 되므로, 실제 라우트 파일 경로를 그대로 따른다.
 * 경로 규약은 lib/portal/auth.ts의 portalLinkPath 하나로 모은다(발송·수락이 갈라지지 않게).
 */
async function portalInviteUrl(token: string): Promise<string> {
  return `${await portalOrigin()}${portalLinkPath(token)}`;
}

/**
 * 초대 링크 발송. 발송 실패는 발급을 되돌리지 않는다 —
 * 업무(초대 발급)와 전달(알림)은 서로 다른 계층이고, 실패 건은 notifications 큐(재시도 크론)로
 * 수렴한다. 호출부는 반환된 경고를 화면에 띄우고 링크를 직접 전달할 수 있게 한다.
 */
async function sendPortalInvite(
  tenantId: string,
  studentId: string,
  contactName: string,
  phone: string,
  link: string,
): Promise<string | null> {
  const tenant = await resolveTenant();
  // 문구에 학생 실명·수업·금전 정보를 담지 않는다 — 링크 자체가 로그인 수단이라 오수신 시 피해가 커진다.
  const message = `[${tenant.brandName}] ${renderTemplate("portal_invite", {
    name: contactName,
  })}\n${link}`;
  const sent = await sendNotification({
    tenantId,
    studentId,
    type: "portal_invite",
    phone,
    message,
    isAd: false,
  });
  if (sent.ok || sent.skipped) return null;
  console.error("[students] 포털 초대 발송 실패 — 발급은 유지, 링크 직접 전달 필요", sent.error);
  return "초대 문자 발송에 실패했습니다. 아래 링크를 직접 전달해 주세요(발급은 완료됨).";
}

/**
 * 역할별 포털 초대 발급 (P-01).
 *
 * 한 번의 실행이 세 가지를 한다: 사람(contact) 확보 → 역할 관계(relation) 확보 → 초대 링크 발급.
 *  · 사람: 같은 테넌트에 같은 번호가 이미 있으면 그 사람을 재사용한다 — 새 주체를 만들지 않는다(검수 124).
 *  · 관계: (사람, 학생, 역할) 하나당 행 하나. 겸임은 역할별 행이라 권한이 서로 독립이다(검수 16).
 *    회수됐던 관계를 다시 초대하면 같은 행이 invited로 되살아난다(중복 행을 쌓지 않는다).
 *  · 링크: rotateAccessLink가 이전 링크를 무효화하고 새로 발급한다 — 살아 있는 링크는 늘 하나(검수 20).
 *
 * 권한 전환이므로 runCritical(category "permission")으로 감싼다. 감사 기록에 토큰·링크는 넣지 않는다
 * (감사 로그 열람 권한이 곧 포털 로그인 권한이 되어서는 안 된다).
 */
export async function invitePortalRelation(
  formData: FormData,
): Promise<PortalInviteResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const studentId = String(formData.get("studentId") ?? "");
  const roleRaw = String(formData.get("role") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const phoneRaw = String(formData.get("phone") ?? "").trim();

  if (!studentId) return { ok: false, error: "잘못된 요청입니다." };
  if (!isPortalRole(roleRaw)) return { ok: false, error: "역할을 선택해 주세요." };
  const role: PortalRole = roleRaw;
  if (!name) return { ok: false, error: "이름을 입력해 주세요." };

  const phone = normalizePortalPhone(phoneRaw);
  if (!/^[0-9]{9,12}$/.test(phone)) {
    return {
      ok: false,
      error: "연락처를 다시 확인해 주세요(숫자 9~12자리, 예: 010-1234-5678).",
    };
  }

  const db = createServiceClient()!;
  const { data: student, error: studentError } = await db
    .from("students")
    .select("id, name, status")
    .eq("tenant_id", session.tenantId)
    .eq("id", studentId)
    .maybeSingle();
  if (studentError) {
    console.error("[students] portal invite student lookup failed", studentError);
    return { ok: false, error: "학생 정보를 확인하지 못했습니다." };
  }
  if (!student) return { ok: false, error: "학생을 찾을 수 없습니다." };
  // 종료 학생의 관계는 링크를 눌러도 열리지 않는다(E-04 — issuePortalSessionFromLink의 ended 차단).
  // 열리지 않을 링크를 발송해 공유 사고만 만드는 경로를 앞단에서 닫는다.
  if (student.status === "ended") {
    return {
      ok: false,
      error:
        "등록이 종료된 학생에게는 포털 초대를 발급할 수 없습니다. 재등록 확인 절차를 먼저 진행해 주세요.",
    };
  }

  const result = await runCritical<PortalInviteMutation>(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "create",
      targetType: "portal_relation",
      targetId: null, // 관계 id는 이 트랜잭션 안에서 확정된다 — 요약·after_data로 대상을 특정한다.
      summary: `포털 초대 발급 — ${student.name} / ${PORTAL_ROLE_LABEL[role]} ${name}`,
      category: "permission",
      reason: "역할별 포털 접근 권한 부여(P-01)",
      after: {
        student_id: studentId,
        role,
        contact_name: name,
        // 번호 원문은 남기지 않는다 — 감사 열람이 연락처 열람이 되지 않게 뒷 4자리만.
        contact_phone_tail: phone.slice(-4),
      },
    },
    async (): Promise<PortalInviteMutation> => {
      const warnings: string[] = [];

      /* ① 사람 — 같은 번호면 기존 사람을 재사용한다(검수 124: 새 주체를 만들지 않는다). */
      let contactId: string | null = null;
      const { data: existingContact, error: contactLookupError } = await db
        .from("portal_contacts")
        .select("id, name")
        .eq("tenant_id", session.tenantId)
        .eq("phone", phone)
        .maybeSingle();
      if (contactLookupError) {
        console.error("[students] portal contact lookup failed", contactLookupError);
        return { ok: false, error: "연락처 조회 중 오류가 발생했습니다." };
      }
      if (existingContact) {
        contactId = existingContact.id as string;
        const existingName = existingContact.name as string;
        // 이름은 덮어쓰지 않는다: 같은 번호에 이미 다른 이름이 연결돼 있으면 오타이거나
        // 가족 공용 번호다. 여기서 이름을 갈아치우면 그 사람의 다른 역할·다른 학생 관계 표시까지
        // 함께 바뀐다 — 사실 확인 없이 남의 기록을 고치지 않고, 운영자에게 알리기만 한다.
        if (existingName !== name) {
          warnings.push(
            `이미 등록된 연락처라 기존 이름 '${existingName}'으로 연결했습니다. 이름을 바꾸려면 별도로 확인해 주세요.`,
          );
        }
      } else {
        const { data: created, error: contactInsertError } = await db
          .from("portal_contacts")
          .insert({ tenant_id: session.tenantId, name, phone })
          .select("id")
          .single();
        if (contactInsertError) {
          // 23505 = 동시 발급으로 같은 번호가 방금 들어온 경우 — 새로 만들지 말고 그 사람으로 수렴한다.
          if (contactInsertError.code === "23505") {
            const { data: raced } = await db
              .from("portal_contacts")
              .select("id")
              .eq("tenant_id", session.tenantId)
              .eq("phone", phone)
              .maybeSingle();
            contactId = (raced?.id as string | undefined) ?? null;
          }
          if (!contactId) {
            console.error("[students] portal contact insert failed", contactInsertError);
            return { ok: false, error: "연락처 등록 중 오류가 발생했습니다." };
          }
        } else {
          contactId = created.id as string;
        }
      }

      /* ② 관계 — (사람, 학생, 역할) 하나당 행 하나. 겸임은 역할별로 독립이다(검수 16). */
      const { data: existingRelation, error: relationLookupError } = await db
        .from("portal_relations")
        .select("id, status, invited_at, accepted_at, revoked_at, revoked_reason")
        .eq("tenant_id", session.tenantId)
        .eq("contact_id", contactId)
        .eq("student_id", studentId)
        .eq("role", role)
        .maybeSingle();
      if (relationLookupError) {
        console.error("[students] portal relation lookup failed", relationLookupError);
        return { ok: false, error: "포털 관계 조회 중 오류가 발생했습니다." };
      }

      let relationId: string;
      // 링크 발급이 실패했을 때 방금 만든 관계만 되돌리기 위한 표시(사람 행은 지우지 않는다 —
      // 00017의 "contact는 삭제하지 않는다" 규율. 관계 없는 사람 행은 아무 권한도 열지 않는다).
      let createdRelation = false;
      // 회수됐던 관계를 되살린 경우의 원상 복구값 — 링크 발급이 실패하면 회수 시각·사유를
      // 그대로 되돌린다(되살리기만 남고 감사는 aborted로 닫히는 반쪽 상태를 만들지 않는다).
      let revivedFrom: {
        invited_at: string | null;
        accepted_at: string | null;
        revoked_at: string | null;
        revoked_reason: string | null;
      } | null = null;
      if (!existingRelation) {
        const { data: inserted, error: relationInsertError } = await db
          .from("portal_relations")
          .insert({
            tenant_id: session.tenantId,
            contact_id: contactId,
            student_id: studentId,
            role,
            status: "invited",
          })
          .select("id")
          .single();
        if (relationInsertError) {
          // 같은 (사람·학생·역할) 관계를 동시에 두 번 만들려는 경합 — 유니크 위반은 오류가
          // 아니라 "이미 있다"는 사실이다. 기존 행으로 수렴시켜 정상 동작을 실패로 보고하지 않는다.
          if (relationInsertError.code === "23505") {
            const { data: raced } = await db
              .from("portal_relations")
              .select("id")
              .eq("tenant_id", session.tenantId)
              .eq("contact_id", contactId)
              .eq("student_id", studentId)
              .eq("role", role)
              .maybeSingle();
            if (!raced) {
              return { ok: false, error: "포털 관계 생성 중 오류가 발생했습니다." };
            }
            relationId = (raced as { id: string }).id;
            warnings.push("이미 발급된 초대입니다. 링크를 새로 발급했습니다(이전 링크는 무효).");
          } else {
            console.error("[students] portal relation insert failed", relationInsertError);
            return { ok: false, error: "포털 관계 생성 중 오류가 발생했습니다." };
          }
        } else {
          relationId = inserted.id as string;
          createdRelation = true;
        }
      } else {
        relationId = existingRelation.id as string;
        const status = existingRelation.status as string;
        if (status === "revoked") {
          revivedFrom = {
            invited_at: (existingRelation as { invited_at?: string | null }).invited_at ?? null,
            accepted_at: (existingRelation as { accepted_at?: string | null }).accepted_at ?? null,
            revoked_at: (existingRelation as { revoked_at?: string | null }).revoked_at ?? null,
            revoked_reason:
              (existingRelation as { revoked_reason?: string | null }).revoked_reason ?? null,
          };
          // 회수됐던 관계의 재초대 — 같은 행을 invited로 되살린다(중복 행을 쌓지 않는다).
          // accepted_at도 지운다: 회수 전의 수락은 지금 권한의 근거가 아니므로, 다시 눌러
          // 다시 수락하게 한다(수락 여부 표시가 사실과 어긋나지 않게).
          const { error: reviveError } = await db
            .from("portal_relations")
            .update({
              status: "invited",
              invited_at: new Date().toISOString(),
              accepted_at: null,
              revoked_at: null,
              revoked_reason: null,
            })
            .eq("tenant_id", session.tenantId)
            .eq("id", relationId);
          if (reviveError) {
            console.error("[students] portal relation revive failed", reviveError);
            return { ok: false, error: "회수된 관계를 되살리는 중 오류가 발생했습니다." };
          }
        } else if (status === "active") {
          // 이미 수락된 관계 — 새 관계를 만들지 않고 링크만 새로 발급한다(P-01 재사용 규칙).
          warnings.push(
            "이미 수락된 관계입니다. 새 관계를 만들지 않고 링크만 새로 발급했습니다(이전 링크는 무효).",
          );
        } else {
          warnings.push("이미 발급된 초대입니다. 링크를 새로 발급했습니다(이전 링크는 무효).");
        }
      }

      /* ③ 링크 — 이전 링크를 먼저 무효화하고 새로 발급한다(검수 20). */
      const rotated = await rotateAccessLink(
        session.tenantId,
        relationId,
        createdRelation ? "초대 발급" : "초대 재발급",
      );
      if (!rotated.ok) {
        // 반쪽 상태 방지: 이번에 만든 관계는 되돌린다. 링크 없는 관계는 아무도 열 수 없지만,
        // 화면에 "초대됨"으로 남아 운영자가 발급됐다고 오인하게 만든다.
        if (createdRelation) {
          const { error: cleanupError } = await db
            .from("portal_relations")
            .delete()
            .eq("tenant_id", session.tenantId)
            .eq("id", relationId);
          if (cleanupError) {
            console.error("[students] portal relation cleanup failed", cleanupError);
          }
        } else if (revivedFrom) {
          // 회수 상태로 되돌린다 — 되살리기만 남으면 회수 시각·사유가 영구 소실되고
          // 권한은 부활한 채 감사만 aborted로 닫히는 반쪽 상태가 된다.
          const { error: restoreError } = await db
            .from("portal_relations")
            .update({ status: "revoked", ...revivedFrom })
            .eq("tenant_id", session.tenantId)
            .eq("id", relationId);
          if (restoreError) {
            console.error("[students] portal relation revive rollback failed", restoreError);
            await createWorkItem(session.tenantId, {
              kind: "manual",
              title: "포털 관계 되살리기 롤백 실패 — 권한 상태 확인 필요",
              detail: `relationId=${relationId} · 회수됐던 관계가 invited로 남았을 수 있음`,
              sourceType: "portal_relation",
              sourceId: relationId,
              nextAction: "해당 관계의 회수/초대 상태를 확인해 정정",
              priority: "risk",
            });
          }
        }
        return { ok: false, error: rotated.error };
      }

      return { ok: true, link: await portalInviteUrl(rotated.token), warnings };
    },
  );
  if (!result.ok) return result;

  const warnings = [...(result.warnings ?? [])];
  if (result.auditWarning) warnings.push(result.auditWarning);
  const link = result.link;
  const notifyWarning = await sendPortalInvite(
    session.tenantId,
    studentId,
    name,
    phone,
    link,
  );
  if (notifyWarning) warnings.push(notifyWarning);

  revalidatePath(`/admin/students/${studentId}`);
  return { ok: true, link, warnings };
}

/**
 * 초대 링크 재발송 (P-01 「새 초대 발급: 이전 초대 즉시 무효」·검수 20).
 *
 * 관계는 그대로 두고 링크만 회전한다 — 오수신·분실 시의 정상 경로다.
 * 회수된 관계에는 발급하지 않는다(rotateAccessLink가 거절한다): 재발송 버튼 하나가
 * 회수된 권한을 되살리는 경로가 되면 안 되고, 부활은 언제나 명시적인 재초대여야 한다.
 */
export async function resendPortalInvite(
  relationId: string,
): Promise<PortalInviteResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  if (!relationId) return { ok: false, error: "잘못된 요청입니다." };

  const db = createServiceClient()!;
  const { data: relation, error: relationError } = await db
    .from("portal_relations")
    .select("id, role, status, student_id, contact_id")
    .eq("tenant_id", session.tenantId)
    .eq("id", relationId)
    .maybeSingle();
  if (relationError) {
    console.error("[students] portal relation lookup failed", relationError);
    return { ok: false, error: "포털 관계를 확인하지 못했습니다." };
  }
  if (!relation) return { ok: false, error: "포털 관계를 찾을 수 없습니다." };
  if (relation.status === "revoked") {
    return {
      ok: false,
      error: "회수된 관계입니다. 다시 초대하려면 아래 초대 발급 폼으로 새로 발급해 주세요.",
    };
  }

  const { data: contact, error: contactError } = await db
    .from("portal_contacts")
    .select("name, phone")
    .eq("tenant_id", session.tenantId)
    .eq("id", relation.contact_id as string)
    .maybeSingle();
  if (contactError || !contact) {
    console.error("[students] portal contact lookup failed", contactError);
    return { ok: false, error: "초대 대상 연락처를 확인하지 못했습니다." };
  }

  const studentId = relation.student_id as string;
  const roleRaw = relation.role as string;
  const roleLabel = isPortalRole(roleRaw) ? PORTAL_ROLE_LABEL[roleRaw] : roleRaw;

  const result = await runCritical<PortalInviteMutation>(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "update",
      targetType: "portal_relation",
      targetId: relationId,
      summary: `포털 초대 링크 재발급 — ${roleLabel} ${contact.name as string}`,
      category: "permission",
      reason: "기존 초대 링크 무효화 후 새 링크 발급(P-01·검수 20)",
    },
    async (): Promise<PortalInviteMutation> => {
      const rotated = await rotateAccessLink(session.tenantId, relationId, "초대 재발급");
      if (!rotated.ok) return { ok: false, error: rotated.error };
      return { ok: true, link: await portalInviteUrl(rotated.token) };
    },
  );
  if (!result.ok) return result;

  const warnings: string[] = [];
  if (result.auditWarning) warnings.push(result.auditWarning);
  const link = result.link;
  const notifyWarning = await sendPortalInvite(
    session.tenantId,
    studentId,
    contact.name as string,
    contact.phone as string,
    link,
  );
  if (notifyWarning) warnings.push(notifyWarning);

  revalidatePath(`/admin/students/${studentId}`);
  return { ok: true, link, warnings };
}

/**
 * 포털 관계 회수 (P-06 · 검수 21).
 *
 * 실행은 lib/portal/auth.ts revokeRelation 하나로 모인다 — 관계 종료 + 초대 링크 무효화 +
 * (그 사람에게 남은 active 관계가 없으면) 세션 회수까지 한 흐름이다.
 * 다른 학생·다른 역할 관계가 남아 있으면 세션은 유지된다: 남은 관계의 범위로만 열리고,
 * 회수된 관계는 다음 요청부터 사라진다(getPortalSession이 매 요청 active 관계를 다시 계산).
 *
 * 권한 회수는 데이터 삭제가 아니다(P-06) — 관계 행·사람 행은 이력으로 남는다.
 */
export async function revokePortalRelation(
  relationId: string,
  reason: string,
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  if (!relationId) return { ok: false, error: "잘못된 요청입니다." };

  const trimmedReason = reason.trim();
  // 사유 없는 회수는 남기지 않는다 — 나중에 "왜 끊겼나"를 원 사건과 대조할 수 없다(P-11).
  if (!trimmedReason) return { ok: false, error: "회수 사유를 입력해 주세요." };

  const db = createServiceClient()!;
  const { data: relation, error: relationError } = await db
    .from("portal_relations")
    .select("id, role, status, student_id, contact_id")
    .eq("tenant_id", session.tenantId)
    .eq("id", relationId)
    .maybeSingle();
  if (relationError) {
    console.error("[students] portal relation lookup failed", relationError);
    return { ok: false, error: "포털 관계를 확인하지 못했습니다." };
  }
  if (!relation) return { ok: false, error: "포털 관계를 찾을 수 없습니다." };

  const { data: contact } = await db
    .from("portal_contacts")
    .select("name")
    .eq("tenant_id", session.tenantId)
    .eq("id", relation.contact_id as string)
    .maybeSingle();

  const studentId = relation.student_id as string;
  const roleRaw = relation.role as string;
  const roleLabel = isPortalRole(roleRaw) ? PORTAL_ROLE_LABEL[roleRaw] : roleRaw;

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "update",
      targetType: "portal_relation",
      targetId: relationId,
      summary: `포털 관계 회수 — ${roleLabel} ${(contact?.name as string | undefined) ?? "(이름 없음)"}`,
      category: "permission",
      reason: trimmedReason,
      before: { status: relation.status, role: roleRaw, student_id: studentId },
      after: { status: "revoked" },
    },
    async () => {
      const revoked = await revokeRelation(session.tenantId, relationId, trimmedReason);
      if (!revoked.ok) return { ok: false, error: revoked.error };
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidatePath(`/admin/students/${studentId}`);
  return result;
}
