"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { getConsultation } from "@/lib/data/crm";
import { getForm,
  listTrialSessions,
} from "@/lib/data/intake";
import { hashIntakeToken, intakeFormPath, newIntakeToken } from "@/lib/intake/token";
import { logActivity, runCritical } from "@/lib/data/activity";
import { createReportRow } from "@/lib/data/reports";
import { generateReport } from "@/lib/ai/generate";
import { pseudonymize } from "@/lib/ai/pseudonym";
import { REPORT_PROMPT_RULES } from "@/lib/ai/validate";
import { sendNotification } from "@/lib/notify/send";
import { renderTemplate } from "@/lib/notify/templates";
import { resolveTenant } from "@/lib/tenant";
import type { ConsultationStatus, IntakeFormKind } from "@/lib/types";
import type { CrmActionResult } from "@/components/admin/crm/types";
import { AI_REPORT_DISCLAIMER } from "../reports/constants";
import { INTAKE_KIND_LABEL } from "./intake-constants";

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

/* ==================================================================
   신청폼 발급 — T-01(시범수업 신청폼 발송·제출) · R-01(정규수업 신청폼 발송·제출)
                · C-05(상담 결과) · 검수 5·6·7
   ------------------------------------------------------------------
   정본: docs/flow-canon/01_atlas_01_intake.md
     · C-05 예외 「결과 변경: 기존 다음 단계 링크를 먼저 닫고 새 결과를 생성」
             「동시 활성화 제한: 동시에 활성화되는 다음 단계는 하나」
     · T-01 예외 「링크 만료: 기존 링크 종료 → 운영자 확인 후 새 링크 발급」
                 「발송 실패: 같은 유효 링크 재전달」
     · C-02 예외 「판단 전: 다음 단계 폼 발송과 등록 전환을 보류」
   검수 5(중복 판단 전 발송 금지) · 6(다음 단계 하나만 활성) · 7(새 폼 발급 시 이전 폼 닫힘)

   이 파일이 지키는 세 가지:
    ① 발급 게이트(검수 5) — 운영자가 중복·기존 관계 확인을 선언하지 않으면 발급하지 않는다.
       화면 체크박스만이 아니라 서버에서도 거부한다(UI만의 게이트는 게이트가 아니다).
       한계는 intake-constants.ts의 DUPLICATE_CHECK_LABEL 주석에 명시.
    ② 하나만 활성(검수 6·7) — 새 폼을 발급할 때 이 상담의 열린(sent) 폼을 종류에 관계없이
       모두 닫는다. 같은 종류는 검수 7(재발급), 다른 종류는 검수 6(결과 변경)이 근거다.
       DB도 같은 편이다: intake_forms_one_active_per_kind 부분 유니크가 같은 종류의 활성
       두 건을 원천 차단하므로, 닫기를 빠뜨리면 INSERT 자체가 실패한다.
    ③ 반쪽 상태 금지 — 이전 폼을 닫은 뒤 새 폼 INSERT가 실패하면 닫은 것을 되돌린다.
       "이전 링크는 죽었는데 새 링크는 없는" 상태로 끝내지 않는다.
   ================================================================== */

/** 신청폼 링크 유효기간(일) — 발급 시각 기준. 만료 후 재발급은 resendIntakeForm(링크 회전). */
const INTAKE_FORM_TTL_DAYS = 14;

const INTAKE_KINDS: IntakeFormKind[] = ["trial", "regular"];

function isIntakeKind(value: string): value is IntakeFormKind {
  return (INTAKE_KINDS as string[]).includes(value);
}

/*
 * 토큰 발급·해시·경로 규약은 lib/intake/token.ts 하나가 정본이다 —
 * 발급(여기)과 작성 화면(app/f/[token])이 같은 함수를 써야 한다.
 * 접두사·알고리즘·인코딩이 한 글자라도 갈라지면 발급된 링크가 전부 열리지 않으므로
 * 이 파일에 같은 계산을 다시 두지 않는다(해시 규약은 그 파일 주석 참조).
 * DB(intake_forms.token_hash)에는 해시만 저장하고 원문은 발급 순간에만 존재한다.
 */

