"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { runCritical } from "@/lib/data/activity";
import { isUuid } from "@/lib/uuid";
import { erasureObject } from "@/lib/privacy/erasure-storage";
import { recomputeRetention } from "@/lib/privacy/retention";
import type { CrmActionResult } from "@/components/admin/crm/types";

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

const ERASURE_ERRORS: Record<string, string> = {
  held: "보존 잠금 중인 관련 기록이 있습니다. 잠금 근거를 먼저 확인해 주세요.",
  not_due: "보존기한이 아직 남아 있습니다.",
  active: "진행 중인 수업·신청·업무 또는 더 최근의 기록이 있습니다. 기산일과 종료 상태를 확인해 주세요.",
  related_retention: "관련 계약·거래의 보존기한이 남아 있거나 보존 잠금 중입니다.",
  shared_file: "다른 기록에서 사용하는 첨부파일이 있습니다. 파일 연결을 먼저 확인해 주세요.",
  source_missing: "원본을 찾을 수 없습니다. 이미 삭제된 자료인지 확인해 주세요.",
  completed: "이미 완료된 항목입니다.",
};

export async function executeRetentionErasure(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  const db = createServiceClient();
  if (!session || !db) return { ok: false, error: "인증과 데이터 연결을 확인해 주세요." };
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id) || formData.get("confirmation") !== "파기") return { ok: false, error: "확인란에 ‘파기’를 입력해 주세요." };
  const result = await runCritical({ tenantId: session.tenantId, actorEmail: session.email, action: "delete",
    targetType: "retention", targetId: id, summary: "개인정보 원본·첨부파일 파기 실행", category: "privacy" }, async () => {
    const { data, error } = await db.rpc("begin_retention_erasure", { p_tenant: session.tenantId, p_id: id, p_actor: session.email });
    if (error || !data?.ok) return { ok: false as const, error: ERASURE_ERRORS[data?.reason] ?? "원본 삭제를 완료하지 못했습니다. 데이터는 이번 작업 전 상태로 유지됩니다." };
    const { data: job, error: jobError } = await db.from("privacy_erasure_jobs").select("files,storage_completed_at")
      .eq("tenant_id", session.tenantId).eq("retention_id", id).single();
    if (jobError || !job) return { ok: false as const, error: "원본 삭제 후 파일 목록을 읽지 못했습니다. 파일 삭제를 다시 시도해 주세요." };
    if (job.storage_completed_at) return { ok: true as const };
    let external = 0;
    for (const file of job.files as { bucket: string; location: string }[]) {
      const object = erasureObject(file.bucket, file.location, session.tenantId, process.env.SUPABASE_URL!);
      if (object.kind === "invalid") return { ok: false as const, error: "원본은 삭제했지만 첨부파일 경로를 확인하지 못했습니다. 파일 목록을 점검한 뒤 재시도해 주세요." };
      if (object.kind === "external") { external++; continue; }
      // Supabase remove is idempotent: a retry after a partial failure also removes absent objects.
      const { error: storageError } = await db.storage.from(object.bucket).remove([object.path]);
      if (storageError) return { ok: false as const, error: "원본 삭제는 끝났지만 첨부파일 삭제가 실패했습니다. 파일 삭제를 다시 시도해 주세요." };
    }
    const { error: saved } = await db.from("privacy_erasure_jobs")
      .update({ storage_completed_at: new Date().toISOString(), external_file_count: external })
      .eq("tenant_id", session.tenantId).eq("retention_id", id);
    return saved ? { ok: false as const, error: "파일 처리 상태 저장에 실패했습니다. 다시 시도해 주세요." } : { ok: true as const };
  });
  revalidatePath("/admin", "layout");
  revalidatePath("/", "layout");
  return result;
}

/** Completion is now backed by the database job; old clients cannot bypass deletion. */
export async function recordRetentionDestruction(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  const db = createServiceClient();
  if (!session || !db) return { ok: false, error: "인증과 데이터 연결을 확인해 주세요." };
  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!isUuid(id) || formData.get("externalChecked") !== "on" || note.length < 10 || note.length > 2000) {
    return { ok: false, error: "외부 서비스·백업 확인을 체크하고 처리 근거를 10~2,000자로 남겨 주세요." };
  }
  const result = await runCritical({ tenantId: session.tenantId, actorEmail: session.email, action: "delete",
    targetType: "retention", targetId: id, summary: "개인정보 외부 보관 확인 및 파기 완료", category: "privacy", reason: note }, async () => {
    const { data, error } = await db.rpc("finish_retention_erasure", { p_tenant: session.tenantId, p_id: id, p_actor: session.email, p_note: note });
    return error || !data?.ok ? { ok: false as const, error: "원본·파일 삭제가 끝나지 않았거나 보존 잠금 중입니다. 처리 상태를 확인해 주세요." } : { ok: true as const };
  });
  revalidatePath("/admin/privacy");
  return result;
}
