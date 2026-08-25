"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { runCritical } from "@/lib/data/activity";
import { recordAdjustment } from "@/lib/data/adjustments";
import { createWorkItem } from "@/lib/data/work";
import { sendNotification } from "@/lib/notify/send";
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