/**
 * 작성 링크의 호스트 — 지금 운영자가 쓰고 있는 요청 호스트를 그대로 쓴다.
 *
 * M1(포털 초대)에서 얻은 교훈 그대로다: 고정 상수(NEXT_PUBLIC_SITE_URL)를 쓰면 1호 테넌트가
 * 아닌 운영자가 발급한 링크가 전부 남의 도메인을 가리키고, 작성 화면은 호스트로 테넌트를
 * 판정하므로(lib/tenant.ts resolveTenant) 열리지 않는 링크가 된다. 로컬 개발에서도 자동으로
 * localhost 링크가 나온다. 구현은 students/actions.ts portalOrigin과 같지만 그 파일은 소유
 * 밖이라 import하지 않고 같은 규칙을 여기 둔다(값이 아니라 규칙의 중복이다).
 */
async function intakeOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-tenant-host") ?? h.get("host") ?? "";
  if (!host) return process.env.NEXT_PUBLIC_SITE_URL ?? "https://axiommathlab.kr";
  const forwarded = h.get("x-forwarded-proto");
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const proto = forwarded ?? (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}

/** 발급 결과 — 링크 원문은 이번 응답에만 존재한다(DB엔 해시만). 발송 실패해도 발급은 유지된다. */
export interface IntakeFormIssueResult extends CrmActionResult {
  /**
   * 발급된 작성 링크 전체 주소. 알림 발송이 실패해도 발급을 되돌리지 않으므로
   * (T-01 「발송 실패: 같은 유효 링크 재전달」) 운영자가 직접 전달할 수 있게 돌려준다.
   * 새로고침하면 사라진다 — 다시 보려면 재발급(링크 회전)뿐이다.
   */
  link?: string;
  /** 발급은 됐으나 운영자가 알아야 하는 사실(발송 실패·상태 갱신 실패 등). */
  warnings?: string[];
}

/** runCritical의 T — 성공이면 링크가 반드시 있는 판별 유니온(호출부의 non-null 단언 제거). */
type IntakeFormMutation =
  | { ok: true; link: string; formId: string; warnings: string[]; error?: undefined }
  | { ok: false; error: string; link?: undefined; formId?: undefined; warnings?: undefined };

/** 발급에 필요한 상담 최소 정보 — 수신자 판정과 상태 갱신에만 쓴다. */
interface IntakeConsultation {
  id: string;
  name: string;
  phone: string;
  guardian_phone: string | null;
  student_id: string | null;
  status: ConsultationStatus;
}

async function fetchIntakeConsultation(
  tenantId: string,
  id: string,
): Promise<IntakeConsultation | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data, error } = await db
    .from("consultations")
    .select("id, name, phone, guardian_phone, student_id, status")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[consultations] intake consultation fetch failed", error);
    return null;
  }
  return (data as IntakeConsultation | null) ?? null;
}

/**
 * 폼 발급에 따른 상담 상태(consultations.status) 갱신값. 바꿀 필요가 없으면 null.
 *
 * 상담 상태는 기존 화면 전부가 읽는 컬럼이라 값 집합(new|contacted|trial|registered|hold)을
 * 늘리지 않는다. 그래서 표현에 한계가 있다:
 *  · 시범 폼 발급 → 'trial'. 시범 갈래로 들어갔다는 사실이 그대로 담긴다.
 *  · 정규 폼 발급 → 담을 값이 없다. 'registered'는 이제 "등록 활성"(enrollments) 미러라
 *    폼을 보낸 단계에 쓰면 등록되지 않은 사람이 등록으로 보인다. 최소한 '연락 이후'라는
 *    사실만 반영해 'new'일 때만 'contacted'로 올린다.
 *  · 'registered'(이미 등록 활성)는 어떤 경우에도 내리지 않는다 — 폼 발급이 등록을 되돌리지 않는다.
 */
