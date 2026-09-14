import { AdminPageHeader } from "@/components/admin/page-header";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { formatKDateTime, listConsents } from "@/lib/data/crm";
import { getReviewRecord, listReviewInvitations } from "@/lib/data/reviews";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { consentItemLabel } from "../../consultations/constants";
import { reviewKindLabel, reviewStatusLabel, reviewStatusTone, reviewerTypeLabel } from "../constants";
import { screenshotViewsFor } from "../storage";
import { ReviewActions } from "../review-actions";
import { InvitationList } from "../invitation-list";

// 후기·사례 상세 — 읽기 전용. 운영자는 본문·마스킹 이름을 고칠 수 없다(S-03). 행동은 우측 패널뿐이다.

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 border-b border-line py-2.5 text-sm last:border-0">
      <dt className="font-bold text-ink-soft">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

export default async function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getAdminSession();
  if (!session) notFound();

  const review = await getReviewRecord(session.tenantId, id);
  if (!review) notFound();

  const [screenshotViews, consents, invitations] = await Promise.all([
    screenshotViewsFor(review.screenshots),
    listConsents(session.tenantId, "review", id),
    listReviewInvitations(session.tenantId, { reviewId: id }),
  ]);

  const timeline: { label: string; at: string | null; note?: string | null }[] = [
    { label: "제출", at: review.submittedAt ?? (review.status === "draft" ? review.createdAt : null) },
    { label: "검토 시작", at: review.reviewStartedAt },
    { label: "수정 요청", at: review.revisionRequestedAt, note: review.revisionNote },
    { label: "반려", at: review.rejectedAt, note: review.rejectReason },
    { label: "승인", at: review.approvedAt },
    { label: "마스킹·최소정보 확인", at: review.maskingConfirmedAt, note: review.maskingConfirmedBy },
    { label: "게시", at: review.publishedAt },
    { label: "철회", at: review.retractedAt, note: review.retractReason },
  ].filter((t) => t.at);

  const canRequestRevision = Boolean(
    (review.authorName && review.authorPhone) || review.invitationId,
  );

  return (
    <div className="dash-page">
      <AdminPageHeader>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">
            {reviewKindLabel(review.kind)} 검토
          </h1>
          <Badge tone={reviewStatusTone(review.status)}>{reviewStatusLabel(review.status)}</Badge>
          {review.isMinor && <Badge tone="warning">미성년 — 법정대리인 동의 필요</Badge>}
          {review.isPinned && <Badge tone="brand">고정</Badge>}
        </div>
        <Link href="/admin/reviews" className="inline-flex min-h-11 items-center text-sm font-bold text-muted hover:text-ink">
          ← 목록으로
        </Link>
      </AdminPageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink-soft">공개될 내용</h2>
            <p className="mb-4 text-xs text-muted">
              공개 화면에는 아래 항목만 나갑니다. 본문은 작성자가 쓴 그대로이며 여기서 고칠 수 없습니다.
            </p>
            <dl className="m-0">
              <Row label="공개 이름">
                {review.publicName ?? <span className="text-muted">(마스킹 이름 없음 — 옛 대필 등록분)</span>}
              </Row>
              <Row label="작성자 구분">{reviewerTypeLabel(review.reviewerType)}</Row>
              {(review.grade || review.track) && (
                <Row label="학년 · 계열">
                  {[review.grade, review.track].filter(Boolean).join(" · ")}
                </Row>
              )}
              {review.kind === "review" && <Row label="평점">{review.rating}점</Row>}
              {(review.beforeGrade || review.afterGrade) && (
                <Row label="등급 변화">
                  {review.beforeLabel && <span className="text-muted">{review.beforeLabel} </span>}
                  <b>{review.beforeGrade ?? "-"}</b>
                  <span className="mx-2 text-muted">→</span>
                  {review.afterLabel && <span className="text-muted">{review.afterLabel} </span>}
                  <b>{review.afterGrade ?? "-"}</b>
                </Row>
              )}
              {review.source && <Row label="출처">{review.source}</Row>}
              {review.reviewedAt && <Row label="작성일">{review.reviewedAt}</Row>}
            </dl>
            <div className="mt-4 rounded-panel border border-line bg-soft p-4 text-[15px] leading-[1.8] whitespace-pre-wrap text-ink">
              {review.content}
            </div>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-ink-soft">첨부 이미지(증빙)</h2>
              {review.screenshots.length > 0 && (
                <Badge tone={review.imagesPublic ? "success" : "soft"}>
                  {review.imagesPublic ? "이미지 공개 동의 있음" : "이미지 공개 동의 없음 — 검토 근거로만"}
                </Badge>
              )}
            </div>
            {screenshotViews.length === 0 ? (
              <p className="text-sm text-muted">첨부 이미지가 없습니다.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
                {screenshotViews.map((view) =>
                  view.displayUrl ? (
                    <a key={view.stored} href={view.displayUrl} target="_blank" rel="noreferrer">
                      {/* 비공개 증빙의 만료 서명 URL — next/image remotePatterns 미설정이라 img 사용(관리자 내부 썸네일). */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={view.displayUrl}
                        alt="첨부 이미지"
                        className="h-24 w-full rounded-panel border border-line object-cover"
                      />
                    </a>
                  ) : (
                    <span
                      key={view.stored}
                      className="flex h-24 w-full items-center justify-center rounded-panel border border-line bg-soft text-xs font-bold text-muted"
                    >
                      미리보기 불가
                    </span>
                  ),
                )}
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink-soft">비공개 정보 — 작성자·대상</h2>
            <p className="mb-3 text-xs text-muted">공개 화면에 나가지 않습니다. 연락·관계 확인용입니다.</p>
            <dl className="m-0">
              <Row label="작성자">
                {review.authorName ?? <span className="text-muted">(기록 없음)</span>}
                {review.authorPhone && <span className="ml-2 text-muted">{review.authorPhone}</span>}
              </Row>
              <Row label="대상 학생">
                {review.studentId ? (
                  <Link href={`/admin/students/${review.studentId}`} className="font-bold text-brand-700 hover:underline">
                    학생 상세 보기 →
                  </Link>
                ) : (
                  <span className="text-muted">학생 레코드 연결 없음</span>
                )}
              </Row>
              {review.isMinor && (
                <>
                  <Row label="법정대리인">
                    {review.guardianName ?? "-"}
                    {review.guardianPhone && <span className="ml-2 text-muted">{review.guardianPhone}</span>}
                  </Row>
                  <Row label="대리인 동의 확인">
                    {review.guardianVerifiedAt ? (
                      <span>
                        {formatKDateTime(review.guardianVerifiedAt)} · {review.guardianVerifiedBy}
                      </span>
                    ) : (
                      <span className="font-bold text-amber-700">아직 확인되지 않음 — 승인 뒤 마스킹 확인 단계에서 확인합니다</span>
                    )}
                  </Row>
                </>
              )}
            </dl>
          </Card>

          {invitations.length > 0 && (
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-ink-soft">이 건의 작성 링크(수정 요청)</h2>
              <InvitationList invitations={invitations} showStudent={false} />
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink-soft">다음 행동</h2>
            {review.status === "revision_requested" && (
              <p className="text-sm text-muted">
                작성자에게 수정 요청을 보냈습니다. 재제출되면 다시 제출됨으로 돌아옵니다.
                {review.revisionNote && (
                  <span className="mt-2 block rounded-panel bg-soft px-3 py-2 text-xs">사유: {review.revisionNote}</span>
                )}
              </p>
            )}
            {review.status === "rejected" && (
              <p className="text-sm text-muted">
                반려된 건입니다. 공개되지 않으며 다시 게시하려면 새 제출이 필요합니다.
                {review.rejectReason && (
                  <span className="mt-2 block rounded-panel bg-soft px-3 py-2 text-xs">사유: {review.rejectReason}</span>
                )}
              </p>
            )}
            {review.status === "retracted" && (
              <p className="text-sm text-muted">
                철회된 건입니다. 공개가 중단됐고 행은 철회 증명으로 보존됩니다. 재게시는 새 제출·새 검토로만 가능합니다.
                {review.retractReason && (
                  <span className="mt-2 block rounded-panel bg-soft px-3 py-2 text-xs">사유: {review.retractReason}</span>
                )}
              </p>
            )}
            <ReviewActions
              id={review.id}
              status={review.status}
              publicName={review.publicName}
              hasImages={review.screenshots.length > 0}
              imagesPublic={review.imagesPublic}
              isMinor={review.isMinor}
              maskingConfirmed={Boolean(review.maskingConfirmedAt)}
              canRequestRevision={canRequestRevision}
            />
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink-soft">동의 내역</h2>
            {consents.length === 0 ? (
              <p className="text-sm font-bold text-amber-700">
                기록된 동의가 없습니다 — 공개 동의 없이는 승인되지 않습니다.
              </p>
            ) : (
              <ul className="space-y-2">
                {consents.map((c) => (
                  <li key={c.id} className="border-b border-line pb-2 last:border-0 last:pb-0">
                    <p className="text-sm font-bold">{consentItemLabel(c.item)}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {formatKDateTime(c.consentedAt)} · {c.policyVersion} · {c.via}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink-soft">이력</h2>
            {timeline.length === 0 ? (
              <p className="text-sm text-muted">기록된 전환이 없습니다.</p>
            ) : (
              <ol className="space-y-2">
                {timeline.map((t) => (
                  <li key={t.label} className="border-b border-line pb-2 last:border-0 last:pb-0">
                    <p className="text-sm font-bold">{t.label}</p>
                    <p className="mt-0.5 text-xs text-muted">{formatKDateTime(t.at)}</p>
                    {t.note && <p className="mt-0.5 text-xs text-ink-soft">{t.note}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
