import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { listReviewInvitations } from "@/lib/data/reviews";
import { Card } from "@/components/ui/card";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { ReviewInviteForm, type StudentPrefill } from "../invite-form";
import { InvitationList } from "../invitation-list";

// 작성 초대 보내기 — S-01 "운영자가 대상·작성자 역할·요청 목적·공개범위 확인 → 작성 초대 발급 → 전달".
// 자동 요청은 없다. 크론(reviewRequest)이 올리는 "후기 요청 후보" 업무는 여기서 사람이 닫는다.

async function listStudentPrefills(tenantId: string): Promise<StudentPrefill[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("students")
    .select("id, name, parent_phone, student_phone")
    .eq("tenant_id", tenantId)
    .order("name");
  return ((data ?? []) as { id: string; name: string; parent_phone: string; student_phone: string | null }[]).map(
    (s) => ({ id: s.id, name: s.name, parentPhone: s.parent_phone, studentPhone: s.student_phone }),
  );
}

export default async function ReviewInvitePage() {
  const session = await getAdminSession();
  if (!session) return null;
  const connected = hasDb();

  const [students, recent] = await Promise.all([
    listStudentPrefills(session.tenantId),
    listReviewInvitations(session.tenantId),
  ]);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">후기·사례 작성 초대</h1>
          <p className="mt-1 text-sm text-muted">
            작성 링크를 알림톡(미연결 시 문자)으로 보냅니다. 작성자는 링크에서 후기 또는 성적 향상
            사례를 선택해 작성하고, 공개 동의를 건별로 결정합니다.
          </p>
        </div>
        <Link href="/admin/reviews" className="text-sm font-bold text-muted hover:text-ink">
          ← 후기·사례 관리
        </Link>
      </div>

      {!connected && <DbBanner />}

      <Card className="max-w-3xl">
        <ReviewInviteForm students={students} />
      </Card>

      <Card className="mt-8 max-w-3xl">
        <h2 className="mb-3 text-sm font-semibold text-ink-soft">발급 이력 (최근 20건)</h2>
        <InvitationList invitations={recent.slice(0, 20)} />
      </Card>
    </div>
  );
}