function nextConsultationStatus(
  current: ConsultationStatus,
  kind: IntakeFormKind,
): ConsultationStatus | null {
  if (current === "registered") return null;
  if (kind === "trial") return current === "trial" ? null : "trial";
  return current === "new" ? "contacted" : null;
}

/**
 * 발급 본체 — 신규 발급(issueIntakeForm)과 재발급(resendIntakeForm)이 공유한다.
 *
 * 순서: 열린 폼 닫기(검수 6·7) → 열린 자리 제안 정리 → 새 폼 INSERT → 상담 상태 갱신 → 링크 발송.
 * 전부 runCritical 안에서 실행한다 — 감사 선기록(pending)이 남지 않으면 아무것도 하지 않는다.
 *
 * 감사 카테고리: 신청폼 발급은 금전·성적 전환이 아니다. activity_log.category CHECK는
 * 'other'도 허용하지만(00013_m0_foundation.sql:71) 그 값을 노출하는 타입(ActivityCategory,
 * lib/data/activity.ts — 이번 소유 밖)이 금전·권한·성적·개인정보 4종만 갖는다. 넷 중에서는
 * 'privacy'가 사실에 가장 가깝다: 발급은 신청자 개인정보를 수집하는 링크를 특정 번호로
 * 여는 행위이고, 그 링크는 신청자 이름을 공개 화면에 되돌려준다(lib/data/intake.ts
 * getFormByTokenHash). 타입이 'other'를 노출하면 그때 바꿀 것.
 */
