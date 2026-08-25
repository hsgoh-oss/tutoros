"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { getStudent } from "@/lib/data/crm";
import { renderTemplate } from "@/lib/notify/templates";
import { createWorkItem } from "@/lib/data/work";
import { sendNotification } from "@/lib/notify/send";
import { getForm } from "@/lib/data/intake";
import { runCritical } from "@/lib/data/activity";
import type { EnrollmentGate } from "@/lib/data/intake";
import type { EnrollmentStatus } from "@/lib/types";
import type { CrmActionResult } from "@/components/admin/crm/types";
import {
  AUDIT_MONEY,
  AUDIT_OTHER,
  GATE_COLUMN,
  GATE_EVIDENCE,
  GATE_LABEL,
  isEnrollmentGate,
} from "./constants";

// 정규 등록 서버 액션 (R-02~R-06) — 정본: docs/flow-canon/01_atlas_01_intake.md,
// 03_scenarios_133.md 검수 12·13·14·15.
//
// 이 파일이 지키는 것:
//  ① 네 게이트는 "확인했다"는 체크가 아니라 근거다(R-02~R-04). 각 액션은 통과의 근거를 요구하고
//     — 관계는 확인 내용, 계약은 계약본 + 동의자, 결제는 완납된 청구, 일정은 확정 회차 —
//     근거가 없으면 통과시키지 않는다. 근거 자체는 감사 이력(activity_log)에 남는다.
//  ② 활성 전환은 여기서 판정하지 않는다. 00018의 activate_enrollment RPC가 네 조건을 UPDATE의
//     WHERE에 넣어 원자적으로 판정·전환한다(검수 12·15) — 조회와 전환 사이에 게이트가 뒤집혀도
//     반쪽 활성이 남지 않는다. 이 파일은 RPC의 false를 "조건이 바뀌었습니다"로 수렴시킨다.
//  ③ 모든 전환은 조건부 UPDATE다(status·플래그를 WHERE에 넣는다) — 두 운영자가 같은 버튼을
//     동시에 눌러도 한쪽만 성공하고, 나머지는 "이미 처리됨"으로 수렴한다.
//
// 기존과의 관계(회귀 금지):
//  · 등록의 정본은 enrollments이고 students.status는 기존 관리자 화면 호환 미러다.
//    활성 미러(active)는 RPC가 같은 트랜잭션에서 갱신하고, 종료 미러(ended)는 endEnrollment가
//    갱신한다 — E-04 포털 접근 회수는 기존 로직(lib/data/crm.ts getStudentByPortalToken의
//    ended 차단)이 students.status로 판단하므로 미러 갱신만으로 자동 연결된다.
//  · E-05 재등록(students/actions.ts reEnrollStudent)은 이번 범위에서 고치지 않는다. 다만 이
//    시점부터 "등록"의 정본 엔티티는 enrollments이므로, 재등록은 students.status를 되돌리는
//    것이 아니라 새 enrollments 행을 만드는 흐름으로 가야 한다(검수 48) — 그 전환은 별도 작업.
//  · M1 포털 초대는 여기서 발급하지 않는다(R-06 최소 연결). 활성 화면이 학생 상세로 보내는
//    링크만 두고, 초대 실패가 등록 활성을 되돌리지 않게 한다(R-05 예외 "완료 안내 실패").
//    students/actions.ts의 invitePortalRelation은 이 범위의 소유 파일이 아니라 재사용하지 않는다.

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";
/** 활성화가 0행으로 끝났을 때의 단일 문구 — 게이트 미완·중복 활성·상태 변경 모두 여기로 수렴한다. */
const GATE_CHANGED =
  "조건이 바뀌었습니다 — 다시 확인해 주세요. (네 게이트 중 하나가 풀렸거나 등록 상태가 바뀌었습니다)";

function revalidateEnrollment(id?: string) {
  revalidatePath("/admin/enrollments");
  if (id) revalidatePath(`/admin/enrollments/${id}`);
}

/** 미러(students.status)를 읽는 화면들 — 활성·종료 후 함께 새로 고친다. */
function revalidateStudent(studentId: string) {
  revalidatePath("/admin/students");
  revalidatePath(`/admin/students/${studentId}`);
}

interface EnrollmentGuardRow {
  id: string;
  student_id: string;
  consultation_id: string | null;
  status: EnrollmentStatus;
  relation_ok: boolean;
  contract_ok: boolean;
  payment_ok: boolean;
  schedule_ok: boolean;
}

const GUARD_COLUMNS =
  "id,student_id,consultation_id,status,relation_ok,contract_ok,payment_ok,schedule_ok";

