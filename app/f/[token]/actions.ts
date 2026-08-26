"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { resolveTenant } from "@/lib/tenant";
import { createWorkItem } from "@/lib/data/work";
import { getFormByTokenHash } from "@/lib/data/intake";
import { hashIntakeToken } from "@/lib/intake/token";
import {
  buildIntakePayload,
  intakeFormSchema,
  type IntakeFormValues,
} from "@/components/public/intake/schema";
import { POLICY_VERSION } from "@/lib/policy";

// 신청폼 제출(공개) — T-01 시범 신청폼 제출 · R-01 정규 신청폼 제출.
//
// 규율 셋:
//  ① 종류는 링크가 정한다: 클라가 보낸 kind를 버리고 DB(intake_forms.kind)로 덮어써서 재검증한다.
//     정규 폼에 시범 폼 모양으로 제출해 관계·수업조건 검증을 건너뛰는 우회를 막는다.
//  ② 중복 제출은 최초 제출 결과로 수렴한다(T-01 예외): 이미 submitted면 payload를 덮어쓰지 않고
//     "이미 제출되었습니다"로 안내한다. 판정은 조회가 아니라 UPDATE의 WHERE(status='sent')로 한다 —
//     조회와 갱신 사이에 다른 탭이 먼저 제출하는 창을 없앤다(두 번 눌러도 한 번만 저장된다).
//  ③ 실패 사유는 구분하지 않는다: 없는 토큰·닫힌 폼·기한 경과가 모두 같은 문구다(존재 비노출).
//     예외는 '이미 제출됨' 하나인데, 이건 실패가 아니라 최초 제출 결과로의 수렴이라 성공 화면으로 간다.
//
// 폼 제출이 곧 일정 확정이 아니라는 사실(검수 8)은 화면 문구뿐 아니라 데이터로도 지켜진다 —
// 이 액션은 trial_sessions·enrollments를 만들지 않고 운영자 검토 업무만 만든다.


const DB_ERROR_MESSAGE =
  "지금은 제출할 수 없습니다. 잠시 후 다시 시도해 주세요.";
// 없는 토큰·닫힌 폼·기한 경과·다른 테넌트 — 전부 이 한 문구로 수렴한다(사유 비노출).
const UNAVAILABLE_MESSAGE =
  "지금은 이 링크로 신청서를 제출할 수 없습니다. 담당 선생님께 새 링크를 요청해 주세요.";
const SAVE_ERROR_MESSAGE =
  "제출 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요. 계속 실패하면 담당 선생님께 알려 주세요.";

export type IntakeSubmitResult =
  /** already=true면 이번 입력은 저장되지 않았고 최초 제출본이 유지된다. */
  | { ok: true; already: boolean }
  | { ok: false; error: string };

