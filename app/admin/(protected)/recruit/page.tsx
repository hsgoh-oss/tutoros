import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { formatKDate, formatKDateTime, hasDb, listConsultations } from "@/lib/data/crm";
import { createServiceClient } from "@/lib/supabase/server";
import { listBackups } from "@/lib/data/backup";
import { getSeatAvailability, listWaitlistOffers } from "@/lib/data/intake";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { ActionButton } from "@/components/admin/crm/action-button";
import type { RecruitState, RecruitStatus, WaitlistOfferStatus } from "@/lib/types";
import {
  acceptWaitlistOffer,
  declineWaitlistOffer,
  expireWaitlistOffer,
  offerWaitlistSeat,
  restoreRecruitBackup,
  saveRecruitStatus,
} from "./actions";

// 모집 정원·접수 상태 운영(O-04)과 대기 자리 제안(C-06)의 운영 화면.
// 정본: docs/flow-canon/01_atlas_01_intake.md O-04·C-06 · 03_scenarios_133.md 검수 61·62·63.
//
// 이 화면이 하지 않는 것:
//  · 남은 자리가 0이 돼도 모집 상태를 자동으로 바꾸지 않는다 — 경고만 띄우고 확정은 운영자 몫.
//  · 거절·만료로 자리가 반환돼도 다음 대기자에게 자동으로 넘기지 않는다(검수 62 — 운영자 판단).
//  · 정원을 줄여도 기존 활성 등록·유효한 제안을 정리하지 않는다(검수 63 — 새 제안만 중단).

interface RecruitStatusRow {
  status: RecruitState;
  message: string;
  seat_count: number | null;
  is_banner_visible: boolean;
}

async function fetchRecruit(tenantId: string): Promise<RecruitStatus | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data } = await db
    .from("recruit_status")
    .select("status,message,seat_count,is_banner_visible")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  const row = data as RecruitStatusRow;
  return {
    status: row.status,
    message: row.message,
    seatCount: row.seat_count,
    isBannerVisible: row.is_banner_visible,
  };
}

const STATUS_OPTIONS: { value: RecruitState; label: string }[] = [
  { value: "open", label: "모집 중" },
  { value: "closing", label: "마감 임박" },
  { value: "waitlist", label: "대기 접수" },
  { value: "closed", label: "마감" },
];

const OFFER_STATUS_LABEL: Record<WaitlistOfferStatus, string> = {
  offered: "제안 중",
  accepted: "수락",
  declined: "거절",
  expired: "만료",
};

const OFFER_STATUS_TONE: Record<
  WaitlistOfferStatus,
  "brand" | "soft" | "success" | "warning" | "danger"
> = {
  offered: "brand",
  accepted: "success",
  declined: "soft",
  expired: "warning",
};

/** 아직 비어 있는 가장 작은 자리 번호 — 입력 기본값 제안용(확정은 운영자가 한다). */
function suggestSeatNo(taken: number[]): number {
  const used = new Set(taken);
  let n = 1;
  while (used.has(n)) n += 1;
  return n;
}