/** 전환 전 스냅샷 — 감사 before와 사전 판정에 쓴다. 실제 경합 차단은 각 UPDATE의 WHERE다. */
async function loadEnrollment(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  id: string,
): Promise<EnrollmentGuardRow | null> {
  const { data, error } = await db
    .from("enrollments")
    .select(GUARD_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[enrollments] guard fetch failed", error);
    return null;
  }
  return (data as unknown as EnrollmentGuardRow) ?? null;
}

/* ---------- ① 등록 생성 (R-01 → R-04 "등록 준비 중") ----------
   상담 또는 제출된 정규 신청폼에서 학생을 연결해 pending 등록을 만든다.
   여기서 활성화되는 것은 아무것도 없다 — 네 게이트는 전부 false로 시작한다(DB 기본값). */

export async function createEnrollment(
  formData: FormData,
): Promise<CrmActionResult & { id?: string }> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const formId = String(formData.get("formId") ?? "").trim();
  let consultationId = String(formData.get("consultationId") ?? "").trim();
  if (!studentId) return { ok: false, error: "학생을 선택해 주세요." };

  const db = createServiceClient()!;

  const student = await getStudent(session.tenantId, studentId);
  if (!student) return { ok: false, error: "학생 정보를 찾을 수 없습니다." };

  // 정규 신청폼을 근거로 삼는 경우: 제출된 정규 폼만 인정하고, 상담은 그 폼의 상담으로 고정한다
  // (R-01 "제출된 정규 신청이 운영자 검토에 도달" — 화면에서 상담을 따로 골랐더라도 폼이 우선).
  if (formId) {
    const form = await getForm(session.tenantId, formId);
    if (!form) return { ok: false, error: "신청폼을 찾을 수 없습니다." };
    if (form.kind !== "regular") {
      return { ok: false, error: "정규수업 신청폼만 등록 근거가 될 수 있습니다." };
    }
    if (form.status !== "submitted") {
      return {
        ok: false,
        error: "제출된 정규 신청폼만 등록 근거가 될 수 있습니다(발송·마감·만료 상태는 불가).",
      };
    }
    consultationId = form.consultationId;
  } else if (consultationId) {
    const { data: consultation, error: consultationError } = await db
      .from("consultations")
      .select("id")
      .eq("tenant_id", session.tenantId)
      .eq("id", consultationId)
      .maybeSingle();
    if (consultationError || !consultation) {
      console.error("[enrollments] consultation fetch failed", consultationError);
      return { ok: false, error: "상담 정보를 찾을 수 없습니다." };
    }
  }

  // 진행 중 등록 중복 방지. DB 부분 유니크는 active 하나만 막으므로(활성 등록 1건 — R-05)
  // 준비 중 중복은 앱에서 막는다 — 같은 학생의 pending 등록이 둘이면 어느 쪽 게이트가
  // 정본인지 알 수 없게 된다.
  const { data: openRows, error: openError } = await db
    .from("enrollments")
    .select("id,status")
    .eq("tenant_id", session.tenantId)
    .eq("student_id", studentId)
    .in("status", ["pending", "active"]);
  if (openError) {
    console.error("[enrollments] open enrollment check failed", openError);
    return { ok: false, error: "기존 등록 확인 중 오류가 발생했습니다." };
  }
  if (openRows && openRows.length > 0) {
    const open = openRows[0] as { id: string; status: EnrollmentStatus };
    return {
      ok: false,
      error:
        open.status === "active"
          ? "이 학생에게는 이미 활성 등록이 있습니다 — 새 등록을 만들려면 기존 등록을 먼저 종료해 주세요."
          : "이 학생에게는 이미 준비 중인 등록이 있습니다 — 그 등록에서 이어서 진행해 주세요.",
    };
  }

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "enrollment_create",
      targetType: "enrollment",
      targetId: null, // insert 전 선기록 — 새 등록 id는 아직 없다(after로 식별).
      summary: `${student.name} 정규 등록 생성(등록 준비 중)`,
      category: AUDIT_OTHER,
      after: {
        student_id: studentId,
        consultation_id: consultationId || null,
        form_id: formId || null,
        status: "pending",
      },
    },
    async (): Promise<{ ok: true; id: string } | { ok: false; error: string }> => {
      const { data, error } = await db
        .from("enrollments")
        .insert({
          tenant_id: session.tenantId,
          student_id: studentId,
          consultation_id: consultationId || null,
          form_id: formId || null,
          status: "pending",
        })
        .select("id")
        .single();
      if (error || !data) {
        console.error("[enrollments] insert failed", error);
        return { ok: false, error: "등록 생성 중 오류가 발생했습니다." };
      }
      return { ok: true, id: (data as { id: string }).id };
    },
  );
  if (!result.ok) return result;

  revalidateEnrollment(result.id);
  if (consultationId) revalidatePath(`/admin/consultations/${consultationId}`);
  return result;
}

