"use server";

import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { resolveTenant } from "@/lib/tenant";
import { logActivity } from "@/lib/data/activity";
import { sendNotification } from "@/lib/notify/send";
import type { CrmActionResult } from "@/components/admin/crm/types";

// 관리자 직접 발송 — ⑫ 개별 메시지 / ⑪ 재등록 안내(광고성).
// 광고성은 send.ts가 마케팅 수신동의를 강제하고, (광고) 표기·야간(21~08) 발송 금지가 자동 적용된다.

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";

async function getStudentContact(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  studentId: string,
): Promise<{ name: string; parent_phone: string; student_phone: string | null } | null> {
  const { data } = await db
    .from("students")
    .select("name, parent_phone, student_phone")
    .eq("tenant_id", tenantId)
    .eq("id", studentId)
    .maybeSingle();
  return (data as { name: string; parent_phone: string; student_phone: string | null } | null) ?? null;
}

/** ⑫ 개별 메시지 — 관리자가 직접 작성한 문구를 학부모/학생에게 발송. */
export async function sendCustomMessage(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const studentId = String(formData.get("studentId") ?? "");
  const recipient = String(formData.get("recipient") ?? "parent");
  const message = String(formData.get("message") ?? "").trim();
  if (!studentId) return { ok: false, error: "학생을 선택해 주세요." };
  if (!message) return { ok: false, error: "메시지를 입력해 주세요." };

  const db = createServiceClient()!;
  const student = await getStudentContact(db, session.tenantId, studentId);
  if (!student) return { ok: false, error: "학생 정보를 찾을 수 없습니다." };

  const phone = recipient === "student" ? student.student_phone : student.parent_phone;
  if (!phone) {
    return {
      ok: false,
      error:
        recipient === "student"
          ? "학생 연락처가 없습니다(연락처 수집 동의 필요)."
          : "학부모 연락처가 없습니다.",
    };
  }

  const result = await sendNotification({
    tenantId: session.tenantId,
    studentId,
    type: "custom_message",
    phone,
    message,
    isAd: false,
  });
  if (!result.ok) return { ok: false, error: result.error ?? "발송에 실패했습니다." };

  await logActivity(
    session.tenantId,
    session.email,
    "notify",
    "student",
    studentId,
    `개별 메시지 발송 (${recipient === "student" ? "학생" : "학부모"})`,
  );
  return { ok: true };
}

/** ⑪ 재등록 안내(광고성) — 마케팅 수신동의가 있는 학부모에게만 발송(send.ts가 강제). */
export async function sendReEnrollmentNotice(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const studentId = String(formData.get("studentId") ?? "");
  if (!studentId) return { ok: false, error: "학생을 선택해 주세요." };

  const db = createServiceClient()!;
  const student = await getStudentContact(db, session.tenantId, studentId);
  if (!student) return { ok: false, error: "학생 정보를 찾을 수 없습니다." };

  const tenant = await resolveTenant();
  const result = await sendNotification({
    tenantId: session.tenantId,
    studentId,
    type: "re_enrollment",
    phone: student.parent_phone,
    message: `(광고) [${tenant.brandName}] ${student.name}님, 재등록을 안내드립니다. 다시 함께 공부할 수 있길 바랍니다. 문의는 편히 연락 주세요. 무료수신거부: 회신 '거부'`,
    isAd: true,
    consentSubject: { type: "student", id: studentId },
  });
  if (!result.ok) return { ok: false, error: result.error ?? "발송에 실패했습니다." };

  await logActivity(
    session.tenantId,
    session.email,
    "notify",
    "student",
    studentId,
    "재등록 안내(광고) 발송",
  );
  return { ok: true };
}
