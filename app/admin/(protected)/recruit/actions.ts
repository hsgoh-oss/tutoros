"use server";

// 모집 정원·접수 상태 운영(O-04) + 대기 자리 제안(C-06) 서버 액션.
//
// 정본: docs/flow-canon/01_atlas_01_intake.md O-04·C-06 · 03_scenarios_133.md 검수 61·62·63.
//
// 이 파일이 지키는 세 가지:
//  · 자동 판정 금지 — 남은 자리가 0이 돼도 공개 모집 상태(recruit_status.status)를 코드가
//    바꾸지 않는다. 화면에 "정원 도달" 경고만 띄우고 상태 확정은 운영자 결정이다(O-04 주 전환).
//  · 한 자리 한 사람(검수 61) — 자리 제안은 00018의 offer_waitlist_seat RPC로만 만든다.
//    같은 자리에 열린 제안이 있으면 부분 유니크(waitlist_offers_one_per_seat)가 떨어뜨리고,
//    RPC가 그 경합을 false로 수렴시킨다. 이 파일은 그 위에 안내 문구만 얹는다.
//  · 자리 반환은 있어도 자동 승계는 없다(검수 62) — 거절·만료 처리는 제안을 닫아 자리를
//    비우는 데서 끝난다. 다음 대기자에게 다시 제안할지는 운영자가 판단한다
//    (C-06 예외 "대기순서만으로 자동 확정하지 않는다"). 자동 재제안 경로를 만들지 않는다.
//
// 검수 63(정원 축소): saveRecruitStatus는 recruit_status 한 테이블만 쓴다 — waitlist_offers·
// enrollments를 읽어 경고를 계산할 뿐 UPDATE·DELETE하지 않는다. 정원을 줄여도 기존 활성
// 등록과 유효한 자리 제안은 그대로 살아 있고, 초과 상태는 경고·운영 업무로만 알린다.

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import { getBackup, recordBackup } from "@/lib/data/backup";
import { logActivity, runCritical } from "@/lib/data/activity";
import { createWorkItem } from "@/lib/data/work";
import { formatKDateTime } from "@/lib/data/crm";
import { getSeatAvailability } from "@/lib/data/intake";
import { hasActiveBookingRestriction } from "@/lib/data/packages";
import { sendNotification } from "@/lib/notify/send";
import { renderTemplate } from "@/lib/notify/templates";
import type { RecruitState } from "@/lib/types";
import type { CrmActionResult } from "@/components/admin/crm/types";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";
const BACKUP_TARGET = "recruit_status";
const VALID_STATUSES: RecruitState[] = ["open", "closing", "waitlist", "closed"];
/** 자리 제안 회신 기한(일) 허용 범위 — "승인된 기간의 자리 제안"(C-06)의 상·하한. */
const MIN_OFFER_DAYS = 1;
const MAX_OFFER_DAYS = 30;

interface RecruitStatusRow {
  status: RecruitState;
  message: string;
  seat_count: number | null;
  is_banner_visible: boolean;
}

function revalidateRecruit() {
  revalidatePath("/admin/recruit");
  revalidatePath("/", "layout"); // 공개 사이트 모집 배너 즉시 반영
}

async function fetchRecruitRow(tenantId: string): Promise<RecruitStatusRow | null> {
  const db = createServiceClient()!;
  const { data } = await db
    .from("recruit_status")
    .select("status,message,seat_count,is_banner_visible")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return (data as RecruitStatusRow | null) ?? null;
}

