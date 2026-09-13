"use client";

import { Badge } from "@/components/ui/badge";
import type { ReviewInvitation } from "@/lib/types";
import { ReviewInviteForm } from "../reviews/invite-form";
import { InvitationList } from "../reviews/invitation-list";

// 학생 상세의 「후기·사례 작성 초대」 카드 — S-01 "운영자 확인 → 작성 초대 발급 → 전달".
// 학생이 정해져 있으므로 이름·보호자 연락처를 미리 채우고, 이 학생에게 보낸 초대 이력을 함께 보여 준다.
// 발급·재발급·닫기의 실제 판정은 app/admin/(protected)/reviews/actions.ts에 있다.

export function ReviewInviteCard({
  studentId,
  studentName,
  parentPhone,
  studentPhone,
  invitations,
}: {
  studentId: string;
  studentName: string;
  parentPhone: string;
  studentPhone: string | null;
  invitations: ReviewInvitation[];
}) {
  const open = invitations.filter((i) => i.status === "sent");
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-soft">후기·사례 작성 초대</h2>
        {open.length > 0 ? <Badge tone="brand">링크 {open.length}건 열림</Badge> : <Badge tone="soft">열린 링크 없음</Badge>}
      </div>
      <p className="mb-4 text-xs leading-relaxed text-muted">
        작성 링크를 알림톡으로 보냅니다. 작성자가 후기 또는 성적 향상 사례를 골라 쓰고 공개 동의를
        건별로 선택하며, 제출본은 후기·사례 관리에서 검토한 뒤에만 게시됩니다.
      </p>
      <ReviewInviteForm
        compact
        fixedStudent={{ id: studentId, name: studentName, parentPhone, studentPhone }}
      />
      <div className="mt-5 border-t border-line pt-4">
        <h3 className="mb-3 text-xs font-semibold text-ink-soft">발급 이력</h3>
        <InvitationList invitations={invitations} showStudent={false} />
      </div>
    </div>
  );
}