async function issueIntakeFormInternal(
  session: { tenantId: string; email: string },
  consultation: IntakeConsultation,
  kind: IntakeFormKind,
  opts: {
    action: string;
    summary: string;
    reason: string;
    /**
     * 이 발급이 "상담 결과를 새로 정하는 사건"인가.
     * 신규 발급이면 true — 열린 자리 제안을 이 사람의 자리로 확정(accepted)한다.
     * 재발급(링크 회전)은 결과를 새로 정하는 사건이 아니므로 false — 신청자 회신 없이
     * 수락 의사표시를 기록하면 안 된다(C-06 "대기순서만으로 자동 확정하지 않는다").
     */
    claimSeat: boolean;
  },
): Promise<IntakeFormIssueResult> {
  const db = createServiceClient()!;
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + INTAKE_FORM_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const rawToken = newIntakeToken();
  const tokenHash = hashIntakeToken(rawToken);
  const link = `${await intakeOrigin()}${intakeFormPath(rawToken)}`;

  const result = await runCritical<IntakeFormMutation>(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: opts.action,
      targetType: "intake_form",
      // INSERT 전 선기록이라 새 폼 id는 아직 없다 — after_data의 상담·종류로 대상을 특정한다.
      targetId: null,
      summary: opts.summary,
      category: "privacy",
      reason: opts.reason,
      before: { consultation_status: consultation.status },
      after: {
        consultation_id: consultation.id,
        kind,
        expires_at: expiresAt,
        // 수신 번호 원문은 남기지 않는다 — 감사 열람이 연락처 열람이 되지 않게 뒷 4자리만.
        recipient_tail: (consultation.guardian_phone || consultation.phone).slice(-4),
      },
    },
    async (): Promise<IntakeFormMutation> => {
      const warnings: string[] = [];
      const reopenIds: string[] = [];
      const reofferIds: string[] = [];

      /** 보상 롤백 — 이번 호출이 실제로 닫은 것만 되돌린다(다른 경로가 닫은 건 건드리지 않는다). */
      const restoreClosed = async () => {
        for (const formId of reopenIds) {
          const { error } = await db
            .from("intake_forms")
            .update({ status: "sent", closed_at: null, close_reason: null })
            .eq("tenant_id", session.tenantId)
            .eq("id", formId);
          if (error) {
            console.error("[consultations] intake form reopen failed", error);
          }
        }
        for (const offerId of reofferIds) {
          // 자리 부분 유니크(waitlist_offers_one_per_seat)에 걸릴 수 있다 — 그 사이 같은 자리에
          // 다른 제안이 열렸다면 되돌리지 않는 게 맞다(한 자리 한 사람 — 검수 61). 로그만 남긴다.
          const { error } = await db
            .from("waitlist_offers")
            .update({ status: "offered", responded_at: null })
            .eq("tenant_id", session.tenantId)
            .eq("id", offerId);
          if (error) {
            console.error("[consultations] waitlist offer restore failed", error);
          }
        }
      };

      /* ① 이 상담의 열린 폼을 종류에 관계없이 닫는다 —
            같은 종류는 검수 7(재발급), 다른 종류는 검수 6(상담 결과는 하나만 활성). */
      const { data: openForms, error: openFormsError } = await db
        .from("intake_forms")
        .select("id, kind")
        .eq("tenant_id", session.tenantId)
        .eq("consultation_id", consultation.id)
        .eq("status", "sent");
      if (openFormsError) {
        console.error("[consultations] open intake form lookup failed", openFormsError);
        return { ok: false, error: "기존 신청폼 확인 중 오류가 발생했습니다." };
      }

      for (const row of (openForms ?? []) as { id: string; kind: IntakeFormKind }[]) {
        const closeReason =
          row.kind === kind
            ? `${INTAKE_KIND_LABEL[kind]} 재발급 — 이전 링크 종료(검수 7)`
            : `상담 결과 변경(${INTAKE_KIND_LABEL[kind]} 발급) — 다음 단계는 하나만 활성(검수 6)`;
        const { data: closedRow, error: closeError } = await db
          .from("intake_forms")
          .update({ status: "closed", closed_at: nowIso, close_reason: closeReason })
          .eq("tenant_id", session.tenantId)
          .eq("id", row.id)
          .eq("status", "sent")
          .select("id")
          .maybeSingle();
        if (closeError) {
          console.error("[consultations] intake form close failed", closeError);
          await restoreClosed();
          return { ok: false, error: "이전 신청폼을 닫는 중 오류가 발생했습니다." };
        }
        // 0행이면 그 사이 다른 경로가 이미 닫은 것이다 — 실패가 아니고, 되돌릴 대상도 아니다.
        if (closedRow) reopenIds.push(row.id);
      }

      /* ② 열린 자리 제안 정리(검수 6).
            자리를 반환하지 않고 accepted(자리 예약)로 닫는다 — 정본 C-06의 정상 경로가
            「수락 → 자리 예약 → 시범 또는 정규 제안 → 해당 폼 발송」이라, 이 상담에 폼을
            발급한다는 것은 그 자리를 이 사람에게 준다는 뜻이다. 여기서 expired/declined로
            돌리면 자리가 대기열로 반환돼(검수 62) 방금 폼을 받은 사람의 자리가 사라진다.
            ⚠️ 한계: 신청자의 실제 수락 의사표시와 운영자의 발급이 같은 사건으로 기록된다.
            의사표시를 따로 남기려면 수락 액션(대기명단 화면)을 먼저 쓰면 된다 — 그때는
            이미 offered가 아니라 여기서 닫을 것이 없다. */
      const { data: openOffers, error: openOffersError } = opts.claimSeat
        ? await db
            .from("waitlist_offers")
            .select("id")
            .eq("tenant_id", session.tenantId)
            .eq("consultation_id", consultation.id)
            .eq("status", "offered")
        : { data: [] as { id: string }[], error: null };
      if (openOffersError) {
        console.error("[consultations] open waitlist offer lookup failed", openOffersError);
        await restoreClosed();
        return { ok: false, error: "열린 자리 제안 확인 중 오류가 발생했습니다." };
      }
      for (const row of (openOffers ?? []) as { id: string }[]) {
        const { data: acceptedRow, error: acceptError } = await db
          .from("waitlist_offers")
          .update({ status: "accepted", responded_at: nowIso })
          .eq("tenant_id", session.tenantId)
          .eq("id", row.id)
          .eq("status", "offered")
          .select("id")
          .maybeSingle();
        if (acceptError) {
          console.error("[consultations] waitlist offer accept failed", acceptError);
          await restoreClosed();
          return { ok: false, error: "열린 자리 제안을 정리하는 중 오류가 발생했습니다." };
        }
        if (acceptedRow) reofferIds.push(row.id);
      }

      /* ③ 새 폼 발급. token_hash만 저장하고 원문은 이 호출의 반환값으로만 나간다. */
      const { data: inserted, error: insertError } = await db
        .from("intake_forms")
        .insert({
          tenant_id: session.tenantId,
          consultation_id: consultation.id,
          kind,
          token_hash: tokenHash,
          status: "sent",
          sent_at: nowIso,
          expires_at: expiresAt,
        })
        .select("id")
        .single();
      if (insertError || !inserted) {
        console.error("[consultations] intake form insert failed", insertError);
        // 반쪽 상태 방지: 이전 링크만 죽고 새 링크는 없는 상태로 끝내지 않는다.
        await restoreClosed();
        if (insertError?.code === "23505") {
          // 같은 상담·같은 종류의 활성 폼 부분 유니크 위반 — 다른 운영자가 방금 발급했다.
          return {
            ok: false,
            error:
              "이미 발급 중인 신청폼이 있습니다. 화면을 새로고침해 최신 상태를 확인한 뒤 다시 시도해 주세요.",
          };
        }
        return { ok: false, error: "신청폼 발급 중 오류가 발생했습니다." };
      }
      const formId = (inserted as { id: string }).id;

      /* ④ 상담 상태 — 폼 발급 이벤트에 맞춰 갱신한다(실패는 경고, 발급을 되돌리지 않는다). */
      const nextStatus = nextConsultationStatus(consultation.status, kind);
      if (nextStatus) {
        const { error: statusError } = await db
          .from("consultations")
          .update({ status: nextStatus })
          .eq("tenant_id", session.tenantId)
          .eq("id", consultation.id);
        if (statusError) {
          console.error("[consultations] status sync after issue failed", statusError);
          warnings.push("상담 상태 자동 갱신에 실패했습니다. 상태를 직접 확인해 주세요.");
        }
      }

      /* ⑤ 링크 발송. 전달 실패는 발급을 되돌리지 않는다 — 업무(발급)와 전달(알림)은 다른 계층이고
            실패분은 notifications 큐(재시도 크론)로 수렴한다(T-01 「발송 실패: 같은 유효 링크 재전달」).
            운영자는 반환된 링크를 직접 전달할 수 있다. */
      const tenant = await resolveTenant();
      const phone = consultation.guardian_phone || consultation.phone;
      // 문구에 종류(시범/정규)·수업조건·금전 정보를 담지 않는다 — 링크 자체가 작성 권한이라
      // 오수신 시 피해를 줄인다. 종류와 기한은 링크를 연 작성 화면이 안내한다.
      const message = `[${tenant.brandName}] ${renderTemplate("intake_form_sent", {
        name: consultation.name,
      })}\n${link}`;
      const sent = await sendNotification({
        tenantId: session.tenantId,
        studentId: consultation.student_id,
        type: "intake_form_sent",
        phone,
        message,
        isAd: false,
      });
      if (!sent.ok) {
        warnings.push(
          `링크 발송에 실패했습니다(${sent.error ?? "사유 미상"}). 아래 링크를 직접 전달해 주세요.`,
        );
      } else if (sent.queued) {
        warnings.push("발송이 대기열에 적재되었습니다. 전달 여부를 알림 내역에서 확인해 주세요.");
      }

      return { ok: true, link, formId, warnings };
    },
  );

  if (!result.ok) return { ok: false, error: result.error };

  const warnings = [...result.warnings];
  if (result.auditWarning) warnings.push(result.auditWarning);
  return { ok: true, link: result.link, warnings };
}