export async function saveRecruitStatus(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const statusRaw = String(formData.get("status") ?? "open");
  const status: RecruitState = VALID_STATUSES.includes(statusRaw as RecruitState)
    ? (statusRaw as RecruitState)
    : "open";
  const message = String(formData.get("message") ?? "").trim();

  const seatCountRaw = String(formData.get("seatCount") ?? "").trim();
  const seatCount = seatCountRaw ? Number(seatCountRaw) : null;
  if (seatCountRaw && (!Number.isInteger(seatCount) || (seatCount as number) < 0)) {
    return { ok: false, error: "모집 인원은 0 이상의 정수로 입력해 주세요." };
  }

  const isBannerVisible = formData.get("isBannerVisible") === "on";

  const previous = await fetchRecruitRow(session.tenantId);
  await recordBackup(session.tenantId, BACKUP_TARGET, previous);

  // O-04 예외 「예약된 자리보다 적은 정원으로 변경 시도: 변경 보류 → 열린 제안·등록 확인 →
  // 다시 결정」 — 사후 통보가 아니라 저장을 멈춘다. 확인 후에도 줄이려면 강행 체크가 필요하다.
  // (강행하더라도 기존 등록·제안은 건드리지 않는다 — 검수 63.)
  const forceShrink = formData.get("forceShrink") === "on";
  if (seatCount !== null && !forceShrink) {
    const before = await getSeatAvailability(session.tenantId);
    const held =
      before.activeEnrollments + Math.max(0, (before.seatCount ?? 0) - (before.remainingSeats ?? 0) - before.activeEnrollments);
    const occupied = Math.max(before.activeEnrollments, held);
    if (seatCount < occupied) {
      return {
        ok: false,
        error:
          `이미 ${occupied}자리가 활성 등록·열린 제안으로 쓰이고 있어 정원을 ${seatCount}명으로 줄이지 않았습니다. ` +
          "아래 목록에서 등록·제안을 먼저 확인한 뒤, 그래도 줄이려면 '정원 축소 강행'을 체크해 주세요(기존 등록·제안은 취소되지 않습니다).",
      };
    }
  }

  const db = createServiceClient()!;
  const { error } = await db.from("recruit_status").upsert({
    tenant_id: session.tenantId,
    status,
    message,
    seat_count: seatCount,
    is_banner_visible: isBannerVisible,
  });
  if (error) {
    console.error("[recruit] save failed", error);
    return { ok: false, error: "모집 현황 저장 중 오류가 발생했습니다." };
  }

  await logActivity(
    session.tenantId,
    session.email,
    "update",
    "recruit",
    null,
    `모집 현황 변경 (${status})`,
  );

  // 검수 63 — 정원 축소가 기존 등록·제안을 자동 취소하지 않는다는 사실은 위 upsert가 이미
  // 보장한다(이 액션이 쓰는 테이블은 recruit_status 하나뿐). 여기서는 "자리보다 사람이 많다"는
  // 상태를 읽어 운영 업무로만 알린다 — 정원 초과분을 정리하는 코드는 의도적으로 두지 않는다.
  // (O-04 예외 "자리 감소: 이미 확정된 등록·유효한 자리 제안을 자동 취소하지 않음 → 새 제안
  //  중단 → 운영자 조정" — 새 제안 중단은 offerWaitlistSeat의 남은 자리 게이트가 담당한다.)
  const availability = await getSeatAvailability(session.tenantId);
  if (availability.overbooked) {
    await createWorkItem(session.tenantId, {
      kind: "manual",
      priority: "normal",
      title: "모집 정원 초과 — 등록·제안 조정 필요",
      detail:
        `정원 ${availability.seatCount ?? 0}명 · 활성 등록 ${availability.activeEnrollments}명 · ` +
        `열린 자리 제안 ${availability.openOffers}건 — 기존 등록·제안은 자동 취소하지 않았습니다.`,
      sourceType: "recruit_status",
      sourceId: null,
      nextAction:
        "정원을 다시 올리거나, 열린 자리 제안을 개별 확인해 조정하세요. 새 자리 제안은 조정 전까지 막혀 있습니다(검수 63).",
    });
  }

  revalidateRecruit();
  return { ok: true };
}

