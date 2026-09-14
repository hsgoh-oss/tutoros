import { AdminPageHeader } from "@/components/admin/page-header";
import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { hasDb, formatKDate, formatKDateTime } from "@/lib/data/crm";
import { listBackups } from "@/lib/data/backup";
import { listReviewInvitations, listReviewRecords, type ReviewRecord } from "@/lib/data/reviews";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import { cn } from "@/lib/cn";
import { Toolbar } from "@/components/admin/crm/toolbar";
import { ActionButton } from "@/components/admin/crm/action-button";
import {
  REVIEW_FILTERS,
  reviewKindLabel,
  reviewStatusLabel,
  reviewStatusTone,
  reviewerTypeLabel,
} from "./constants";
import { InvitationList } from "./invitation-list";
import {
  moveReviewDown,
  moveReviewUp,
  publishReview,
  restoreReviewsBackup,
  startReview,
  togglePinReview,
} from "./actions";

// 후기·사례 관리 목록 — 운영자가 할 수 있는 일은 상태 전환뿐이다(작성·수정 없음 — S-01·S-03).
// 각 행에는 "지금 할 다음 행동" 하나만 둔다. 판단이 필요한 전환(승인·반려·수정 요청·마스킹 확인·철회)은
// 상세 화면으로 보낸다 — 본문을 읽지 않고 목록에서 누르는 승인은 검토가 아니다.