/**
 * 신청폼 발급(시범·정규) — C-05 「상담 결과」의 다음 단계 링크를 만든다.
 *
 * duplicateChecked는 검수 5의 게이트다: 「중복 판단 전에는 시범·정규 폼을 발송할 수 없다」.
 * 정본 신호대로라면 상담에 '중복 확인 완료' 사실이 저장돼 있어야 하지만 그 컬럼이 없어
 * (한계는 intake-constants.ts DUPLICATE_CHECK_LABEL 주석), 운영자의 확인 선언을 인자로 받아
 * 서버에서 거부하고 감사 사유로 남긴다. 화면 체크박스만 두면 액션 직접 호출로 우회되므로
 * 게이트는 반드시 이 층에도 있어야 한다.
 */
export async function issueIntakeForm(
  consultationId: string,
  kind: string,
  duplicateChecked: boolean,
): Promise<IntakeFormIssueResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  if (!consultationId) return { ok: false, error: "잘못된 요청입니다." };
  if (!isIntakeKind(kind)) return { ok: false, error: "신청폼 종류가 올바르지 않습니다." };
  if (!duplicateChecked) {
    return {
      ok: false,
      error:
        "중복·기존 관계 확인을 먼저 완료해 주세요. 확인 전에는 신청폼을 발송할 수 없습니다(검수 5).",
    };
  }

  const consultation = await fetchIntakeConsultation(session.tenantId, consultationId);
  if (!consultation) return { ok: false, error: "상담 정보를 찾을 수 없습니다." };

  // 검수 11 — 정규 폼은 "시범 결과가 정규 제안일 때만" 열린다.
  // 시범 회차가 아예 없는 상담은 C-05가 허용하는 '시범 생략·직접 정규 제안'이므로 통과시킨다.
  // 회차가 있는데 최신 결과가 정규 제안이 아니면(재시범·후속·거절·미진행·미결정) 거부한다.
  if (kind === "regular") {
    const trials = await listTrialSessions(session.tenantId, { consultationId });
    if (trials.length > 0) {
      const decided = trials
        .filter((t) => t.latestResult)
        .sort((a, b) =>
          (b.latestResult?.decidedAt ?? "").localeCompare(a.latestResult?.decidedAt ?? ""),
        );
      const latest = decided[0]?.latestResult ?? null;
      if (latest?.result !== "regular_offer") {
        return {
          ok: false,
          error:
            "시범 결과가 '정규 제안'일 때만 정규 신청폼을 발급할 수 있습니다(검수 11). 시범 화면에서 결과를 먼저 확정해 주세요.",
        };
      }
    }
  }

  const result = await issueIntakeFormInternal(session, consultation, kind, {
    claimSeat: true, // 신규 발급 = 이 상담의 결과를 정하는 사건 → 열린 자리를 이 사람에게 확정
    action: "issue_intake_form",
    summary: `${INTAKE_KIND_LABEL[kind]} 발급 — ${consultation.name}`,
    reason:
      "중복·기존 관계 확인 완료 선언(C-02·검수 5) 후 발급 — 확인 사실을 저장하는 컬럼이 없어 운영자 선언으로만 남는다",
  });
  if (result.ok) revalidateConsultation(consultationId);
  return result;
}