export async function restoreRecruitBackup(backupId: string): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const backup = await getBackup(session.tenantId, backupId);
  if (!backup) return { ok: false, error: "백업을 찾을 수 없습니다." };
  // 스냅샷은 저장 시점 recruit_status 행(snake_case) 또는 null(당시 행 없음)을 담고 있다.
  const snapshot = backup.snapshot as RecruitStatusRow | null;
  if (!snapshot) {
    return { ok: false, error: "이 백업 시점에는 저장된 모집 현황이 없습니다." };
  }

  const previous = await fetchRecruitRow(session.tenantId);
  await recordBackup(session.tenantId, BACKUP_TARGET, previous);

  const db = createServiceClient()!;
  // 백업 복원은 게시 데이터 전체 치환 — 감사 선기록(pending) 없이는 실행하지 않는다(fail-closed).
  const result = await runCritical(
    {
      tenantId: session.tenantId,
      actorEmail: session.email,
      action: "restore",
      targetType: "recruit",
      targetId: backupId,
      summary: `모집 현황 백업 복원 (${snapshot.status})`,
      category: "privacy",
      // 복원 전 행 요약(4필드 전부) — null이면 복원 전 저장된 모집 현황이 없던 상태.
      before: previous,
      after: snapshot,
    },
    async () => {
      const { error } = await db.from("recruit_status").upsert({
        tenant_id: session.tenantId,
        status: snapshot.status,
        message: snapshot.message,
        seat_count: snapshot.seat_count,
        is_banner_visible: snapshot.is_banner_visible,
      });
      if (error) {
        console.error("[recruit] restore failed", error);
        return { ok: false, error: "복원 중 오류가 발생했습니다." };
      }
      return { ok: true };
    },
  );
  if (!result.ok) return result;

  // D-08·W-06 최소 수렴: "복원은 정합 확인 업무로 수렴" — 복원분 정합·과거 파기 대상
  // 재적용 여부를 사람이 확인하도록 업무를 남긴다(fail-open — 복원 성공은 유지).
  // 격리 리허설→정합성→재파기→운영 연결 전면 구현은 M8 몫.
  await createWorkItem(session.tenantId, {
    kind: "manual",
    priority: "privacy",
    title: "백업 복원 정합 확인",
    detail: `모집 현황 백업 복원(${snapshot.status})`,
    sourceType: "backup_restore",
    sourceId: backupId,
    nextAction: "복원분 데이터 정합·과거 파기 대상 재적용 여부 확인(D-08·W-06)",
  });

  revalidateRecruit();
  return result;
}

/* ---------- 대기 자리 제안 (C-06 · O-04 · 검수 61·62) ---------- */

/** 자리 제안 행 조회 형태(응답 처리·중복 판정용 최소 컬럼). */
interface WaitlistOfferRow {
  id: string;
  consultation_id: string;
  seat_no: number | null;
  status: string;
  expires_at: string;
}

/** 제안 목록만 다시 그리면 되는 경로 — 공개 배너와 무관하므로 관리자 화면만 무효화한다. */
function revalidateWaitlist() {
  revalidatePath("/admin/recruit");
}

/**
 * 대기 중(보류) 상담 한 명에게 자리를 제안한다 — C-06 "한 명에게 승인된 기간의 자리 제안".
 *
 * 판정 순서(모두 사람이 고른 값을 검증할 뿐, 자동 선정은 하지 않는다 — 검수 61 "대기순서만으로
 * 자동 확정하지 않는다"):
 *  ① 대상이 이 테넌트의 대기(hold) 상담인가
 *  ② 이 상담에 이미 열린 제안이 있는가(한 사람에게 두 자리를 동시에 잡아두지 않는다 — 검수 6)
 *  ③ 그 자리 번호가 이미 수락된 자리인가(수락된 자리는 부분 유니크의 대상이 아니라 앱이 막는다)
 *  ④ 남은 자리가 있는가(정원 초과 상태에서는 새 제안만 중단 — 검수 63. 기존 제안·등록은 그대로)
 *  ⑤ offer_waitlist_seat RPC — 열린 제안끼리의 경합은 여기서 원자적으로 결판난다(검수 61)
 *
 * 안내(알림) 실패는 제안을 되돌리지 않는다 — 자리는 이미 이 사람에게 묶였고, 되돌리면 그 사실이
 * 사라진다. 대신 전달 재시도 업무를 남긴다(O-04·C-06 계열의 "안내 실패: 유지하고 재시도").
 */
