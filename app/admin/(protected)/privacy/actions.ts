"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { runCritical } from "@/lib/data/activity";
import { recomputeRetention } from "@/lib/privacy/retention";
import type { CrmActionResult } from "@/components/admin/crm/types";

// 개인정보 보존기록 운영 (D-04 기산 · D-05 보존 잠금).
//
// 이 파일의 전환은 전부 **개인정보 범주**라 runCritical(category "privacy")로 감싼다 —
// 감사 기록을 먼저 남기지 못하면 전환 자체를 실행하지 않는다(fail-closed, 00013 P-11).
// 잠금·해제·파기 기록은 나중에 "누가 언제 왜"를 답해야 하는 종류의 행위다.
//
// ⚠️ 여기의 '파기 완료 기록'은 데이터를 지우지 않는다. 실제 파기(주 저장소·외부 처리자·백업)는
// D-06·D-07의 몫이고 아직 구현돼 있지 않다 — 이 액션은 운영자가 파기를 실행했다는 사실을
// 원장에 남기는 것뿐이다. 화면 문구도 그렇게 적혀 있어야 한다.

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";

/**
 * 기산 갱신 — 원 데이터를 훑어 보존기록을 만들거나 기산일을 미룬다(멱등).
 * 훑는 사건은 lib/privacy/retention.ts의 RetentionEvent 목록이 정본이다.
 */
export async function recomputeRetentionRecords(): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "update",
      targetType: "retention",
      targetId: null,
      summary: "개인정보 보존기록 기산 갱신",
      category: "privacy",
    },
    async () => {
      const outcome = await recomputeRetention(session.tenantId);
      return outcome.ok
        ? {
            ok: true as const,
            summary: `신규 ${outcome.created}건 · 갱신 ${outcome.updated}건 · 파기 기록 보존 ${outcome.skippedDestroyed}건`,
          }
        : { ok: false as const, error: outcome.error ?? "기산에 실패했습니다." };
    },
  );

  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/admin/privacy");
  return { ok: true };
}

/**
 * 보존 잠금(legal hold) — 분쟁·법적 요청·사고 확인 시 파기를 막는다.
 * 사유는 필수다(DB CHECK로도 강제). 자동 해제는 없다 — 해제는 아래 액션뿐이다(D-05 예외).
 */
export async function holdRetentionRecord(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!id) return { ok: false, error: "잘못된 요청입니다." };
  if (!reason) return { ok: false, error: "보존 잠금 사유를 입력해 주세요." };

  const db = createServiceClient()!;
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "update",
      targetType: "retention",
      targetId: id,
      summary: "개인정보 보존 잠금(legal hold) 설정",
      category: "privacy",
      reason,
    },
    async () => {
      // 이미 파기 기록이 있는 행은 잠글 수 없다 — DB CHECK와 같은 판정을 여기서 먼저 해
      // 운영자에게 이유를 설명한다(제약 위반 메시지는 읽을 수 없다).
      const { data: updated, error } = await db
        .from("retention_records")
        .update({
          hold_at: new Date().toISOString(),
          hold_reason: reason,
          hold_by: session.email,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", session.tenantId)
        .eq("id", id)
        .is("destroyed_at", null)
        .is("hold_at", null)
        .select("id");
      if (error) {
        console.error("[privacy] hold 실패", error);
        return { ok: false as const, error: "보존 잠금에 실패했습니다." };
      }
      if (!updated || updated.length === 0) {
        return {
          ok: false as const,
          error: "이미 잠겨 있거나 파기 기록이 있는 항목입니다. 새로고침 후 확인해 주세요.",
        };
      }
      return { ok: true as const };
    },
  );

  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/admin/privacy");
  return { ok: true };
}

/** 보존 잠금 해제 — 해제 근거 확인 후 운영자 승인으로만(D-05). 해제하면 원 보존·파기 흐름으로 돌아간다. */
export async function releaseRetentionHold(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  const db = createServiceClient()!;
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "update",
      targetType: "retention",
      targetId: id,
      summary: "개인정보 보존 잠금 해제",
      category: "privacy",
    },
    async () => {
      // 잠금 사유·잠근 사람은 지우지 않는다 — 왜 잠겼었는지가 해제 뒤에도 증적으로 남아야 한다.
      const { data: updated, error } = await db
        .from("retention_records")
        .update({ hold_at: null, updated_at: new Date().toISOString() })
        .eq("tenant_id", session.tenantId)
        .eq("id", id)
        .not("hold_at", "is", null)
        .select("id");
      if (error) {
        console.error("[privacy] hold 해제 실패", error);
        return { ok: false as const, error: "보존 잠금 해제에 실패했습니다." };
      }
      if (!updated || updated.length === 0) {
        return { ok: false as const, error: "잠금 상태가 아닙니다. 새로고침 후 확인해 주세요." };
      }
      return { ok: true as const };
    },
  );

  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/admin/privacy");
  return { ok: true };
}

/**
 * 파기 완료 **기록**.
 *
 * 다시 말하지만 이 액션은 아무것도 지우지 않는다. 운영자가 실제 파기(주 저장소 삭제·외부
 * 처리자 삭제 요청·백업 확인)를 마친 뒤, 그 사실과 범위를 원장에 적는 것이다.
 * 그래서 무엇을 어떻게 파기했는지(note)를 필수로 받는다 — 내용 없는 파기 기록은 증적이 아니다.
 *
 * 기한 전 파기도 막지 않는다: 정보주체의 삭제 요청처럼 기한보다 먼저 파기하는 경우가 있고,
 * 그건 정당한 사유가 있는 운영자 판단이다. 대신 잠금 중에는 기록할 수 없다(D-05·DB CHECK).
 */
export async function recordRetentionDestruction(
  formData: FormData,
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!id) return { ok: false, error: "잘못된 요청입니다." };
  if (!note) {
    return { ok: false, error: "무엇을 어떻게 파기했는지 적어 주세요(파기 범위·방법)." };
  }

  const db = createServiceClient()!;
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "delete",
      targetType: "retention",
      targetId: id,
      summary: "개인정보 파기 완료 기록",
      category: "privacy",
      reason: note,
    },
    async () => {
      const { data: updated, error } = await db
        .from("retention_records")
        .update({
          destroyed_at: new Date().toISOString(),
          destroyed_by: session.email,
          destroyed_note: note,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", session.tenantId)
        .eq("id", id)
        .is("hold_at", null)
        .is("destroyed_at", null)
        .select("id");
      if (error) {
        console.error("[privacy] 파기 기록 실패", error);
        return { ok: false as const, error: "파기 기록에 실패했습니다." };
      }
      if (!updated || updated.length === 0) {
        return {
          ok: false as const,
          error:
            "보존 잠금 중이거나 이미 파기 기록이 있는 항목입니다. 잠금을 먼저 해제해 주세요.",
        };
      }
      return { ok: true as const };
    },
  );

  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/admin/privacy");
  return { ok: true };
}