/**
 * 신청폼 재발급(링크 회전) — T-01 「링크 만료: 기존 링크 종료 → 운영자 확인 후 새 링크 발급」.
 *
 * DB에는 해시만 있어 원문 링크를 다시 꺼낼 수 없다. 그래서 "같은 링크 재전달"은 구조상
 * 불가능하고, 이전 링크를 닫고 새 링크를 발급하는 회전이 그 자리를 대신한다 —
 * 이전 링크는 즉시 무효가 되므로 회전 사실을 운영자에게 화면에서 알린다.
 * 중복 확인 게이트(검수 5)는 최초 발급에서 이미 통과했다 — 같은 상담·같은 종류를 이어서
 * 다시 보내는 것이라 판단 대상이 새로 생기지 않는다(다른 종류로 바꾸는 것은 신규 발급이다).
 */
export async function resendIntakeForm(
  formId: string,
): Promise<IntakeFormIssueResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  if (!formId) return { ok: false, error: "잘못된 요청입니다." };

  const form = await getForm(session.tenantId, formId);
  if (!form) return { ok: false, error: "신청폼을 찾을 수 없습니다." };
  if (form.status !== "sent") {
    return {
      ok: false,
      error:
        "이미 닫혔거나 제출된 신청폼은 재발급할 수 없습니다. 새 신청폼을 발급해 주세요.",
    };
  }

  const consultation = await fetchIntakeConsultation(session.tenantId, form.consultationId);
  if (!consultation) return { ok: false, error: "상담 정보를 찾을 수 없습니다." };

  const result = await issueIntakeFormInternal(session, consultation, form.kind, {
    claimSeat: false, // 링크 회전은 결과를 새로 정하는 사건이 아니다 — 자리 상태를 건드리지 않는다
    action: "reissue_intake_form",
    summary: `${INTAKE_KIND_LABEL[form.kind]} 재발급(링크 회전) — ${consultation.name}`,
    reason: form.isExpired
      ? "링크 만료 — 기존 링크 종료 후 새 링크 발급(T-01)"
      : "링크 재전달 요청 — 기존 링크 종료 후 새 링크 발급(T-01)",
  });
  if (result.ok) revalidateConsultation(form.consultationId);
  return result;
}

