"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { getConsultation } from "@/lib/data/crm";
import { logActivity, runCritical } from "@/lib/data/activity";
import { createReportRow } from "@/lib/data/reports";
import { generateReport } from "@/lib/ai/generate";
import { pseudonymize } from "@/lib/ai/pseudonym";
import { REPORT_PROMPT_RULES } from "@/lib/ai/validate";
import { sendNotification } from "@/lib/notify/send";
import { renderTemplate } from "@/lib/notify/templates";
import type { ConsultationStatus } from "@/lib/types";
import type { CrmActionResult } from "@/components/admin/crm/types";
import { AI_REPORT_DISCLAIMER } from "../reports/constants";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";
const CONSULTATION_STATUSES: ConsultationStatus[] = [
  "new",
  "contacted",
  "trial",
  "registered",
  "hold",
];

function revalidateConsultation(id: string) {
  revalidatePath("/admin/consultations");
  revalidatePath(`/admin/consultations/${id}`);
}

export async function updateConsultationStatus(
  id: string,
  status: string,
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  if (!CONSULTATION_STATUSES.includes(status as ConsultationStatus)) {
    return { ok: false, error: "올바르지 않은 상태입니다." };
  }

  const db = createServiceClient()!;
  const { error } = await db
    .from("consultations")
    .update({ status })
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[consultations] status update failed", error);
    return { ok: false, error: "상태 변경 중 오류가 발생했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "update",
    "consultation",
    id,
    `상담 상태 변경 (${status})`,
  );

  revalidateConsultation(id);
  return { ok: true };
}

export async function updateConsultationMemo(
  formData: FormData,
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "");
  const memo = String(formData.get("memo") ?? "").trim();
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  const db = createServiceClient()!;
  const { error } = await db
    .from("consultations")
    .update({ memo: memo || null })
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[consultations] memo update failed", error);
    return { ok: false, error: "메모 저장 중 오류가 발생했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "update",
    "consultation",
    id,
    "상담 메모 수정",
  );

  revalidateConsultation(id);
  return { ok: true };
}

/**
 * ③ 시범수업 확정 안내(→학부모, 관리자 버튼·수동). 일시를 입력받아 알림톡/SMS로 발송한다.
 */
export async function sendTrialScheduledNotice(
  formData: FormData,
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "");
  const dateText = String(formData.get("date") ?? "").trim();
  if (!id) return { ok: false, error: "잘못된 요청입니다." };
  if (!dateText) return { ok: false, error: "시범수업 일시를 입력해 주세요." };

  const db = createServiceClient()!;
  const { data, error } = await db
    .from("consultations")
    .select("name, phone, guardian_phone, student_id")
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    console.error("[consultations] trial-notice fetch failed", error);
    return { ok: false, error: "상담 정보를 찾을 수 없습니다." };
  }
  const row = data as {
    name: string;
    phone: string;
    guardian_phone: string | null;
    student_id: string | null;
  };
  const phone = row.guardian_phone || row.phone;

  const result = await sendNotification({
    tenantId: session.tenantId,
    studentId: row.student_id,
    type: "trial_scheduled",
    phone,
    message: renderTemplate("trial_scheduled", { name: row.name, date: dateText }),
    isAd: false,
  });
  if (!result.ok) {
    return { ok: false, error: result.error ?? "알림 발송에 실패했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "notify",
    "consultation",
    id,
    `시범수업 확정 안내 발송 (${dateText})`,
  );

  revalidateConsultation(id);
  return { ok: true };
}

/**
 * 상담 → 학생 원클릭 전환. student_phone은 본인 연락처 동의 흐름이 없어 null 고정(추후 consents 확인 후 채움).
 */