export async function submitIntakeForm(
  token: string,
  values: IntakeFormValues,
): Promise<IntakeSubmitResult> {
  const db = createServiceClient();
  if (!db) return { ok: false, error: DB_ERROR_MESSAGE };

  if (typeof token !== "string" || token.length === 0 || token.length > 200) {
    return { ok: false, error: UNAVAILABLE_MESSAGE };
  }

  const tenant = await resolveTenant();
  const tokenHash = hashIntakeToken(token);
  const form = await getFormByTokenHash(tenant.id, tokenHash);
  if (!form) return { ok: false, error: UNAVAILABLE_MESSAGE };

  // 최초 제출 결과로 수렴 — 덮어쓰지 않는다.
  if (form.status === "submitted") return { ok: true, already: true };
  if (!form.isOpen) return { ok: false, error: UNAVAILABLE_MESSAGE };

  // 종류는 DB가 정본이다(클라 입력 무시).
  const parsed = intakeFormSchema.safeParse({ ...values, kind: form.kind });
  if (!parsed.success) {
    return { ok: false, error: "입력 내용을 다시 확인해 주세요." };
  }

  const now = new Date().toISOString();
  const payload = buildIntakePayload(parsed.data, {
    policyVersion: POLICY_VERSION,
    consentedAt: now,
  });

  // 제출 확정 — 단일 UPDATE로 판정과 기록을 함께 한다.
  //  · status='sent' 조건이 중복 제출 방지선이다(먼저 제출한 쪽만 1행을 갱신한다).
  //  · 기한도 WHERE에 넣는다 — 화면을 열어 둔 채 기한이 지난 뒤 누른 제출은 통과시키지 않는다.
  //  · 동의는 payload에 함께 실린다 — 제출과 동의가 한 문장이라 "동의 없는 제출"이 존재할 수 없다.
  const { data: updated, error: updateError } = await db
    .from("intake_forms")
    .update({ status: "submitted", submitted_at: now, payload })
    .eq("tenant_id", tenant.id)
    .eq("id", form.id)
    .eq("status", "sent")
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .select("id")
    .maybeSingle();

  if (updateError) {
    console.error("[intake] 신청폼 제출 저장 실패", updateError);
    return { ok: false, error: SAVE_ERROR_MESSAGE };
  }

  if (!updated) {
    // 조회 시점엔 열려 있었는데 갱신되지 않았다 = 그 사이 다른 탭이 제출했거나 폼이 닫혔다.
    // 다시 읽어 '이미 제출'만 성공으로 수렴시키고 나머지는 같은 안내로 닫는다.
    const current = await getFormByTokenHash(tenant.id, tokenHash);
    if (current?.status === "submitted") return { ok: true, already: true };
    return { ok: false, error: UNAVAILABLE_MESSAGE };
  }

  // 동의 원장 기록 — 주체는 이 폼이 달린 상담이다(consents.subject_type에 폼 종류가 없고,
  // 신청서 동의도 결국 같은 상담 건의 개인정보 처리 동의다). 상담 폼과 같은 항목 구성:
  // 필수 문구에 'AI 처리 목적 가명화 국외이전'이 포함되므로 privacy와 overseas_ai를 함께 남긴다.
  //
  // 실패해도 제출을 되돌리지 않는다: 동의 사실은 이미 payload.consents에 제출과 같은 문장으로
  // 기록돼 있어 근거가 사라지지 않는다(상담 폼은 payload가 없어 보상 삭제가 유일한 방법이었다).
  const consentBase = {
    tenant_id: tenant.id,
    subject_type: "consultation",
    subject_id: form.consultationId,
    policy_version: POLICY_VERSION,
    via: "form",
  };
  const consentRows = [
    { ...consentBase, item: "privacy" },
    { ...consentBase, item: "overseas_ai" },
    ...(parsed.data.marketingConsent ? [{ ...consentBase, item: "marketing" }] : []),
  ];
  // tenant-scope-ok: consentBase가 tenant_id를 담고 전 행이 이를 스프레드한다(바로 위 선언).
  // 감사기는 insert 인자 변수의 선언 블록에서 리터럴 tenant_id만 찾아 2단계 간접참조를 보지 못한다.
  const { error: consentError } = await db.from("consents").insert(consentRows);
  if (consentError) {
    console.error("[intake] 동의 기록 실패", consentError);
  }

  // 운영자 검토 업무로 수렴(T-01 "제출 → 운영자 검토" · R-01 동일).
  // createWorkItem은 fail-open이라 큐 적재 실패가 제출을 되돌리지 않는다.
  const isTrial = form.kind === "trial";
  await createWorkItem(tenant.id, {
    kind: "manual",
    title: "신청폼 제출 검토",
    detail: `${isTrial ? "시범" : "정규"} 신청폼 제출 — ${parsed.data.studentName} (${parsed.data.grade}, ${parsed.data.subject})`,
    sourceType: "intake_form",
    sourceId: form.id,
    priority: "normal",
    nextAction: isTrial
      ? "제출 내용을 확인하고 시범 회차를 제안하세요. 일정 합의와 (유료면) 결제 확인 전에는 확정이 아닙니다."
      : "제출 내용과 관계·수업 조건을 확인하고 등록 준비를 진행하세요. 계약·결제·일정·정원 네 조건이 모두 서야 활성화됩니다.",
  });

  return { ok: true, already: false };
}