/**
 * 신청폼 닫기 — C-05 「종결: 열린 폼과 자리 제안을 모두 닫고」·「결과 변경: 기존 링크를 먼저 닫고」.
 *
 * 감사는 fail-open(logActivity)이다. 닫기는 접근을 좁히는 방향이라, 감사 실패로 막으면
 * 닫아야 할 링크가 열린 채 남는다 — 발급(fail-closed)과 방향이 반대라 계약도 반대로 둔다.
 */
export async function closeIntakeForm(
  formId: string,
  reason: string,
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  if (!formId) return { ok: false, error: "잘못된 요청입니다." };

  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: "닫는 사유를 입력해 주세요." };

  const db = createServiceClient()!;
  // status='sent' 조건을 UPDATE에 넣어 이미 제출·종료된 폼을 뒤늦게 닫지 않게 한다
  // (제출된 폼을 closed로 덮으면 "무엇을 보고 승인했는지"가 사라진다 — R-01 운영자 검토 근거).
  const { data, error } = await db
    .from("intake_forms")
    .update({ status: "closed", closed_at: new Date().toISOString(), close_reason: trimmed })
    .eq("tenant_id", session.tenantId)
    .eq("id", formId)
    .eq("status", "sent")
    .select("id, consultation_id, kind")
    .maybeSingle();
  if (error) {
    console.error("[consultations] intake form close failed", error);
    return { ok: false, error: "신청폼을 닫는 중 오류가 발생했습니다." };
  }
  if (!data) {
    return { ok: false, error: "이미 닫혔거나 제출된 신청폼입니다." };
  }
  const closed = data as { id: string; consultation_id: string; kind: IntakeFormKind };

  await logActivity(
    session.tenantId,
    session.email,
    "close",
    "intake_form",
    closed.id,
    `${INTAKE_KIND_LABEL[closed.kind]} 닫기 (${trimmed})`,
  );

  revalidateConsultation(closed.consultation_id);
  return { ok: true };
}