export async function convertToStudent(
  id: string,
): Promise<CrmActionResult & { studentId?: string }> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const { data: consultation, error: fetchError } = await db
    .from("consultations")
    .select("*")
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (fetchError || !consultation) {
    console.error("[consultations] convert fetch failed", fetchError);
    return { ok: false, error: "상담 정보를 찾을 수 없습니다." };
  }
  if (consultation.student_id) {
    return { ok: false, error: "이미 학생으로 전환된 상담입니다." };
  }

  // 상담→학생 전환은 개인정보 전환(privacy) — 감사 선기록(pending) 없이는 실행하지 않는다(fail-closed).
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "create",
      targetType: "student",
      targetId: null, // insert 전 선기록이라 새 학생 id는 아직 없다 — before/after로 식별.
      summary: "상담→학생 전환",
      category: "privacy",
      before: { consultation_id: id, status: consultation.status },
      after: {
        consultation_id: id,
        status: "registered",
        class_type: consultation.class_type || "inperson",
      },
    },
    async (): Promise<
      { ok: true; studentId: string } | { ok: false; error: string }
    > => {
      const { data: student, error: insertError } = await db
        .from("students")
        .insert({
          tenant_id: session.tenantId,
          name: consultation.name,
          parent_phone: consultation.guardian_phone || consultation.phone,
          student_phone: null,
          class_type: consultation.class_type || "inperson",
          status: "trial",
        })
        .select("id")
        .single();
      if (insertError || !student) {
        console.error("[consultations] student insert failed", insertError);
        return { ok: false, error: "학생 전환 중 오류가 발생했습니다." };
      }

      // 전환 실패 시 전환 전 상태로 되돌리는 보상 롤백(lib/actions/consult.ts 보상 삭제 선례).
      const rollbackConversion = async () => {
        const { error: revertError } = await db
          .from("consultations")
          .update({ student_id: null, status: consultation.status })
          .eq("tenant_id", session.tenantId)
          .eq("id", id);
        if (revertError) console.error("[consultations] link revert failed", revertError);
        const { error: cleanupError } = await db
          .from("students")
          .delete()
          .eq("tenant_id", session.tenantId)
          .eq("id", student.id);
        if (cleanupError) console.error("[consultations] student cleanup failed", cleanupError);
      };

      const { error: updateError } = await db
        .from("consultations")
        .update({ student_id: student.id, status: "registered" })
        .eq("tenant_id", session.tenantId)
        .eq("id", id);
      if (updateError) {
        console.error("[consultations] link update failed", updateError);
        // 연결 실패 — 방금 만든 학생 행을 보상 삭제해 반쪽 전환을 남기지 않는다.
        const { error: cleanupError } = await db
          .from("students")
          .delete()
          .eq("tenant_id", session.tenantId)
          .eq("id", student.id);
        if (cleanupError) console.error("[consultations] student cleanup failed", cleanupError);
        return { ok: false, error: "상담 연결 중 오류가 발생했습니다." };
      }

      // 상담 동의를 학생 레코드로 이관(감사 가시성). 동의 이력은 감사 성격이라
      // 조회·이관 실패 시 전환 전체를 롤백하고 실패 처리한다(동의 이관 없는 전환 확정 금지).
      const { data: priorConsents, error: consentFetchError } = await db
        .from("consents")
        .select("item, policy_version, via")
        .eq("tenant_id", session.tenantId)
        .eq("subject_type", "consultation")
        .eq("subject_id", id);
      if (consentFetchError) {
        console.error("[consultations] consent fetch failed", consentFetchError);
        await rollbackConversion();
        return {
          ok: false,
          error: "동의 이력 확인에 실패해 학생 전환을 실행하지 않았습니다. 잠시 후 다시 시도해 주세요.",
        };
      }
      if (priorConsents && priorConsents.length > 0) {
        const { error: consentCopyError } = await db.from("consents").insert(
          priorConsents.map((c) => ({
            tenant_id: session.tenantId,
            subject_type: "student",
            subject_id: student.id,
            item: c.item,
            policy_version: c.policy_version,
            via: c.via,
          })),
        );
        if (consentCopyError) {
          console.error("[consultations] consent copy failed", consentCopyError);
          await rollbackConversion();
          return {
            ok: false,
            error: "동의 이력 이관에 실패해 학생 전환을 실행하지 않았습니다. 잠시 후 다시 시도해 주세요.",
          };
        }
      }
      return { ok: true, studentId: student.id };
    },
  );
  if (!result.ok) return result;

  revalidateConsultation(id);
  revalidatePath("/admin/students");
  revalidatePath(`/admin/students/${result.studentId}`);
  return result;
}

/**
 * 상담 브리핑 AI — 가명화해 내부용 요약 생성. 실명(신청자·보호자)은 프롬프트에 미전송.
 */
export async function generateConsultBrief(
  id: string,
): Promise<CrmActionResult & { reportId?: string }> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const consultation = await getConsultation(session.tenantId, id);
  if (!consultation) return { ok: false, error: "상담 정보를 찾을 수 없습니다." };

  const lines = [
    `과목: ${consultation.subject ?? "-"}`,
    `수업 유형: ${
      consultation.classType === "video" ? "화상" : consultation.classType === "inperson" ? "대면" : "-"
    }`,
    `학생 본인 신청: ${consultation.isStudentSelf ? "예" : "아니오"}`,
  ];
  if (consultation.checklistItems.length > 0) {
    lines.push(`자기진단 체크리스트: ${consultation.checklistItems.join(", ")}`);
  }
  if (consultation.prefill) {
    lines.push(
      `수업료 계산기 프리필: 방식 ${consultation.prefill.mode ?? "-"} · 회당 ${consultation.prefill.hours ?? "-"}시간 · 주당 ${consultation.prefill.freq ?? "-"}회`,
    );
  }
  if (consultation.message) lines.push(`상담 신청 메시지: ${consultation.message}`);
  if (consultation.memo) lines.push(`관리자 메모: ${consultation.memo}`);

  let context = `신청자: ${consultation.name}\n${lines.join("\n")}`;
  context = pseudonymize(context, consultation.name);
  if (consultation.guardianName) {
    context = pseudonymize(context, consultation.guardianName);
  }

  const prompt = [
    "다음은 한 상담 신청 내용입니다. 선생님이 상담 전 참고할 수 있는 내부용 브리핑을 한국어로 작성해 주세요.",
    "신청자 배경, 핵심 니즈, 상담 시 확인할 체크리스트를 정리해 주세요.",
    "신청서의 자기보고 성적은 확정 사실이 아니므로 '신청서에 기입함'으로 표시하세요.",
    REPORT_PROMPT_RULES,
    "",
    context,
  ].join("\n");

  // 상담 브리핑 생성은 성적·평가 정보 전환(grade) — 감사 선기록 없이는 생성하지 않는다(fail-closed).
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "generate_consult_brief",
      targetType: "consultation",
      targetId: id,
      summary: "상담 브리핑 생성",
      category: "grade",
    },
    async (): Promise<
      { ok: true; reportId: string } | { ok: false; error: string }
    > => {
      const generated = await generateReport("consult_brief", "basic", prompt);
      if (!generated.ok || !generated.content) {
        return { ok: false, error: generated.error ?? "브리핑 생성에 실패했습니다." };
      }

      const created = await createReportRow({
        tenantId: session.tenantId,
        studentId: consultation.studentId,
        type: "consult_brief",
        audience: "internal",
        depth: "basic",
        content: generated.content + AI_REPORT_DISCLAIMER,
        modelUsed: generated.modelUsed ?? null,
        tokenUsage: generated.tokenUsage ?? null,
      });
      if (!created.ok) return created;
      return { ok: true, reportId: created.id };
    },
  );
  if (!result.ok) return result;

  revalidatePath("/admin/reports");
  return result;
}