export async function offerWaitlistSeat(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const consultationId = String(formData.get("consultationId") ?? "").trim();
  const seatNoRaw = String(formData.get("seatNo") ?? "").trim();
  const daysRaw = String(formData.get("expiresInDays") ?? "").trim();

  if (!consultationId) return { ok: false, error: "자리를 제안할 대기자를 선택해 주세요." };

  // 자리 번호는 필수다 — 번호 없는 제안(seat_no null)은 DB 부분 유니크의 대상에서 빠져
  // "한 자리 한 사람"을 판정할 수 없다(검수 61). 개별 협의는 이 화면의 일이 아니다.
  const seatNo = Number(seatNoRaw);
  if (!seatNoRaw || !Number.isInteger(seatNo) || seatNo < 1) {
    return { ok: false, error: "자리 번호는 1 이상의 정수로 입력해 주세요." };
  }

  // 기한은 날짜가 아니라 기간으로 받는다 — datetime-local은 브라우저(KST)와 서버(UTC)의
  // 해석이 갈려 기한이 9시간 밀릴 수 있다. 정본도 "승인된 기간의 자리 제안"이라 기간이 원형이다.
  const days = Number(daysRaw);
  if (!daysRaw || !Number.isInteger(days) || days < MIN_OFFER_DAYS || days > MAX_OFFER_DAYS) {
    return {
      ok: false,
      error: `회신 기한은 ${MIN_OFFER_DAYS}~${MAX_OFFER_DAYS}일 사이로 입력해 주세요.`,
    };
  }
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const db = createServiceClient()!;

  // ① 대기명단의 정본 표식은 상담 상태 'hold'다(C-05 "정원 대기 → 대기명단").
  const { data: consultData, error: consultError } = await db
    .from("consultations")
    .select("id,name,phone,guardian_phone,status,student_id")
    .eq("tenant_id", session.tenantId)
    .eq("id", consultationId)
    .maybeSingle();
  if (consultError) {
    console.error("[recruit] consultation fetch failed", consultError);
    return { ok: false, error: "대기자 정보를 확인하는 중 오류가 발생했습니다." };
  }
  if (!consultData) return { ok: false, error: "대기자 상담을 찾을 수 없습니다." };
  const consult = consultData as {
    id: string;
    name: string;
    phone: string;
    guardian_phone: string | null;
    status: string;
    student_id: string | null;
  };
  // L-08 "제한은 새 예약·추가 자리 제안에만 적용한다": 예약 위험이 확정된 학생에게 연결된
  // 상담에는 추가 자리를 제안하지 않는다. 학생이 연결되지 않은 상담(신규 문의)은 제한 대상이
  // 아니다 — 제한은 학생 단위로만 판정된다.
  if (
    consult.student_id &&
    (await hasActiveBookingRestriction(session.tenantId, consult.student_id))
  ) {
    return {
      ok: false,
      error: "예약이 제한된 학생입니다. 출결·정정 화면에서 제한을 검토·해제한 뒤 자리를 제안하세요.",
    };
  }

  if (consult.status !== "hold") {
    return {
      ok: false,
      error: "대기(보류) 상태의 상담에만 자리를 제안할 수 있습니다. 상담 화면에서 상태를 먼저 확인해 주세요.",
    };
  }

  // ②③ 열린 제안(이 상담) / 수락된 자리(이 번호)를 한 번에 읽어 판정한다.
  const { data: liveData, error: liveError } = await db
    .from("waitlist_offers")
    .select("id,consultation_id,seat_no,status,expires_at")
    .eq("tenant_id", session.tenantId)
    .in("status", ["offered", "accepted"]);
  if (liveError) {
    console.error("[recruit] live offers fetch failed", liveError);
    return { ok: false, error: "자리 제안 현황을 확인하는 중 오류가 발생했습니다." };
  }
  const live = (liveData ?? []) as WaitlistOfferRow[];

  if (live.some((o) => o.status === "offered" && o.consultation_id === consultationId)) {
    return {
      ok: false,
      error: "이 대기자에게 이미 열린 제안이 있습니다. 수락·거절·만료로 먼저 마무리해 주세요.",
    };
  }
  // 수락된 자리는 예약된 자리다 — 열린 제안이 아니라서 부분 유니크에 걸리지 않으므로 여기서 막는다.
  if (live.some((o) => o.status === "accepted" && o.seat_no === seatNo)) {
    return {
      ok: false,
      error: `${seatNo}번 자리는 이미 수락된 자리입니다. 다른 번호를 지정해 주세요.`,
    };
  }

  // ④ 남은 자리 게이트(검수 63) — 정원을 줄여 초과 상태가 되면 "새 제안만" 멈춘다.
  //    이미 살아 있는 제안·등록은 이 경로에서 건드리지 않는다(취소·회수 코드 없음).
  //    정원 미설정(seatCount=null)이면 수용 인원을 판정할 근거가 없으므로 막지 않는다.
  const availability = await getSeatAvailability(session.tenantId);
  if (availability.seatCount !== null && availability.remainingSeats === 0) {
    return {
      ok: false,
      error:
        `남은 자리가 없습니다(정원 ${availability.seatCount} · 활성 등록 ${availability.activeEnrollments} · ` +
        `열린 제안 ${availability.openOffers}). 기존 등록·제안은 그대로 두고, 정원을 조정하거나 기한 경과 제안을 정리한 뒤 제안해 주세요.`,
    };
  }

  // ⑤ 원자적 자리 점유(00018 offer_waitlist_seat). 위 ②③은 안내용 사전 판정이고,
  //    같은 순간 두 요청이 같은 번호를 집는 경합의 결판은 이 RPC(+부분 유니크)가 낸다.
  const { data: offered, error: rpcError } = await db.rpc("offer_waitlist_seat", {
    p_tenant_id: session.tenantId,
    p_consultation_id: consultationId,
    p_seat_no: seatNo,
    p_expires_at: expiresAt.toISOString(),
  });
  if (rpcError) {
    console.error("[recruit] offer rpc failed", rpcError);
    return { ok: false, error: "자리 제안 중 오류가 발생했습니다." };
  }
  if (!offered) {
    return {
      ok: false,
      error: `${seatNo}번 자리는 이미 다른 대기자에게 제안 중입니다. 그 제안을 마무리한 뒤 다시 시도해 주세요.`,
    };
  }

  // 방금 만든 제안 행(알림·이력의 대상). RPC는 성공 여부만 돌려주므로 다시 읽는다.
  const { data: createdData } = await db
    .from("waitlist_offers")
    .select("id")
    .eq("tenant_id", session.tenantId)
    .eq("consultation_id", consultationId)
    .eq("status", "offered")
    .order("offered_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const offerId = (createdData as { id: string } | null)?.id ?? null;

  // 안내 — 미성년 신청이면 보호자 번호가 우선(상담 화면 규약과 동일).
  const phone = consult.guardian_phone || consult.phone;
  const deadlineText = formatKDateTime(expiresAt.toISOString());
  const notified = await sendNotification({
    tenantId: session.tenantId,
    studentId: consult.student_id,
    type: "waitlist_offer",
    phone,
    message: renderTemplate("waitlist_offer", { name: consult.name, date: deadlineText }),
    isAd: false,
  });
  if (!notified.ok) {
    // 제안은 유지한다(자리는 이미 이 사람에게 묶였다) — 전달만 다시 시도한다.
    console.error("[recruit] waitlist offer notify failed", notified.error);
    await createWorkItem(session.tenantId, {
      kind: "manual",
      priority: "normal",
      title: "대기 자리 제안 안내 발송 실패",
      detail: `${consult.name}님 · ${seatNo}번 자리 · 회신 기한 ${deadlineText} — 제안은 유지되고 안내만 실패했습니다.`,
      sourceType: "waitlist_offer",
      sourceId: offerId,
      nextAction: "대기자에게 자리 제안과 회신 기한을 직접 안내하세요(제안 자체는 살아 있습니다).",
    });
  }

  await logActivity(
    session.tenantId,
    session.email,
    "create",
    "waitlist_offer",
    offerId,
    `대기 자리 제안 (${consult.name} · ${seatNo}번 · 기한 ${deadlineText})`,
  );

  revalidateWaitlist();
  return { ok: true };
}

/** 제안의 종료 방식 — 수락(자리 예약) / 거절·만료(자리 반환). */
type OfferOutcome = "accepted" | "declined" | "expired";

const OUTCOME_LABEL: Record<OfferOutcome, string> = {
  accepted: "수락",
  declined: "거절",
  expired: "만료",
};

/**
 * 열린 제안 하나를 종료한다(검수 62 — 거절·만료면 자리 반환).
 *
 * "자리 반환"에 별도 처리는 없다: 상태가 offered에서 빠지는 순간 부분 유니크
 * (waitlist_offers_one_per_seat)의 대상에서 제외되어 같은 번호로 다시 제안할 수 있게 된다.
 * 다음 대기자에게 자동으로 넘기지 않는다 — 현재 조건·관계·진행 가능성을 운영자가 다시
 * 확인하는 것이 정본이다(C-06 예외 "대기순서만으로 자동 확정하지 않는다").
 *
 * 상담 상태(hold)는 이 액션이 바꾸지 않는다. 수락 다음 단계(시범·정규 신청폼 발급)에서 상담
 * 결과가 확정되며, 그 전환은 상담 화면이 소유한다(검수 6 "동시에 활성화되는 다음 단계는 하나").
 */
async function closeWaitlistOffer(
  id: string,
  outcome: OfferOutcome,
): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  const db = createServiceClient()!;
  const { data, error } = await db
    .from("waitlist_offers")
    .select("id,consultation_id,seat_no,status,expires_at")
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[recruit] offer fetch failed", error);
    return { ok: false, error: "자리 제안을 확인하는 중 오류가 발생했습니다." };
  }
  if (!data) return { ok: false, error: "자리 제안을 찾을 수 없습니다." };
  const offer = data as WaitlistOfferRow;
  if (offer.status !== "offered") {
    return { ok: false, error: "이미 마무리된 제안입니다." };
  }

  // 만료는 시간이 정하는 결과다 — 기한 전에 만료로 적으면 "왜 닫혔는지"가 사실과 어긋난다.
  // 기한 전에 끝내야 하면 회신 결과(수락·거절) 그대로 기록한다.
  if (outcome === "expired" && new Date(offer.expires_at).getTime() > Date.now()) {
    return {
      ok: false,
      error: "아직 회신 기한이 지나지 않았습니다. 기한 전 종료는 수락·거절로 기록해 주세요.",
    };
  }

  // 응답 시각은 사람의 회신에만 남긴다(만료는 응답이 아니다 — 00018 CHECK와 같은 판정).
  const { data: updated, error: updateError } = await db
    .from("waitlist_offers")
    .update({
      status: outcome,
      responded_at: outcome === "expired" ? null : new Date().toISOString(),
    })
    .eq("tenant_id", session.tenantId)
    .eq("id", id)
    .eq("status", "offered") // 동시에 다른 창에서 마무리된 제안을 덮어쓰지 않는다
    .select("id");
  if (updateError) {
    console.error("[recruit] offer close failed", updateError);
    return { ok: false, error: "제안 처리 중 오류가 발생했습니다." };
  }
  if (!updated || updated.length === 0) {
    return { ok: false, error: "이미 마무리된 제안입니다." };
  }

  const seatText = offer.seat_no === null ? "번호 없음" : `${offer.seat_no}번`;
  await logActivity(
    session.tenantId,
    session.email,
    "update",
    "waitlist_offer",
    id,
    `대기 자리 제안 ${OUTCOME_LABEL[outcome]} (${seatText})` +
      (outcome === "accepted" ? "" : " — 자리 반환(다음 대기자 선정은 운영자 판단)"),
  );

  revalidateWaitlist();
  return { ok: true };
}

/** 수락 — 자리 예약. 다음 단계(시범·정규 신청폼)는 상담 화면에서 이어간다. */
export async function acceptWaitlistOffer(id: string): Promise<CrmActionResult> {
  return closeWaitlistOffer(id, "accepted");
}

/** 거절 — 제안 종료·자리 반환(검수 62). 자동 재제안은 없다. */
export async function declineWaitlistOffer(id: string): Promise<CrmActionResult> {
  return closeWaitlistOffer(id, "declined");
}

/** 만료 확정 — 기한이 지난 제안을 닫아 자리를 반환한다(검수 62). 기한 전에는 거부된다. */
export async function expireWaitlistOffer(id: string): Promise<CrmActionResult> {
  return closeWaitlistOffer(id, "expired");
}
