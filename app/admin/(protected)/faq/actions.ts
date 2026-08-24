"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { getBackup, recordBackup } from "@/lib/data/backup";
import { logActivity, runCritical } from "@/lib/data/activity";
import type { CrmActionResult } from "@/components/admin/crm/types";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";
const BACKUP_TARGET = "faqs";

function revalidateFaqs() {
  revalidatePath("/admin/faq");
  revalidatePath("/faq");
  revalidatePath("/");
}

async function backupFaqs(db: SupabaseClient, tenantId: string): Promise<void> {
  const { data } = await db.from("faqs").select("*").eq("tenant_id", tenantId);
  await recordBackup(tenantId, BACKUP_TARGET, data ?? []);
}

interface FaqFormPayload {
  category: string;
  question: string;
  answer: string;
}

function parseFaqForm(formData: FormData): FaqFormPayload | { error: string } {
  const question = String(formData.get("question") ?? "").trim();
  const answer = String(formData.get("answer") ?? "").trim();
  if (!question) return { error: "질문을 입력해 주세요." };
  if (!answer) return { error: "답변을 입력해 주세요." };
  const category = String(formData.get("category") ?? "").trim() || "일반";
  return { category, question, answer };
}

export async function createFaq(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const parsed = parseFaqForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const db = createServiceClient()!;
  const { count } = await db
    .from("faqs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", session.tenantId);

  await backupFaqs(db, session.tenantId);

  const { error } = await db.from("faqs").insert({
    tenant_id: session.tenantId,
    category: parsed.category,
    question: parsed.question,
    answer: parsed.answer,
    sort_order: count ?? 0,
  });
  if (error) {
    console.error("[faq] insert failed", error);
    return { ok: false, error: "FAQ 등록 중 오류가 발생했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "create",
    "faq",
    null,
    `FAQ 등록 (${parsed.category})`,
  );

  revalidateFaqs();
  return { ok: true };
}

export async function updateFaq(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  const parsed = parseFaqForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const db = createServiceClient()!;
  await backupFaqs(db, session.tenantId);

  const { error } = await db
    .from("faqs")
    .update({
      category: parsed.category,
      question: parsed.question,
      answer: parsed.answer,
    })
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[faq] update failed", error);
    return { ok: false, error: "FAQ 수정 중 오류가 발생했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "update",
    "faq",
    id,
    `FAQ 수정 (${parsed.category})`,
  );

  revalidateFaqs();
  revalidatePath(`/admin/faq/${id}`);
  return { ok: true };
}

export async function deleteFaq(id: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  await backupFaqs(db, session.tenantId);

  const { error } = await db
    .from("faqs")
    .delete()
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[faq] delete failed", error);
    return { ok: false, error: "FAQ 삭제 중 오류가 발생했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "delete",
    "faq",
    id,
    "FAQ 삭제",
  );

  revalidateFaqs();
  return { ok: true };
}

async function moveFaq(id: string, direction: "up" | "down"): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const db = createServiceClient()!;
  const { data: rows, error: listError } = await db
    .from("faqs")
    .select("id,sort_order")
    .eq("tenant_id", session.tenantId)
    .order("sort_order", { ascending: true });
  if (listError || !rows) {
    console.error("[faq] fetch order failed", listError);
    return { ok: false, error: "정렬 순서를 불러오지 못했습니다." };
  }

  const index = rows.findIndex((r: { id: string }) => r.id === id);
  if (index === -1) return { ok: false, error: "FAQ를 찾을 수 없습니다." };
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= rows.length) {
    return {
      ok: false,
      error: direction === "up" ? "이미 첫 번째 항목입니다." : "이미 마지막 항목입니다.",
    };
  }

  const current = rows[index] as { id: string; sort_order: number };
  const target = rows[targetIndex] as { id: string; sort_order: number };

  await backupFaqs(db, session.tenantId);

  const [{ error: error1 }, { error: error2 }] = await Promise.all([
    db
      .from("faqs")
      .update({ sort_order: target.sort_order })
      .eq("tenant_id", session.tenantId)
      .eq("id", current.id),
    db
      .from("faqs")
      .update({ sort_order: current.sort_order })
      .eq("tenant_id", session.tenantId)
      .eq("id", target.id),
  ]);
  if (error1 || error2) {
    console.error("[faq] move failed", error1 ?? error2);
    return { ok: false, error: "순서 변경 중 오류가 발생했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "update",
    "faq",
    id,
    `FAQ 순서 변경 (${direction === "up" ? "위로" : "아래로"})`,
  );

  revalidateFaqs();
  return { ok: true };
}

export async function moveFaqUp(id: string): Promise<CrmActionResult> {
  return moveFaq(id, "up");
}

export async function moveFaqDown(id: string): Promise<CrmActionResult> {
  return moveFaq(id, "down");
}

interface FaqSnapshotRow {
  id: string;
  tenant_id: string;
  category: string;
  question: string;
  answer: string;
  sort_order: number;
  updated_at: string;
}

export async function restoreFaqsBackup(backupId: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const backup = await getBackup(session.tenantId, backupId);
  if (!backup || backup.target !== BACKUP_TARGET) {
    return { ok: false, error: "백업을 찾을 수 없습니다." };
  }

  const db = createServiceClient()!;
  // snapshot은 jsonb라 내용이 스키마를 보장하지 않는다. service_role은 RLS를 우회하므로
  // 복원 행의 tenant_id를 현재 세션 테넌트로 강제해 타테넌트로 새는 경로를 원천 차단한다.
  const rows = ((backup.snapshot as FaqSnapshotRow[]) ?? []).map((row) => ({
    ...row,
    tenant_id: session.tenantId,
  }));

  // 복원 전 현재 규모를 before_data 요약으로 남긴다(전문 스냅샷은 backups 테이블 몫).
  const { count: currentCount } = await db
    .from("faqs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", session.tenantId);

  // 백업 복원은 게시 데이터 전체 치환 — 감사 선기록(pending) 없이는 실행하지 않는다(fail-closed).
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "restore",
      targetType: "faq",
      targetId: backupId,
      summary: `FAQ 백업 복원 (${rows.length}건)`,
      category: "privacy",
      before: { faq_count: currentCount ?? 0 },
      after: { backup_id: backupId, restored_count: rows.length },
    },
    async () => {
      const { error: deleteError } = await db
        .from("faqs")
        .delete()
        .eq("tenant_id", session.tenantId);
      if (deleteError) {
        console.error("[faq] restore delete failed", deleteError);
        return { ok: false, error: "복원 중 오류가 발생했습니다." };
      }
      if (rows.length > 0) {
        const { error: insertError } = await db.from("faqs").insert(rows);
        if (insertError) {
          console.error("[faq] restore insert failed", insertError);
          return { ok: false, error: "복원 중 오류가 발생했습니다." };
        }
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  revalidateFaqs();
  return result;
}
