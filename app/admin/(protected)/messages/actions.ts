"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { resolveTenant } from "@/lib/tenant";
import { logActivity } from "@/lib/data/activity";
import { dispatchQueued, sendNotification } from "@/lib/notify/send";
import { isNotifyType } from "@/lib/notify/templates";
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

/* ==================================================================
   발송 현황 — 실패·대기 건 재발송
   ================================================================== */

/**
 * 실패·대기 건 재발송.
 *
 * 실제 발송은 dispatchQueued 하나로만 한다 — 그 함수가 queued→sending 조건부 클레임으로
 * 이중 발송을 막는다. 그래서 failed 행은 **먼저 queued로 되돌린 뒤** 넘긴다(재큐잉).
 * 크론(notify_retry)이 하는 것과 같은 방식이고, 이유도 같다: 발송 경로를 둘로 만들지 않는다.
 *
 * 재시도 상한(3)에 닿은 건도 막지 않는다 — 상한은 크론이 무한히 태우지 않기 위한 것이지
 * 사람의 판단을 막는 값이 아니다. 대신 retry_count는 계속 올라가므로 몇 번 시도했는지는 남는다.
 *
 * 'sending' 상태는 재발송 대상이 아니다. 결과 불명이라는 뜻이고, 여기서 다시 보내면
 * 진짜로 이중 발송이 된다 — 그 건은 notify_retry 크론이 업무 카드로 올려 사람이 확인한다.
 */
export async function resendNotification(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  const db = createServiceClient()!;
  const { data, error } = await db
    .from("notifications")
    .select("id, tenant_id, student_id, type, channel, phone, message, is_ad, status, report_id")
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[messages] 재발송 대상 조회 실패", error);
    return { ok: false, error: "발송 이력을 불러오지 못했습니다." };
  }
  if (!data) return { ok: false, error: "발송 이력을 찾을 수 없습니다." };

  const row = data as {
    id: string;
    tenant_id: string;
    student_id: string | null;
    type: string;
    channel: "alimtalk" | "sms";
    phone: string;
    message: string;
    is_ad: boolean;
    status: string;
    report_id: string | null;
  };

  if (row.status === "sent") {
    return { ok: false, error: "이미 발송된 건입니다. 다시 보내려면 개별 메시지로 작성해 주세요." };
  }
  if (row.status === "sending") {
    return {
      ok: false,
      error:
        "발송 시도 중(결과 불명)인 건입니다. 지금 다시 보내면 이중 발송이 됩니다 — 결과가 확정된 뒤 처리해 주세요.",
    };
  }

  // 회수된 포털 초대는 다시 보낼 수 없다.
  //
  // 재시도가 소진되면 send.ts가 그 링크를 회수하고 본문의 토큰을 지운다(전달되지 않은 자격을
  // 살려 두지 않는다). 그 뒤에 이 행을 재발송하면 이미 죽은 링크를 보내는 셈이라, 학부모는
  // "링크가 안 열린다"로 다시 문의하게 된다 — 필요한 건 재발송이 아니라 새 초대다.
  if (row.type === "portal_invite" && !/\/p\/link\/[A-Za-z0-9_-]+/.test(row.message)) {
    return {
      ok: false,
      error:
        "이 초대 링크는 전달 실패로 회수되었습니다. 학생 상세에서 포털 초대를 새로 발급해 주세요.",
    };
  }

  if (row.status === "failed") {
    // 재큐잉 — status를 조건에 넣어 그 사이 크론이 집어간 행을 덮어쓰지 않는다.
    // tenant-scope-ok: 위 조회에서 tenant_id로 이미 좁힌 행의 id다.
    const { data: requeued, error: requeueError } = await db
      .from("notifications")
      .update({ status: "queued", error: null })
      .eq("id", row.id)
      .eq("status", "failed")
      .select("id");
    if (requeueError) {
      console.error("[messages] 재큐잉 실패", requeueError);
      return { ok: false, error: "재발송 준비에 실패했습니다." };
    }
    if (!requeued || requeued.length === 0) {
      return { ok: false, error: "그 사이 상태가 바뀌었습니다. 새로고침 후 다시 확인해 주세요." };
    }
  }

  // 미등록 타입이어도 막지 않는다 — 본문은 이미 완성돼 있어 SMS로는 나간다(flush 크론과 동일 판단).
  if (!isNotifyType(row.type)) {
    console.error(`[messages] NotifyType에 없는 알림 타입 '${row.type}' — SMS 폴백으로 재발송 (id=${row.id})`);
  }

  const result = await dispatchQueued(
    row.id,
    {
      tenantId: row.tenant_id,
      studentId: row.student_id,
      type: row.type,
      phone: row.phone,
      message: row.message,
      isAd: row.is_ad,
      reportId: row.report_id ?? undefined,
    },
    row.channel,
  );

  await logActivity(
    session.tenantId,
    session.email,
    "notify",
    "notification",
    row.id,
    `발송 현황에서 재발송 — ${row.type} (${result.ok ? "성공" : result.skipped ? "이미 처리 중" : "실패"})`,
  );

  revalidatePath("/admin/messages");

  if (result.skipped) {
    return { ok: false, error: "다른 발송 작업이 이미 처리 중입니다. 잠시 후 상태를 확인해 주세요." };
  }
  if (!result.ok) {
    return { ok: false, error: result.error ?? "재발송에 실패했습니다." };
  }
  return { ok: true };
}