/** 정원 산정 한 칸 — 숫자와 무슨 숫자인지를 함께 보여준다. */
function SeatStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-panel border border-line px-4 py-3">
      <p className="text-xs font-bold text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export default async function RecruitPage() {
  const session = await getAdminSession();
  const connected = hasDb();
  const recruit = session ? await fetchRecruit(session.tenantId) : null;
  const backups = session
    ? await listBackups(session.tenantId, "recruit_status")
    : [];

  // 정원 산정(O-04) — seat_count 대비 활성 등록 + 열린 자리 제안.
  const seats = session ? await getSeatAvailability(session.tenantId) : null;
  const offers = session ? await listWaitlistOffers(session.tenantId) : [];
  // 대기명단 = 보류(hold) 상담(C-05 "정원 대기 → 대기명단").
  const waiting = session
    ? await listConsultations(session.tenantId, { status: "hold" })
    : [];

  const openOfferConsultationIds = new Set(
    offers.filter((o) => o.status === "offered").map((o) => o.consultationId),
  );
  // 이미 열린 제안이 있는 대기자는 선택지에서 뺀다 — 한 사람에게 두 자리를 동시에 묶지 않는다.
  const offerable = waiting.filter((c) => !openOfferConsultationIds.has(c.id));

  // 사용 중인 자리 번호 = 제안 중 + 수락(예약된 자리). 수락분은 DB 부분 유니크의 대상이 아니라
  // 액션이 막으므로, 번호 제안 단계에서 미리 비켜 간다(검수 61 — 한 자리 한 사람).
  const takenSeatNos = offers
    .filter((o) => (o.status === "offered" || o.status === "accepted") && o.seatNo !== null)
    .map((o) => o.seatNo as number)
    .sort((a, b) => a - b);

  const seatCount = seats?.seatCount ?? null;
  const remaining = seats?.remainingSeats ?? null;
  const seatsFull = seatCount !== null && remaining === 0;
  const overbooked = seats?.overbooked ?? false;
  const overdueOffers = seats?.overdueOffers ?? 0;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">모집 현황</h1>
        <p className="mt-1 text-sm text-muted">
          공개 배너 문구와 접수 상태를 관리하고, 남은 자리를 확인해 대기자에게 자리를 제안합니다.
        </p>
      </div>

      {!connected && <DbBanner />}

      {/* ① 정원 산정 — 남은 자리 = 정원 − 활성 등록 − 열린 제안(O-04) */}
      <Card className="mb-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight">정원 산정</h2>
          <span className="text-xs text-muted">
            남은 자리 = 모집 인원 − 활성 등록 − 열린 자리 제안
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <SeatStat
            label="모집 인원"
            value={seatCount === null ? "미설정" : `${seatCount}명`}
            hint={seatCount === null ? "아래에서 인원을 지정하면 산정합니다" : undefined}
          />
          <SeatStat label="활성 등록" value={`${seats?.activeEnrollments ?? 0}명`} hint="등록 활성 상태" />
          <SeatStat
            label="열린 자리 제안"
            value={`${seats?.openOffers ?? 0}건`}
            hint={overdueOffers > 0 ? `기한 경과 ${overdueOffers}건` : "회신 대기 중"}
          />
          <SeatStat
            label="남은 자리"
            value={remaining === null ? "—" : `${remaining}자리`}
            hint={remaining === null ? "정원 미설정" : undefined}
          />
        </div>

        {/* 경고만 띄운다 — 정원 도달·초과가 모집 상태를 자동으로 바꾸지 않는다(자동 판정 금지). */}
        {overbooked && (
          <p className="mt-4 rounded-panel border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
            정원 초과 — 활성 등록과 열린 제안의 합이 모집 인원을 넘습니다. 기존 등록·유효한 자리 제안은
            자동으로 취소하지 않았습니다(검수 63). 새 자리 제안만 중단되며, 정원을 조정하거나 열린 제안을
            개별 확인해 주세요.
          </p>
        )}
        {!overbooked && seatsFull && (
          <p className="mt-4 rounded-panel border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
            정원 도달 — 남은 자리가 없습니다. 접수 상태는 자동으로 바뀌지 않았습니다. 아래에서
            &lsquo;대기 접수&rsquo; 또는 &lsquo;마감&rsquo;으로 바꿀지 직접 결정해 주세요.
          </p>
        )}
        {seatCount === null && (
          <p className="mt-4 rounded-panel border border-line bg-soft px-4 py-3 text-sm text-ink-soft">
            모집 인원이 설정되지 않아 남은 자리를 계산하지 않습니다. 인원을 지정하면 활성 등록·열린 제안을
            빼고 남은 자리를 산정합니다.
          </p>
        )}
        {overdueOffers > 0 && (
          <p className="mt-3 text-sm text-muted">
            회신 기한이 지난 제안이 {overdueOffers}건 있습니다. 만료를 확정하면 그 자리가 반환됩니다 —
            자동으로 만료시키거나 다음 대기자에게 넘기지 않습니다.
          </p>
        )}
      </Card>

      {/* ② 공개 모집 상태 — 저장은 recruit_status만 바꾼다(등록·제안 불변, 검수 63) */}
      <Card>
        <h2 className="mb-4 text-sm font-semibold tracking-tight">공개 모집 상태</h2>
        <SubmitForm action={saveRecruitStatus} submitLabel="저장">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="모집 상태" required>
              <Select name="status" defaultValue={recruit?.status ?? "open"}>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="모집 인원"
              hint="남은 자리 산정 기준. 비워두면 인원 표시 없이 문구만 노출됩니다"
            >
              <Input
                type="number"
                name="seatCount"
                min={0}
                defaultValue={recruit?.seatCount ?? ""}
              />
            </Field>
          </div>

          {/* 비워 두는 것이 기본이다. 손으로 쓴 문구는 매달 손으로 고쳐야 하고, 그래서 늦는다
              (실제로 8월 말까지 "7월 … 모집 중"이 홈 최상단에 떠 있었다).
              생성 규칙은 components/public/recruit-banner.tsx 의 recruitMessage. */}
          <Field
            label="안내 문구"
            hint="비워 두면 상태와 정원으로 이번 달 문구를 자동 생성합니다(예: 2026년 8월 신규 수강생 2명 모집 중). 직접 쓰면 그 문구가 우선합니다."
            className="mt-5"
          >
            <Textarea
              name="message"
              defaultValue={recruit?.message ?? ""}
              placeholder="비워 두면 자동 생성"
            />
          </Field>

          {/* O-04 — 이미 쓰이고 있는 자리보다 적게 줄이면 저장이 보류된다. 확인 후에도 줄이려면
              이 체크가 필요하다(강행해도 기존 등록·제안은 취소되지 않는다 — 검수 63). */}
          <label className="mt-5 flex items-center gap-3">
            <input
              type="checkbox"
              name="forceShrink"
              className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-200"
            />
            <span className="text-sm font-bold text-ink-soft">
              정원 축소 강행 (기존 등록·제안은 그대로 유지됩니다)
            </span>
          </label>

          <label className="mt-5 flex items-center gap-3">
            <input
              type="checkbox"
              name="isBannerVisible"
              defaultChecked={recruit?.isBannerVisible ?? false}
              className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-200"
            />
            <span className="text-sm font-bold text-ink-soft">
              공개 사이트에 모집 배너 노출
            </span>
          </label>

          <p className="mt-4 text-xs text-muted">
            &lsquo;마감&rsquo;은 공개 상담 접수를 막고, &lsquo;대기 접수&rsquo;는 접수를 계속 받되 대기
            신청(보류)으로 적재합니다. 인원을 줄여도 기존 등록·자리 제안은 취소되지 않습니다.
          </p>
        </SubmitForm>
      </Card>

      {/* ③ 대기 자리 제안 — 한 자리에 한 사람만(검수 61) */}
      <Card className="mt-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight">대기 자리 제안</h2>
          <span className="text-xs text-muted">대기 중(보류) 상담 {waiting.length}명</span>
        </div>

        {overbooked || seatsFull ? (
          <p className="rounded-panel border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
            남은 자리가 없어 새 자리 제안을 중단했습니다. 이미 나간 제안과 활성 등록은 그대로
            유지됩니다(검수 63) — 정원을 조정하거나 열린 제안을 마무리한 뒤 다시 제안해 주세요.
          </p>
        ) : waiting.length === 0 ? (
          <p className="text-sm text-muted">
            대기 중인 상담이 없습니다. 상담 화면에서 상태를 &lsquo;보류&rsquo;로 두면 대기명단에 올라옵니다.
          </p>
        ) : offerable.length === 0 ? (
          <p className="text-sm text-muted">
            대기 중인 모든 상담에 이미 열린 제안이 있습니다. 아래 목록에서 회신을 처리한 뒤 다음
            대기자에게 제안해 주세요.
          </p>
        ) : (
          <SubmitForm action={offerWaitlistSeat} submitLabel="자리 제안 보내기">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="대기자"
                required
                className="sm:col-span-2"
                hint="한 자리에 한 사람에게만 제안합니다. 순서는 참고일 뿐 자동 확정하지 않습니다"
              >
                <Select name="consultationId" defaultValue="">
                  <option value="" disabled>
                    대기자를 선택하세요
                  </option>
                  {offerable.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.phone} · 접수 {formatKDate(c.createdAt)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="자리 번호"
                required
                hint={
                  takenSeatNos.length > 0
                    ? `사용 중인 번호(제안 중·수락): ${takenSeatNos.join(", ")}`
                    : "같은 번호로 동시에 두 사람에게 제안할 수 없습니다"
                }
              >
                <Input
                  type="number"
                  name="seatNo"
                  min={1}
                  defaultValue={suggestSeatNo(takenSeatNos)}
                />
              </Field>
              <Field label="회신 기한(일)" required hint="1~30일. 기한이 지나면 만료 확정으로 자리를 반환합니다">
                <Input type="number" name="expiresInDays" min={1} max={30} defaultValue={3} />
              </Field>
            </div>
          </SubmitForm>
        )}
      </Card>

      {/* ④ 제안 이력 — 거절·만료는 자리 반환, 다음 대기자 선정은 운영자 판단(검수 62) */}
      <Card className="mt-8">
        <h2 className="mb-4 text-sm font-semibold tracking-tight">자리 제안 이력</h2>
        {offers.length === 0 ? (
          <p className="text-sm text-muted">아직 보낸 자리 제안이 없습니다.</p>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>대기자</Th>
                  <Th>자리</Th>
                  <Th>제안일</Th>
                  <Th>회신 기한</Th>
                  <Th>상태</Th>
                  <Th>처리</Th>
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => (
                  <tr key={o.id}>
                    <Td>
                      <Link
                        href={`/admin/consultations/${o.consultationId}`}
                        className="font-bold text-ink hover:text-brand-600"
                      >
                        {o.consultationName ?? "(상담 없음)"}
                      </Link>
                      {o.consultationPhone && (
                        <span className="ml-2 text-xs text-muted">{o.consultationPhone}</span>
                      )}
                    </Td>
                    <Td>{o.seatNo === null ? "번호 없음" : `${o.seatNo}번`}</Td>
                    <Td>{formatKDateTime(o.offeredAt)}</Td>
                    <Td>
                      {formatKDateTime(o.expiresAt)}
                      {o.isOverdue && (
                        <Badge tone="warning" className="ml-2">
                          기한 경과
                        </Badge>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={OFFER_STATUS_TONE[o.status]}>
                        {OFFER_STATUS_LABEL[o.status]}
                      </Badge>
                    </Td>
                    <Td>
                      {o.status === "offered" ? (
                        <div className="flex flex-wrap items-center gap-3">
                          <ActionButton
                            action={acceptWaitlistOffer}
                            id={o.id}
                            label="수락"
                            confirmText="이 대기자가 자리를 수락한 것으로 기록합니다. 계속할까요?"
                          />
                          <ActionButton
                            action={declineWaitlistOffer}
                            id={o.id}
                            label="거절"
                            tone="danger"
                            confirmText="거절로 기록하면 이 자리가 반환됩니다(다음 대기자는 자동으로 정해지지 않습니다). 계속할까요?"
                          />
                          {o.isOverdue && (
                            <ActionButton
                              action={expireWaitlistOffer}
                              id={o.id}
                              label="만료 확정"
                              tone="danger"
                              confirmText="기한 경과로 제안을 종료하고 자리를 반환합니다. 계속할까요?"
                            />
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted">
                          {o.respondedAt ? `${formatKDateTime(o.respondedAt)} 처리` : "종료됨"}
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <Card className="mt-8">
        <h2 className="mb-4 text-sm font-semibold tracking-tight">백업 복원</h2>
        {backups.length === 0 ? (
          <p className="text-sm text-muted">백업 이력이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {backups.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line px-4 py-3"
              >
                <span className="text-sm text-ink-soft">
                  {formatKDateTime(b.createdAt)} 시점
                </span>
                <ActionButton
                  action={restoreRecruitBackup}
                  id={b.id}
                  label="이 시점으로 복원"
                  tone="danger"
                  confirmText="현재 모집 현황을 이 백업 시점으로 되돌립니다. 계속할까요?"
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
