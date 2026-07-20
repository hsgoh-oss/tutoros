import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { hasDb, listReviews, formatKDate, formatKDateTime } from "@/lib/data/crm";
import { listBackups } from "@/lib/data/backup";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import { ActionButton } from "@/components/admin/crm/action-button";
import { reviewerTypeLabel } from "./constants";
import {
  deleteReview,
  moveReviewDown,
  moveReviewUp,
  restoreReviewsBackup,
  togglePinReview,
} from "./actions";

export default async function ReviewsPage() {
  const session = await getAdminSession();
  const connected = hasDb();
  const reviews = session ? await listReviews(session.tenantId) : [];
  const backups = session ? await listBackups(session.tenantId, "reviews") : [];

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black tracking-tight">후기 관리</h1>
          <p className="mt-1 text-sm text-muted">
            공개 사이트에 노출되는 학생·학부모 후기를 관리합니다.
          </p>
        </div>
        <Link href="/admin/reviews/new" className={buttonClass("primary", "sm")}>
          신규 등록
        </Link>
      </div>

      {!connected && <DbBanner />}

      {reviews.length === 0 ? (
        <EmptyState
          title="등록된 후기가 없습니다"
          description="신규 등록 버튼으로 후기를 추가할 수 있습니다."
          action={
            <Link href="/admin/reviews/new" className={buttonClass("outline", "sm")}>
              신규 등록
            </Link>
          }
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>유형</Th>
                <Th>평점</Th>
                <Th>성적 변화</Th>
                <Th>지역</Th>
                <Th>출처</Th>
                <Th>일자</Th>
                <Th>고정</Th>
                <Th>순서</Th>
                <Th>삭제</Th>
              </tr>
            </thead>
            <tbody>
              {reviews.map((r, i) => (
                <tr key={r.id}>
                  <Td>
                    <Link
                      href={`/admin/reviews/${r.id}`}
                      className="font-bold text-ink hover:text-brand-600"
                    >
                      {reviewerTypeLabel(r.reviewerType)}
                    </Link>
                    {r.isPinned && (
                      <Badge tone="brand" className="ml-2">
                        고정
                      </Badge>
                    )}
                  </Td>
                  <Td>{r.rating}점</Td>
                  <Td>
                    {r.beforeGrade ?? "-"} → {r.afterGrade ?? "-"}
                  </Td>
                  <Td>{r.region ?? "-"}</Td>
                  <Td>{r.source ?? "-"}</Td>
                  <Td>{formatKDate(r.reviewedAt)}</Td>
                  <Td>
                    <ActionButton
                      action={togglePinReview}
                      id={r.id}
                      label={r.isPinned ? "고정 해제" : "고정"}
                    />
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
                        className={
                          i === reviews.length - 1 ? "pointer-events-none opacity-30" : undefined
                        }
                      />
                    </div>
                  </Td>
                  <Td>
                    <ActionButton
                      action={deleteReview}
                      id={r.id}
                      label="삭제"
                      confirmText="이 후기를 삭제하시겠습니까?"
                      tone="danger"
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}

      {backups.length > 0 && (
        <Card className="mt-8">
          <h2 className="mb-3 text-sm font-black text-ink-soft">백업 이력 (최근 12개)</h2>
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