/* ---------- ② 게이트 1 — 관계 확인 (R-02) ----------
   포털 관계(00017 portal_relations)는 등록 활성 이후에 발급되는 초대라(R-06 최소 연결) 이
   시점에는 아직 없을 수 있다. 그래서 관계 게이트의 근거는 관계 행의 존재가 아니라 운영자가
   무엇을 확인했는지다 — 확인 내용을 필수로 받아 감사에 남긴다(빈 체크박스 통과 금지). */

export async function confirmRelationGate(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!id) return { ok: false, error: "잘못된 요청입니다." };
  if (note.length < 5) {
    return {
      ok: false,
      error:
        "확인한 관계를 적어 주세요 — 학생·보호자·계약자·납부자가 각각 누구인지, 학습 공유권한과 청구권한을 어떻게 나눴는지(R-02).",
    };
  }

  const db = createServiceClient()!;
  const before = await loadEnrollment(db, session.tenantId, id);
  if (!before) return { ok: false, error: "등록 정보를 찾을 수 없습니다." };

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "enrollment_gate_relation",
      targetType: "enrollment",
      targetId: id,
      summary: "등록 게이트 통과 — 관계 확인",
      category: AUDIT_OTHER,
      before: { relation_ok: before.relation_ok },
      after: { relation_ok: true, evidence: note },
      reason: `${GATE_EVIDENCE.relation} 확인 내용: ${note}`,
    },
    async (): Promise<CrmActionResult> => {
      const { data, error } = await db
        .from("enrollments")
        .update({ relation_ok: true })
        .eq("tenant_id", session.tenantId)
        .eq("id", id)
        .eq("status", "pending")
        .eq("relation_ok", false)
        .select("id")
        .maybeSingle();
      if (error) {
        console.error("[enrollments] relation gate update failed", error);
        return { ok: false, error: "관계 확인 처리 중 오류가 발생했습니다." };
      }
      if (!data) {
        return {
          ok: false,
          error: "이미 확인됐거나 준비 중 등록이 아닙니다 — 화면을 새로 고쳐 확인해 주세요.",
        };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidateEnrollment(id);
  return result;
}

/* ---------- ③ 게이트 2 — 계약 수락 (R-03) ----------
   정본 R-03 예외: "신청폼 동의만으로 계약 수락 처리하지 않는다". 그래서 통과의 근거는
   contracts 행 하나다 — 동의 시점의 수업 조건 스냅샷(terms)과 성인 계약자의 이름·연락처가
   함께 남아야 계약 수락으로 인정한다. 계약본 insert가 곧 contract_ok의 근거다. */

export async function recordContractAgreement(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const schedule = String(formData.get("schedule") ?? "").trim();
  const tuitionRaw = String(formData.get("tuition") ?? "").trim();
  const startDate = String(formData.get("startDate") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const agreedByName = String(formData.get("agreedByName") ?? "").trim();
  // 00017 portal_contacts와 같은 정규화 규약 — 표기 차이가 같은 사람을 둘로 가르지 않게 숫자만 남긴다.
  const agreedByPhone = String(formData.get("agreedByPhone") ?? "").replace(/\D/g, "");

  if (!id) return { ok: false, error: "잘못된 요청입니다." };
  if (!schedule) return { ok: false, error: "수업 조건(요일·시간)을 입력해 주세요." };
  const tuition = Number(tuitionRaw);
  if (!tuitionRaw || !Number.isInteger(tuition) || tuition < 0) {
    return { ok: false, error: "수업료를 숫자(원)로 입력해 주세요." };
  }
  if (!startDate) return { ok: false, error: "수업 시작일을 입력해 주세요." };
  if (!agreedByName) return { ok: false, error: "계약자(성인) 이름을 입력해 주세요." };
  if (!/^[0-9]{9,12}$/.test(agreedByPhone)) {
    return { ok: false, error: "계약자 연락처를 숫자 9~12자리로 입력해 주세요." };
  }

  const db = createServiceClient()!;
  const before = await loadEnrollment(db, session.tenantId, id);
  if (!before) return { ok: false, error: "등록 정보를 찾을 수 없습니다." };
  if (before.status !== "pending") {
    return { ok: false, error: "준비 중 등록에만 계약을 기록할 수 있습니다." };
  }
  if (!before.relation_ok) {
    // R-01 예외: 미성년자에게 필요한 성인 관계가 확인되지 않으면 계약 단계 자체가 막힌다.
    return {
      ok: false,
      error: "관계 확인이 먼저입니다 — 계약자·납부자가 정리되기 전에는 계약을 기록하지 않습니다(R-01).",
    };
  }

  const terms = {
    subject: subject || null,
    schedule,
    tuition,
    start_date: startDate,
    note: note || null,
    // 동의 경로 — 이 화면의 기록은 운영자가 계약자에게 확인받아 남긴 것이다(대면·통화·서면).
    agreed_via: "operator_record",
    snapshot_at: new Date().toISOString(),
  };

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "enrollment_gate_contract",
      targetType: "enrollment",
      targetId: id,
      summary: `등록 게이트 통과 — 계약 수락(${agreedByName})`,
      category: AUDIT_MONEY,
      before: { contract_ok: before.contract_ok },
      after: { contract_ok: true, terms, agreed_by_name: agreedByName },
      reason: GATE_EVIDENCE.contract,
    },
    async (): Promise<CrmActionResult> => {
      const { data: contract, error: insertError } = await db
        .from("contracts")
        .insert({
          tenant_id: session.tenantId,
          enrollment_id: id,
          terms,
          agreed_at: new Date().toISOString(),
          agreed_by_name: agreedByName,
          agreed_by_phone: agreedByPhone,
        })
        .select("id")
        .single();
      if (insertError || !contract) {
        // 23505 = contracts_one_agreed_per_enrollment(한 등록에 동의된 계약본은 하나 — R-05).
        if (insertError?.code === "23505") {
          return {
            ok: false,
            error:
              "이미 동의된 계약본이 있습니다 — 조건을 바꾸려면 계약 게이트를 먼저 해제(동의 철회)한 뒤 새 계약본에 동의를 받아 주세요(R-03).",
          };
        }
        console.error("[enrollments] contract insert failed", insertError);
        return { ok: false, error: "계약 기록 중 오류가 발생했습니다." };
      }

      const { data: updated, error: updateError } = await db
        .from("enrollments")
        .update({ contract_ok: true })
        .eq("tenant_id", session.tenantId)
        .eq("id", id)
        .eq("status", "pending")
        .eq("contract_ok", false)
        .select("id")
        .maybeSingle();
      if (updateError || !updated) {
        // 게이트를 세우지 못했으면 방금 만든 계약본을 보상 삭제한다 — 동의된 계약본만 남고
        // 게이트는 닫힌 어긋난 상태를 만들지 않는다(convertToStudent 보상 삭제 선례).
        const { error: cleanupError } = await db
          .from("contracts")
          .delete()
          .eq("tenant_id", session.tenantId)
          .eq("id", (contract as { id: string }).id);
        if (cleanupError) console.error("[enrollments] contract cleanup failed", cleanupError);
        if (updateError) console.error("[enrollments] contract gate update failed", updateError);
        return {
          ok: false,
          error: "계약 게이트를 세우지 못했습니다 — 상태가 바뀌었을 수 있습니다. 화면을 새로 고쳐 확인해 주세요.",
        };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidateEnrollment(id);
  return result;
}

/* ---------- ④ 게이트 3 — 결제 확인 (R-04 · 검수 14) ----------
   근거는 payments의 완납(paid) 청구다. 청구(pending)만 있는 상태는 통과가 아니다 —
   "결제 결과가 불명확하면 대사 완료 전 활성화 금지"(R-04 예외). 어떤 청구를 근거로 삼았는지는
   감사에 남긴다(enrollments에는 payment 참조 컬럼이 없다 — 등록당 청구는 여러 건이 이어지므로
   한 건을 등록 행에 못박지 않는다). */

interface PaymentEvidenceRow {
  id: string;
  student_id: string;
  status: string;
  amount: number;
  period_start: string | null;
  period_end: string | null;
  paid_at: string | null;
}

export async function confirmPaymentGate(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "").trim();
  const paymentId = String(formData.get("paymentId") ?? "").trim();
  if (!id) return { ok: false, error: "잘못된 요청입니다." };
  if (!paymentId) return { ok: false, error: "근거가 될 청구를 선택해 주세요." };

  const db = createServiceClient()!;
  const before = await loadEnrollment(db, session.tenantId, id);
  if (!before) return { ok: false, error: "등록 정보를 찾을 수 없습니다." };

  const { data: paymentRow, error: paymentError } = await db
    .from("payments")
    .select("id,student_id,status,amount,period_start,period_end,paid_at")
    .eq("tenant_id", session.tenantId)
    .eq("id", paymentId)
    .maybeSingle();
  if (paymentError) {
    console.error("[enrollments] payment fetch failed", paymentError);
    return { ok: false, error: "청구 정보를 확인하지 못했습니다." };
  }
  const payment = paymentRow as unknown as PaymentEvidenceRow | null;
  if (!payment) return { ok: false, error: "청구 정보를 찾을 수 없습니다." };
  if (payment.student_id !== before.student_id) {
    return { ok: false, error: "이 등록의 학생 앞으로 발행된 청구가 아닙니다." };
  }
  if (payment.status !== "paid") {
    return {
      ok: false,
      error:
        "완납(paid)된 청구만 결제 확인의 근거가 됩니다 — 입금 대사를 마친 뒤 다시 시도해 주세요(검수 14).",
    };
  }

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "enrollment_gate_payment",
      targetType: "enrollment",
      targetId: id,
      summary: "등록 게이트 통과 — 결제 확인",
      category: AUDIT_MONEY,
      before: { payment_ok: before.payment_ok },
      after: {
        payment_ok: true,
        payment_id: payment.id,
        amount: payment.amount,
        paid_at: payment.paid_at,
        period: [payment.period_start, payment.period_end],
      },
      reason: GATE_EVIDENCE.payment,
    },
    async (): Promise<CrmActionResult> => {
      // 근거 청구가 그 사이 환불·취소되지 않았는지 한 문장 안에서 다시 본다 — 조회와 전환
      // 사이에 결제가 뒤집히면 게이트를 세우지 않는다.
      const { data: stillPaid, error: recheckError } = await db
        .from("payments")
        .select("id")
        .eq("tenant_id", session.tenantId)
        .eq("id", paymentId)
        .eq("status", "paid")
        .maybeSingle();
      if (recheckError) {
        console.error("[enrollments] payment recheck failed", recheckError);
        return { ok: false, error: "청구 상태 재확인 중 오류가 발생했습니다." };
      }
      if (!stillPaid) {
        return { ok: false, error: "근거 청구가 더 이상 완납 상태가 아닙니다 — 다시 확인해 주세요." };
      }

      const { data, error } = await db
        .from("enrollments")
        .update({ payment_ok: true })
        .eq("tenant_id", session.tenantId)
        .eq("id", id)
        .eq("status", "pending")
        .eq("payment_ok", false)
        .select("id")
        .maybeSingle();
      if (error) {
        console.error("[enrollments] payment gate update failed", error);
        return { ok: false, error: "결제 확인 처리 중 오류가 발생했습니다." };
      }
      if (!data) {
        return {
          ok: false,
          error: "이미 확인됐거나 준비 중 등록이 아닙니다 — 화면을 새로 고쳐 확인해 주세요.",
        };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidateEnrollment(id);
  return result;
}

/* ---------- ⑤ 게이트 4 — 일정 확정 (R-04 · 검수 13) ----------
   근거는 schedules의 확정 회차(planned·done·makeup)다. 취소(canceled)만 남은 학생은 통과시키지
   않는다 — "일정 확정 여부"를 사람의 기억이 아니라 일정 표가 답하게 한다. */

export async function confirmScheduleGate(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  const db = createServiceClient()!;
  const before = await loadEnrollment(db, session.tenantId, id);
  if (!before) return { ok: false, error: "등록 정보를 찾을 수 없습니다." };

  const { data: scheduleRows, error: scheduleError } = await db
    .from("schedules")
    .select("id,scheduled_at,status")
    .eq("tenant_id", session.tenantId)
    .eq("student_id", before.student_id)
    .in("status", ["planned", "done", "makeup"])
    .order("scheduled_at", { ascending: true })
    .limit(1);
  if (scheduleError) {
    console.error("[enrollments] schedule fetch failed", scheduleError);
    return { ok: false, error: "일정 확인 중 오류가 발생했습니다." };
  }
  const first = (scheduleRows ?? [])[0] as
    | { id: string; scheduled_at: string; status: string }
    | undefined;
  if (!first) {
    return {
      ok: false,
      error:
        "확정된 수업 회차가 없습니다 — 일정 관리에서 첫 회차를 먼저 등록해 주세요(취소된 회차는 근거가 되지 않습니다).",
    };
  }

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "enrollment_gate_schedule",
      targetType: "enrollment",
      targetId: id,
      summary: "등록 게이트 통과 — 일정 확정",
      category: AUDIT_OTHER,
      before: { schedule_ok: before.schedule_ok },
      after: { schedule_ok: true, schedule_id: first.id, scheduled_at: first.scheduled_at },
      reason: GATE_EVIDENCE.schedule,
    },
    async (): Promise<CrmActionResult> => {
      const { data, error } = await db
        .from("enrollments")
        .update({ schedule_ok: true })
        .eq("tenant_id", session.tenantId)
        .eq("id", id)
        .eq("status", "pending")
        .eq("schedule_ok", false)
        .select("id")
        .maybeSingle();
      if (error) {
        console.error("[enrollments] schedule gate update failed", error);
        return { ok: false, error: "일정 확인 처리 중 오류가 발생했습니다." };
      }
      if (!data) {
        return {
          ok: false,
          error: "이미 확인됐거나 준비 중 등록이 아닙니다 — 화면을 새로 고쳐 확인해 주세요.",
        };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidateEnrollment(id);
  return result;
}

/* ---------- ⑥ 게이트 해제 (R-04 "완료 후 다시 활성화 조건 확인") ----------
   근거가 뒤집히면(환불·계약 조건 변경·일정 취소·관계 분쟁) 게이트도 내려가야 한다 —
   R-02 예외 "관계 분쟁·불명확: 등록 활성화 보류". 사유는 필수이고 감사에 남는다.
   계약 게이트 해제는 동의된 계약본의 동의도 함께 거둔다 — 동의는 남았는데 게이트만 내려간
   상태를 만들지 않기 위해서다(계약본 자체와 조건 스냅샷은 그대로 보존되고, 거둔 동의 내용은
   감사 before에 남는다. 새 조건은 새 계약본으로 다시 동의받는다 — R-03 "조건 변경"). */

export async function releaseGate(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "").trim();
  const gateRaw = String(formData.get("gate") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!id || !isEnrollmentGate(gateRaw)) return { ok: false, error: "잘못된 요청입니다." };
  const gate: EnrollmentGate = gateRaw;
  if (reason.length < 2) return { ok: false, error: "해제 사유를 입력해 주세요." };

  const db = createServiceClient()!;
  const before = await loadEnrollment(db, session.tenantId, id);
  if (!before) return { ok: false, error: "등록 정보를 찾을 수 없습니다." };
  if (before.status !== "pending") {
    return {
      ok: false,
      error: "준비 중 등록의 게이트만 해제할 수 있습니다 — 활성 등록은 종료 흐름으로 처리해 주세요.",
    };
  }

  const column = GATE_COLUMN[gate];

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: `enrollment_gate_release_${gate}`,
      targetType: "enrollment",
      targetId: id,
      summary: `등록 게이트 해제 — ${GATE_LABEL[gate]}`,
      category: gate === "contract" || gate === "payment" ? AUDIT_MONEY : AUDIT_OTHER,
      before: { [column]: true },
      after: { [column]: false },
      reason,
    },
    async (): Promise<CrmActionResult> => {
      const { data, error } = await db
        .from("enrollments")
        .update({ [column]: false })
        .eq("tenant_id", session.tenantId)
        .eq("id", id)
        .eq("status", "pending")
        .eq(column, true)
        .select("id")
        .maybeSingle();
      if (error) {
        console.error("[enrollments] gate release failed", error);
        return { ok: false, error: "게이트 해제 중 오류가 발생했습니다." };
      }
      if (!data) {
        return { ok: false, error: "이미 해제됐거나 상태가 바뀌었습니다 — 화면을 새로 고쳐 확인해 주세요." };
      }

      if (gate === "contract") {
        const { error: withdrawError } = await db
          .from("contracts")
          .update({ agreed_at: null, agreed_by_name: null, agreed_by_phone: null })
          .eq("tenant_id", session.tenantId)
          .eq("enrollment_id", id)
          .not("agreed_at", "is", null);
        if (withdrawError) {
          console.error("[enrollments] contract withdraw failed", withdrawError);
          // 동의를 거두지 못했으면 게이트도 되돌린다 — "게이트는 닫혔는데 동의된 계약본이
          // 그대로 남은" 어긋난 상태를 남기지 않는다.
          const { error: revertError } = await db
            .from("enrollments")
            .update({ contract_ok: true })
            .eq("tenant_id", session.tenantId)
            .eq("id", id)
            .eq("status", "pending")
            .eq("contract_ok", false);
          if (revertError) console.error("[enrollments] contract gate revert failed", revertError);
          return { ok: false, error: "계약 동의 철회 중 오류가 발생했습니다 — 해제를 취소했습니다." };
        }
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidateEnrollment(id);
  return result;
}

/* ---------- ⑦ 등록 활성화 (R-05 · 검수 12·15) ----------
   판정도 전환도 00018 activate_enrollment RPC가 한 문장으로 한다 — 네 게이트를 UPDATE의
   WHERE에 넣어 계수와 갱신 사이의 창(TOCTOU)을 없앤다. students.status='active' 미러도 같은
   트랜잭션 안에서 함께 갱신되므로(등록만 활성이고 학생은 trial로 남는 불일치 금지) 여기서
   따로 미러를 건드리지 않는다. RPC가 false면 아무것도 바뀌지 않은 것이다. */

export async function activateEnrollment(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  const db = createServiceClient()!;
  const before = await loadEnrollment(db, session.tenantId, id);
  if (!before) return { ok: false, error: "등록 정보를 찾을 수 없습니다." };
  if (before.status !== "pending") {
    return { ok: false, error: "준비 중 등록만 활성화할 수 있습니다." };
  }

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "enrollment_activate",
      targetType: "enrollment",
      targetId: id,
      summary: "정규 등록 활성화(네 게이트 충족)",
      category: AUDIT_OTHER,
      before: {
        status: before.status,
        relation_ok: before.relation_ok,
        contract_ok: before.contract_ok,
        payment_ok: before.payment_ok,
        schedule_ok: before.schedule_ok,
      },
      after: { status: "active", student_status_mirror: "active" },
      reason: "네 조건(관계·계약·결제·일정) 충족 — 원자적 활성화(R-05)",
    },
    async (): Promise<CrmActionResult> => {
      const { data: activated, error } = await db.rpc("activate_enrollment", {
        p_tenant_id: session.tenantId,
        p_id: id,
      });
      if (error) {
        console.error("[enrollments] activate rpc failed", error);
        return { ok: false, error: "등록 활성화 중 오류가 발생했습니다." };
      }
      if (!activated) return { ok: false, error: GATE_CHANGED };
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  // 상담 상태 미러(정본은 enrollments) — 등록 이벤트에 맞춰 상담 결과를 '등록'으로 맞춘다.
  // 실패해도 활성화를 되돌리지 않는다: 상담 상태는 유입 화면의 라벨이고, 등록의 정본이 아니다.
  if (before.consultation_id) {
    const { error: consultationError } = await db
      .from("consultations")
      .update({ status: "registered" })
      .eq("tenant_id", session.tenantId)
      .eq("id", before.consultation_id)
      .neq("status", "registered");
    if (consultationError) {
      console.error("[enrollments] consultation mirror failed", consultationError);
    }
    revalidatePath(`/admin/consultations/${before.consultation_id}`);
  }

  // R-05 「등록 활성 → 등록 완료 안내 → 역할별 포털 초대」의 안내 단계.
  // 예외 「완료 안내 실패: 등록은 유지하고 전달 실패 업무 생성」 — 업무 성공과 전달 성공을
  // 분리한다(활성화는 이미 확정됐고, 전달만 다시 시도한다).
  const student = await getStudent(session.tenantId, before.student_id);
  if (student?.parentPhone) {
    const sent = await sendNotification({
      tenantId: session.tenantId,
      studentId: before.student_id,
      type: "enrollment_activated",
      phone: student.parentPhone,
      message: renderTemplate("enrollment_activated", { name: student.name }),
      isAd: false,
    });
    if (!sent.ok && !sent.skipped) {
      await createWorkItem(session.tenantId, {
        kind: "manual",
        priority: "normal",
        title: "등록 완료 안내 전달 실패",
        detail: `${student.name} 학생 등록 활성 · ${sent.error ?? "발송 실패"}`,
        sourceType: "enrollment",
        sourceId: id,
        nextAction: "보호자에게 등록 완료를 직접 안내하고 포털 초대를 발급",
      });
    }
  }

  revalidateEnrollment(id);
  revalidateStudent(before.student_id);
  return result;
}

/* ---------- ⑧ 등록 종료 (E-04) ----------
   활성 등록만 종료한다. students.status='ended' 미러가 곧 포털 접근 회수의 방아쇠다 —
   기존 로직(getStudentByPortalToken)이 students.status로 판단하므로 미러를 갱신하면 E-04
   접근 회수가 자동으로 연결된다. 그래서 미러 실패는 종료를 되돌린다: "등록은 끝났는데
   접근은 열려 있는" 상태를 만들지 않는다. */

export async function endEnrollment(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!id) return { ok: false, error: "잘못된 요청입니다." };
  if (reason.length < 2) return { ok: false, error: "종료 사유를 입력해 주세요." };

  const db = createServiceClient()!;
  const before = await loadEnrollment(db, session.tenantId, id);
  if (!before) return { ok: false, error: "등록 정보를 찾을 수 없습니다." };
  if (before.status !== "active") {
    return { ok: false, error: "활성 등록만 종료할 수 있습니다." };
  }

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "enrollment_end",
      targetType: "enrollment",
      targetId: id,
      summary: "정규 등록 종료(포털 접근 회수 연결)",
      category: AUDIT_OTHER,
      before: { status: "active" },
      after: { status: "ended", student_status_mirror: "ended" },
      reason,
    },
    async (): Promise<CrmActionResult> => {
      const endedAt = new Date().toISOString();
      const { data: ended, error } = await db
        .from("enrollments")
        .update({ status: "ended", ended_at: endedAt, end_reason: reason })
        .eq("tenant_id", session.tenantId)
        .eq("id", id)
        .eq("status", "active")
        .select("id")
        .maybeSingle();
      if (error || !ended) {
        if (error) console.error("[enrollments] end update failed", error);
        return {
          ok: false,
          error: error
            ? "등록 종료 중 오류가 발생했습니다."
            : "이미 종료됐거나 활성 등록이 아닙니다 — 화면을 새로 고쳐 확인해 주세요.",
        };
      }

      const { error: mirrorError } = await db
        .from("students")
        .update({ status: "ended", updated_at: endedAt })
        .eq("tenant_id", session.tenantId)
        .eq("id", before.student_id)
        .neq("status", "ended");
      if (mirrorError) {
        console.error("[enrollments] student mirror(ended) failed", mirrorError);
        const { error: revertError } = await db
          .from("enrollments")
          .update({ status: "active", ended_at: null, end_reason: null })
          .eq("tenant_id", session.tenantId)
          .eq("id", id)
          .eq("status", "ended");
        if (revertError) console.error("[enrollments] end revert failed", revertError);
        return {
          ok: false,
          error: "학생 상태(접근 회수) 반영에 실패해 등록 종료를 실행하지 않았습니다. 잠시 후 다시 시도해 주세요.",
        };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidateEnrollment(id);
  revalidateStudent(before.student_id);
  return result;
}

/* ---------- ⑨ 활성화 전 취소 (R-06) ----------
   계약 미동의·미결제·일정 미합의·정원 상실·고객 철회로 준비가 끝났을 때 준비 중 등록을 닫는다.
   students.status 미러는 건드리지 않는다 — 활성화된 적이 없으므로 이 등록이 학생 상태를 바꾼
   적도 없다(시범·상담 단계의 상태를 여기서 덮어쓰면 그게 회귀다).
   이미 수납된 금액의 환불은 결제 화면의 흐름이다(R-06 "돈 있음") — 화면에서 안내로 잇는다. */

export async function cancelEnrollment(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!id) return { ok: false, error: "잘못된 요청입니다." };
  if (reason.length < 2) return { ok: false, error: "취소 사유를 입력해 주세요." };

  const db = createServiceClient()!;
  const before = await loadEnrollment(db, session.tenantId, id);
  if (!before) return { ok: false, error: "등록 정보를 찾을 수 없습니다." };
  if (before.status !== "pending") {
    return { ok: false, error: "준비 중 등록만 취소할 수 있습니다." };
  }

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "enrollment_cancel",
      targetType: "enrollment",
      targetId: id,
      summary: "정규 등록 취소(활성화 전 포기)",
      category: AUDIT_OTHER,
      before: {
        status: "pending",
        relation_ok: before.relation_ok,
        contract_ok: before.contract_ok,
        payment_ok: before.payment_ok,
        schedule_ok: before.schedule_ok,
      },
      after: { status: "canceled" },
      reason,
    },
    async (): Promise<CrmActionResult> => {
      const { data: canceled, error } = await db
        .from("enrollments")
        // ended_at은 '닫힌 시각'으로 함께 남긴다 — 보존기한·정산 대사의 기산점이 된다.
        .update({ status: "canceled", ended_at: new Date().toISOString(), end_reason: reason })
        .eq("tenant_id", session.tenantId)
        .eq("id", id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (error || !canceled) {
        if (error) console.error("[enrollments] cancel update failed", error);
        return {
          ok: false,
          error: error
            ? "등록 취소 중 오류가 발생했습니다."
            : "이미 닫혔거나 준비 중 등록이 아닙니다 — 화면을 새로 고쳐 확인해 주세요.",
        };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidateEnrollment(id);
  if (before.consultation_id) revalidatePath(`/admin/consultations/${before.consultation_id}`);
  return result;
}