function NextAction({ review }: { review: ReviewRecord }) {
  const detail = `/admin/reviews/${review.id}`;
  switch (review.status) {
    case "draft":
    case "submitted":
      return <ActionButton action={startReview} id={review.id} label="검토 시작" />;
    case "in_review":
      return (
        <Link href={detail} className="text-xs font-bold text-brand-700 hover:underline">
          검토하기 →
        </Link>
      );
    case "approved":
      return review.maskingConfirmedAt ? (
        <ActionButton
          action={publishReview}
          id={review.id}
          label="게시"
          confirmText="이 건을 공개 사이트에 게시할까요? 이미지 공개 동의가 있으면 공개 사본이 생성됩니다."
        />
      ) : (
        <Link href={detail} className="text-xs font-bold text-brand-700 hover:underline">
          마스킹·최소정보 확인 →
        </Link>
      );
    case "published":
      return (
        <Link href={detail} className="text-xs font-medium text-muted hover:text-rose-600 hover:underline">
          철회(사유 입력) →
        </Link>
      );
    case "revision_requested":
      return <span className="text-xs text-muted">작성자 재제출 대기</span>;
    default:
      return <span className="text-xs text-muted">-</span>;
  }
}

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const session = await getAdminSession();
  const connected = hasDb();

  const filter = REVIEW_FILTERS.find((f) => f.value === status) ?? REVIEW_FILTERS[0];
  const [reviews, invitations, backups] = session
    ? await Promise.all([
        listReviewRecords(session.tenantId, filter.statuses ? { status: filter.statuses } : {}),
        listReviewInvitations(session.tenantId, { status: "sent" }),
        listBackups(session.tenantId, "reviews"),
      ])
    : [[], [], []];

  return (
    <div className="dash-page">
      <AdminPageHeader>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">후기·사례 관리</h1>
          <p className="mt-1 text-sm text-muted">
            작성자가 링크로 제출한 후기·성적 향상 사례를 검토·게시·철회합니다. 본문은 여기서 고칠 수
            없고, 고쳐야 하면 작성자에게 수정 요청을 보냅니다.
          </p>
        </div>
        <Link href="/admin/reviews/invite" className={buttonClass("primary", "sm")}>
          작성 초대 보내기
        </Link>
      </AdminPageHeader>

      {!connected && <DbBanner />}

      <Toolbar>
        {/* 상태 묶음 칩 — 기본(링크 없음)은 '검토 대기'다. 공용 FilterChips는 기본 칩을 '전체'로 고정해
            두 뜻이 충돌하므로 같은 모양의 링크를 직접 그린다. */}
        <div className="flex flex-wrap gap-2">
          {REVIEW_FILTERS.map((f) => {
            const active = f.value === filter.value;
            return (
              <Link
                key={f.value}
                href={f.value === "open" ? "/admin/reviews" : `/admin/reviews?status=${f.value}`}
                className={cn(
                  "inline-flex min-h-[var(--ui-h-sm)] items-center rounded-[var(--radius-control)] border px-3.5 text-xs [font-weight:var(--ui-w-label)] tracking-tight transition-colors",
                  active
                    ? "border-brand-600 bg-brand-50 text-brand-700"
                    : "border-line bg-white text-ink-soft hover:border-brand-200",
                )}
              >
                {f.label}
              </Link>
            );
          })}
        </div>
      </Toolbar>

      {reviews.length === 0 ? (
        <EmptyState
          title={filter.value === "open" ? "검토 대기 중인 건이 없습니다" : "해당 상태의 건이 없습니다"}
          description="작성 초대를 보내면 작성자가 제출한 건이 여기에 쌓입니다."
          action={
            <Link href="/admin/reviews/invite" className={buttonClass("outline", "sm")}>
              작성 초대 보내기
            </Link>
          }
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>종류</Th>
                <Th>학생(공개명)</Th>
                <Th>작성자</Th>
                <Th>상태</Th>
                <Th>평점 · 등급 변화</Th>
                <Th>제출일</Th>
                <Th>다음 행동</Th>
                <Th>고정</Th>
                <Th>순서</Th>
              </tr>
            </thead>
            <tbody>
              {reviews.map((r, i) => (
                <tr key={r.id}>
                  <Td>
                    <Link href={`/admin/reviews/${r.id}`} className="font-bold text-ink hover:text-brand-600">
                      {reviewKindLabel(r.kind)}
                    </Link>
                    {r.isPinned && (
                      <Badge tone="brand" className="ml-2">
                        고정
                      </Badge>
                    )}
                  </Td>
                  <Td>{r.publicName ?? <span className="text-muted">(마스킹 없음)</span>}</Td>
                  <Td>
                    {reviewerTypeLabel(r.reviewerType)}
                    {r.isMinor && (
                      <Badge tone="warning" className="ml-2">
                        미성년
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={reviewStatusTone(r.status)}>{reviewStatusLabel(r.status)}</Badge>
                  </Td>
                  <Td>
                    {r.kind === "case" ? (
                      <>
                        {r.beforeGrade ?? "-"} → {r.afterGrade ?? "-"}
                      </>
                    ) : (
                      <>
                        {r.rating}점
                        {r.beforeGrade && r.afterGrade && (
                          <span className="ml-1 text-muted">
                            ({r.beforeGrade} → {r.afterGrade})
                          </span>
                        )}
                      </>
                    )}
                  </Td>
                  <Td>{formatKDate(r.submittedAt ?? r.createdAt)}</Td>
                  <Td>
                    <NextAction review={r} />
                  </Td>
                  <Td>
                    {r.status === "published" || r.isPinned ? (
                      <ActionButton
                        action={togglePinReview}
                        id={r.id}
                        label={r.isPinned ? "고정 해제" : "고정"}
                      />
                    ) : (
                      <span className="text-xs text-muted">-</span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-3">
                      <ActionButton
                        action={moveReviewUp}
                        id={r.id}
                        label="위로"
                        className={i === 0 ? "pointer-events-none opacity-30" : undefined}
                      />
                      <ActionButton
                        action={moveReviewDown}
                        id={r.id}
                        label="아래로"
                        className={i === reviews.length - 1 ? "pointer-events-none opacity-30" : undefined}
                      />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}

      <Card className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink-soft">열린 작성 초대</h2>
          <Badge tone={invitations.length > 0 ? "brand" : "soft"}>{invitations.length}건</Badge>
        </div>
        <InvitationList
          invitations={invitations}
          emptyText="열려 있는 작성 초대가 없습니다. 위 '작성 초대 보내기'로 발급합니다."
        />
      </Card>

      {backups.length > 0 && (
        <Card className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-ink-soft">백업 이력 (최근 12개)</h2>
          <ul className="space-y-2">
            {backups.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between border-b border-line pb-2 last:border-0 last:pb-0"
              >
                <span className="text-sm text-muted">{formatKDateTime(b.createdAt)}</span>
                <ActionButton
                  action={restoreReviewsBackup}
                  id={b.id}
                  label="이 시점으로 복원"
                  confirmText="현재 후기 전체가 이 백업 시점으로 교체됩니다. 계속하시겠습니까?"
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
