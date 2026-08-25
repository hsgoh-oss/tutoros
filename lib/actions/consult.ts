"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { resolveTenant } from "@/lib/tenant";
import { getSiteContent } from "@/lib/data/content";
import { sendNotification } from "@/lib/notify/send";
import {
  consultFormSchema,
  isMinorBirthYear,
  type ConsultFormValues,
} from "@/components/public/consult/schema";

// 상담 폼 제출 — 만 14세 미만 판정은 스키마 superRefine로 서버 재검증(클라 우회 차단).
// consultations insert 후 consents 기록에 실패하면, 방금 만든 상담 행을 되돌려 "동의 없는 접수"를 막는다.

const POLICY_VERSION = "v0.9";
const DB_ERROR_MESSAGE =
  "데이터베이스 미연결 상태입니다. 잠시 후 다시 시도하거나 카카오톡으로 문의해 주세요.";
// O-04 접수 거부 안내 — 대기명단 실동작(정원 산정·자리 제안)은 M2 몫이라 안내 문구만 둔다.
const RECRUIT_CLOSED_MESSAGE =
  "현재 모집이 마감되어 상담 접수를 받지 않습니다. 대기 신청은 준비 중이니, 모집 재개 안내가 필요하시면 카카오톡으로 문의해 주세요.";

export type ConsultActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function submitConsult(
  values: ConsultFormValues,
): Promise<ConsultActionResult> {
  const parsed = consultFormSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: "입력 내용을 다시 확인해 주세요." };
  }
  const data = parsed.data;

  const db = createServiceClient();
  if (!db) {
    return { ok: false, error: DB_ERROR_MESSAGE };
  }

  const tenant = await resolveTenant();

  // O-04 정본 "공개 상태 = 실제 접수 가능 상태": 접수 중단(closed)이면 서버에서 접수를 거부한다.
  // 공개 페이지의 폼 게이트를 우회한 직접 호출도 여기서 막힌다. 행 없음·조회 실패는
  // 공개 표시 폴백(DEFAULT_CONTENT.recruit.status = "open")과 동일하게 접수 가능으로 취급해
  // 일시 오류가 실제 접수를 막지 않게 한다(open·closing·waitlist는 상담 접수를 계속 받는다).
  const { data: recruitRow } = await db
    .from("recruit_status")
    .select("status")
    .eq("tenant_id", tenant.id)
    .maybeSingle();
  if (recruitRow?.status === "closed") {
    return { ok: false, error: RECRUIT_CLOSED_MESSAGE };
  }

  const classType = data.classType === "unspecified" ? null : data.classType;
  const hours = data.hours ? Number(data.hours) : undefined;
  const freq = data.freq ? Number(data.freq) : undefined;
  const hasPrefill = Boolean(classType) || hours !== undefined || freq !== undefined;

  const { data: inserted, error: insertError } = await db
    .from("consultations")
    .insert({
      tenant_id: tenant.id,
      name: data.name,
      phone: data.phone,
      subject: data.subject ?? null,
      class_type: classType,
      message: data.message || null,
      is_student_self: data.isStudentSelf,
      birth_year: data.isStudentSelf && data.birthYear ? Number(data.birthYear) : null,
      guardian_name: data.guardianName?.trim() || null,
      guardian_phone: data.guardianPhone || null,
      checklist_items: data.checklistItems,
      prefill: hasPrefill ? { mode: classType ?? undefined, hours, freq } : null,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    console.error("[consult] consultations insert failed", insertError);
    return {
      ok: false,
      error: "상담 접수 중 오류가 발생했습니다. 잠시 후 다시 시도하거나 카카오톡으로 문의해 주세요.",
    };
  }

  // 만 14세 미만 본인 신청 + 법정대리인 동의 체크 시에만 guardian 동의를 기록.
  const isMinorGuardian =
    data.isStudentSelf &&
    !!data.birthYear &&
    isMinorBirthYear(Number(data.birthYear)) &&
    data.guardianConsent;

  const consentBase = {
    tenant_id: tenant.id,
    subject_type: "consultation",
    subject_id: inserted.id,
    policy_version: POLICY_VERSION,
    via: "form",
  };
  // 필수 동의 문구에 'AI 처리 목적 가명화 국외이전'이 포함되므로 privacy와 함께 overseas_ai도 기록.
  const consentRows = [
    { ...consentBase, item: "privacy" },
    { ...consentBase, item: "overseas_ai" },
    ...(data.marketingConsent ? [{ ...consentBase, item: "marketing" }] : []),
    ...(isMinorGuardian ? [{ ...consentBase, item: "guardian" }] : []),
  ];

  // tenant-scope-ok: consentBase가 tenant_id를 담고 전 행이 이를 스프레드한다(위 78행).
  // 감사기는 insert 인자 변수의 선언 블록에서 리터럴 tenant_id만 찾아 2단계 간접참조를 보지 못한다.
  const { error: consentError } = await db.from("consents").insert(consentRows);
  if (consentError) {
    console.error("[consult] consents insert failed", consentError);
    // tenant-scope-ok: 방금 insert한 상담 행의 보상 삭제. inserted.id는 내부 생성 uuid다.
    const { error: cleanupError } = await db
      .from("consultations")
      .delete()
      .eq("id", inserted.id);
    if (cleanupError) {
      console.error("[consult] consultation cleanup failed", cleanupError);
    }
    return {
      ok: false,
      error: "상담 접수 중 오류가 발생했습니다. 잠시 후 다시 시도하거나 카카오톡으로 문의해 주세요.",
    };
  }

  // ② 접수 확인 알림(→고객) — 실패해도 접수는 성공 처리(알림은 이력 로그로 추적).
  try {
    await sendNotification({
      tenantId: tenant.id,
      studentId: null,
      type: "consult_received",
      phone: data.phone,
      message: `[${tenant.brandName}] ${data.name}님, 상담 신청이 접수되었습니다. 확인 후 연락드리겠습니다.`,
      isAd: false,
    });
  } catch (notifyError) {
    console.error("[consult] 접수 알림 발송 실패", notifyError);
  }

  // ① 새 상담 접수 알림(→관리자) — 사업자 연락처(site_settings.phone)가 설정된 경우에만.
  try {
    const content = await getSiteContent(tenant.id);
    const adminPhone = content.settings.phone;
    if (adminPhone) {
      await sendNotification({
        tenantId: tenant.id,
        studentId: null,
        type: "consult_admin_alert",
        phone: adminPhone,
        message: `[${tenant.brandName}] 새 상담 신청이 접수되었습니다. (신청자: ${data.name}) 관리자 페이지에서 확인해 주세요.`,
        isAd: false,
      });
    }
  } catch (notifyError) {
    console.error("[consult] 관리자 접수 알림 발송 실패", notifyError);
  }

  return { ok: true };
}
