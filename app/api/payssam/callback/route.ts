import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { readBill } from "@/lib/payssam/client";
import { runCritical } from "@/lib/data/activity";
import { createWorkItem } from "@/lib/data/work";

// 결제선생(Payssam) 승인 동기화 콜백 — PartnerCallbackClient_SyncApprovalRequest 수신.
// 스펙: 결제 승인 시 파트너 callbackUrl로 POST되며 apprState는 F(승인)만 온다.
// 정상 수신 응답은 {"code":"0000"}(검수 "승인 동기화" 항목 — 0000 응답이 검수 기준).
//
// 인증 모델(주의): CRON_SECRET류 비밀 헤더 인증이 없다. 방어는 두 겹이다 —
//   ① 페이로드의 apiKey 필드를 process.env.PAYSSAM_API_KEY와 대조(1차 필터).
//   ② 콜백에는 hash가 없으므로, 통보를 그대로 믿지 않고 /bill/read로 실제 승인
//      상태·금액을 재조회해 일치할 때만 수납을 반영한다(검수 37·128). 위변조 통보는
//      apiKey를 알아도 페이민트 서버의 실제 상태와 어긋나 여기서 걸러진다 —
//      readBill 대조가 위변조 방어의 본체다.
//
// 상태 모델(flow-canon M0 분리): payments.status(업무 상태)와 appr_*(외부 승인 스냅샷)를
// 분리 저장하고, 대조를 통과한 경우에만 pending→paid로 승격한다. 금전 전환이므로
// runCritical(category "money") fail-closed 감사로 감싼다(정본 ⑦).

/** 승인 동기화 콜백 페이로드에서 이 라우트가 읽는 필드 — 스펙 camelCase와 1:1. */
interface SyncApprovalBody {
  apiKey?: unknown;
  billId?: unknown;
  apprState?: unknown;
  apprPrice?: unknown;
  apprNum?: unknown;
  apprDt?: unknown;
  apprIssuer?: unknown;
}

const OK_BODY = { code: "0000" } as const; // SyncApprovalCallbackResponse

/** 문자열이면 그대로, 아니면 null — 외부 페이로드 방어. */
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** 승인 금액 파싱 — 스펙은 원 단위 문자열. 숫자 외 표기는 검증 불가로 null. */
function parsePrice(v: unknown): number | null {
  if (typeof v === "number" && Number.isSafeInteger(v)) return v; // 방어 — 스펙은 문자열
  if (typeof v !== "string" || !/^\d+$/.test(v.trim())) return null;
  const n = Number(v.trim());
  return Number.isSafeInteger(n) ? n : null;
}

/** apprDt(yyyyMMddHHmmss, KST) → ISO 문자열. 해석 불가면 null. */
function parseApprDt(v: string | null): string | null {
  if (!v || !/^\d{14}$/.test(v)) return null;
  const iso =
    `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` +
    `T${v.slice(8, 10)}:${v.slice(10, 12)}:${v.slice(12, 14)}+09:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

interface EventInput {
  tenantId: string;
  paymentId: string | null;
  billId: string;
  apprState: string | null;
  apprNum: string | null;
  apprPrice: number | null;
  payload: Record<string, unknown>;
  outcome: "applied" | "duplicate" | "mismatch" | "unmatched";
  note?: string;
}

/**
 * payssam_events 원장 1행 기록(검수 36 멱등의 근거).
 * outcome='applied'는 부분 유니크(payssam_events_applied_dedup)에 걸리며,
 * 23505는 같은 승인 통보가 이미 적용됐다는 뜻 — dedup:true로 구분해 돌려준다.
 */
async function recordEvent(
  db: SupabaseClient,
  ev: EventInput,
): Promise<{ ok: true; dedup: boolean; id: string | null } | { ok: false }> {
  const { data, error } = await db
    .from("payssam_events")
    .insert({
      tenant_id: ev.tenantId, // 최초 조회로 확정된 결제 행의 tenant_id — 플랫폼 경로는 여기까지
      payment_id: ev.paymentId,
      bill_id: ev.billId,
      event_type: "callback",
      appr_state: ev.apprState,
      appr_num: ev.apprNum,
      appr_price: ev.apprPrice,
      payload: ev.payload,
      outcome: ev.outcome,
      note: ev.note ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: true, dedup: true, id: null };
    console.error("[payssam/callback] 이벤트 기록 실패", ev.outcome, error.code);
    return { ok: false };
  }
  return { ok: true, dedup: false, id: (data as { id: string }).id };
}

export async function POST(request: Request) {
  // ① 파싱 — 실패는 400. 본문은 미검증 외부 입력이므로 내용을 로그에 남기지 않는다(안전 로그).
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    console.error("[payssam/callback] 본문 파싱 실패");
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    console.error("[payssam/callback] 본문이 객체가 아님");
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const body = raw as SyncApprovalBody & Record<string, unknown>;

  // ① apiKey 대조 — 미설정이면 어떤 콜백도 진위를 판정할 수 없으므로 전부 거절한다.
  const expectedKey = process.env.PAYSSAM_API_KEY;
  if (!expectedKey || strOrNull(body.apiKey) !== expectedKey) {
    console.error("[payssam/callback] apiKey 불일치 또는 미설정 — 거절"); // 값은 로그 금지
    return NextResponse.json({ error: "unauthorized" }, { status: 400 });
  }

  const billId = strOrNull(body.billId);
  if (!billId || billId.length > 20) {
    console.error("[payssam/callback] billId 누락/형식 오류");
    return NextResponse.json({ error: "invalid billId" }, { status: 400 });
  }

  const db = createServiceClient();
  if (!db) {
    // 수신은 했으나 처리 불능 — 500으로 페이민트 재시도 여지를 남긴다.
    console.error("[payssam/callback] DB 미연결");
    return NextResponse.json({ error: "db unavailable" }, { status: 500 });
  }

  // ② bill_id로 결제 최초 조회.
  // tenant-scope-ok: 콜백에는 테넌트 컨텍스트가 없고 bill_id는 서버 생성 전역 unique
  // (00014 payments_bill_id_key) — 이 최초 1건 조회만 플랫폼 경로이며, 이후의 모든
  // 쿼리는 이 행의 tenant_id로 스코프한다.
  const { data: payment, error: lookupError } = await db
    .from("payments")
    .select("id, tenant_id, status, amount, appr_num")
    .eq("bill_id", billId)
    .maybeSingle();
  if (lookupError) {
    console.error("[payssam/callback] 결제 조회 실패", lookupError.code);
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
  if (!payment) {
    // 우리 DB에 없는 bill은 우리 청구가 아닐 수 있다(위변조·오배달 포함) — 400으로 거절.
    // 정본 "결과 불명은 조회 대상"은 우리가 발행한 청구에 대한 원칙이고, 미발행 bill의
    // 통보는 신뢰할 근거 자체가 없다. payssam_events는 tenant_id not null이라 격리
    // 저장도 불가 — billId만 로그로 남긴다(본문 전문은 로그 금지).
    console.error(`[payssam/callback] 대응 결제 없음 bill_id=${billId} — 거절`);
    return NextResponse.json({ error: "unknown bill" }, { status: 400 });
  }

  // 원장 payload는 수신 원문 보존이 원칙(00014)이되, apiKey만 마스킹한다 —
  // payssam_events는 RLS로 테넌트 사용자가 열람하는 원장이라 파트너 비밀키를 남기지 않는다.
  const payload: Record<string, unknown> = { ...body, apiKey: "[redacted]" };

  const cbState = strOrNull(body.apprState);
  const cbPrice = parsePrice(body.apprPrice);
  const cbApprNum = strOrNull(body.apprNum);

  // ④ 멱등(검수 36): 이미 수납된 결제로의 재통보는 duplicate로 기록만 남기고 no-op.
  //    기록 실패는 정보 유실일 뿐 수납 사실에는 영향이 없으므로 응답은 그대로 0000
  //    (5xx로 재시도를 유발해도 같은 no-op만 반복된다).
  if (payment.status === "paid") {
    const knownApprNum = (payment as { appr_num?: string | null }).appr_num ?? null;
    const sameApproval = Boolean(knownApprNum && cbApprNum && knownApprNum === cbApprNum);
    if (!sameApproval) {
      // 내부에 승인 스냅샷이 없거나(수기 완납) 거래번호가 다르다 — 재통보가 아니라
      // "이미 수납 처리된 청구에 대한 별도 실결제"일 수 있다(이중 수납). 은폐하지 않고 표면화한다.
      const mm = await recordEvent(db, {
        tenantId: payment.tenant_id,
        paymentId: payment.id,
        billId,
        apprState: cbState,
        apprNum: cbApprNum,
        apprPrice: cbPrice,
        payload,
        outcome: "mismatch",
        note: `paid 상태로 승인 통보 도착 — 내부 승인번호 ${knownApprNum ?? "없음(수기 완납?)"} vs 통보 ${cbApprNum ?? "-"} · 이중 수납 확인 필요`,
      });
      if (!mm.ok) console.error("[payssam/callback] mismatch 기록 실패");
      await createWorkItem(payment.tenant_id, {
        kind: "payssam_mismatch",
        title: "수납 완료 청구에 승인 통보 도착 — 이중 수납 의심",
        detail: `billId=${billId} · 통보 승인번호 ${cbApprNum ?? "-"} · 내부 ${knownApprNum ?? "수기 완납(승인 스냅샷 없음)"}`,
        sourceType: "payment",
        sourceId: payment.id,
        nextAction: "결제선생 실거래 확인 후 환불(취소) 또는 원장 정정",
        priority: "money",
      });
      return NextResponse.json(OK_BODY);
    }
    const dup = await recordEvent(db, {
      tenantId: payment.tenant_id,
      paymentId: payment.id,
      billId,
      apprState: cbState,
      apprNum: cbApprNum,
      apprPrice: cbPrice,
      payload,
      outcome: "duplicate",
      note: "같은 승인(거래번호 일치)의 재통보 — 무시(검수 36)",
    });
    if (!dup.ok) console.error("[payssam/callback] duplicate 기록 실패 — no-op 유지");
    return NextResponse.json(OK_BODY);
  }

  // ③ 정합 검증(검수 37·128): 통보를 그대로 믿지 않는다 — /bill/read로 실제 상태 재조회.
  const read = await readBill(billId);
  if (!read.ok) {
    // NETWORK(결과 불명)든 명시 거절이든 실제 승인 상태를 확인하지 못한 것 — 반영 보류.
    // 수신 자체는 성공했으므로 0000, 처리는 업무(work_items)로 수렴한다(정본 ⑧).
    const held = await recordEvent(db, {
      tenantId: payment.tenant_id,
      paymentId: payment.id,
      billId,
      apprState: cbState,
      apprNum: cbApprNum,
      apprPrice: cbPrice,
      payload,
      outcome: "unmatched",
      note: `조회 대조 실패(${read.code}) — 반영 보류`,
    });
    if (!held.ok) {
      // 보류의 근거(원장)조차 못 남기면 이 통보는 증발한다 — 500으로 재시도를 받는다.
      return NextResponse.json({ error: "event insert failed" }, { status: 500 });
    }
    await createWorkItem(payment.tenant_id, {
      kind: "payssam_unknown_result",
      title: "결제선생 승인 통보 대조 실패",
      sourceType: "payment",
      sourceId: payment.id,
      priority: "money",
      detail: `bill_id=${billId} 승인 콜백을 받았으나 /bill/read 대조에 실패(${read.code})해 수납을 반영하지 않았습니다.`,
      nextAction: "결제선생에서 해당 청구의 실제 승인 상태·금액을 확인하고 수납 여부를 판정하세요.",
    });
    return NextResponse.json(OK_BODY);
  }

  const readState = strOrNull(read.data.apprState);
  const readPrice = parsePrice(read.data.apprPrice);

  // 승인 확정 조건: 조회 apprState가 F이고, 통보·조회·내부 금액 3자가 모두 일치할 때만.
  // (승인동기화 콜백은 F만 온다 — F가 아닌 통보 자체가 이상 신호다.)
  const verified =
    readState === "F" &&
    cbState === "F" &&
    readPrice !== null &&
    cbPrice !== null &&
    readPrice === payment.amount &&
    cbPrice === payment.amount &&
    (payment.status === "pending" || payment.status === "overdue");
  // ⑤ 반영은 pending·overdue→paid만 — 연체 후 결제는 가장 흔한 정상 흐름이라 sync 경로와
  // 동일하게 자동 반영한다(경로 간 정책 일원화). draft·refunded로 승인 통보가 오면 자동
  // 반영하지 않고 업무로 수렴 — 상태 역행·환불 후 재승인은 사람이 판정한다(금전 fail-closed).

  if (!verified) {
    const mismatch = await recordEvent(db, {
      tenantId: payment.tenant_id,
      paymentId: payment.id,
      billId,
      apprState: readState ?? cbState,
      apprNum: cbApprNum ?? strOrNull(read.data.apprNum),
      apprPrice: readPrice ?? cbPrice,
      payload,
      outcome: "mismatch",
      note:
        `통보 state=${cbState ?? "?"}/price=${cbPrice ?? "?"} · ` +
        `조회 state=${readState ?? "?"}/price=${readPrice ?? "?"} · ` +
        `내부 status=${payment.status}/amount=${payment.amount} — 반영하지 않음`,
    });
    if (!mismatch.ok) {
      // 불일치의 근거(원장)를 못 남기면 금전 이상이 은폐된다 — 500으로 재시도를 받는다.
      return NextResponse.json({ error: "event insert failed" }, { status: 500 });
    }
    await createWorkItem(payment.tenant_id, {
      kind: "payssam_mismatch",
      title: "결제선생 승인 통보 불일치",
      sourceType: "payment",
      sourceId: payment.id,
      priority: "money",
      detail:
        `bill_id=${billId} 승인 콜백이 내부 청구와 일치하지 않습니다. ` +
        `통보 ${cbState ?? "?"}·${cbPrice ?? "?"}원, 조회 ${readState ?? "?"}·${readPrice ?? "?"}원, ` +
        `내부 ${payment.status}·${payment.amount}원.`,
      nextAction: "결제선생 청구 내역과 내부 청구를 대조해 수납·취소 여부를 판정하세요.",
    });
    return NextResponse.json(OK_BODY);
  }

  // ⑤ 수납 반영 — 금전 전환은 runCritical(money) fail-closed 감사(정본 ⑦).
  const apprNum = cbApprNum ?? strOrNull(read.data.apprNum);
  const apprIssuer = strOrNull(body.apprIssuer) ?? strOrNull(read.data.apprIssuer);
  const apprDtIso = parseApprDt(strOrNull(body.apprDt) ?? strOrNull(read.data.apprDt));

  const result = await runCritical(
    {
      tenantId: payment.tenant_id,
      actorEmail: null, // 시스템 경로 — 콜백에는 행위자가 없다
      action: "update",
      targetType: "payment",
      targetId: payment.id,
      summary: `결제선생 승인 동기화 수납: ${payment.amount.toLocaleString("ko-KR")}원 (bill ${billId})`,
      category: "money",
      before: { status: payment.status, amount: payment.amount },
      after: { status: "paid", appr_state: "F", appr_num: apprNum, appr_price: payment.amount },
    },
    async () => {
      // ④ 멱등 클레임(검수 36): applied 이벤트 insert가 23505면 같은 승인 통보
      // (tenant·bill·apprNum·경로)가 이미 적용된 것 — no-op으로 끝낸다.
      const claim = await recordEvent(db, {
        tenantId: payment.tenant_id,
        paymentId: payment.id,
        billId,
        apprState: "F",
        apprNum,
        apprPrice: payment.amount,
        payload,
        outcome: "applied",
      });
      if (!claim.ok) return { ok: false as const, error: "이벤트 원장 기록에 실패했습니다." };
      if (claim.dedup) return { ok: true as const, dedup: true };

      // 업무 상태 승격 — 미수납(pending·overdue)일 때만(경쟁 워커·수기 완납과의 이중 반영 방지).
      // paid_at은 승인 일시(apprDt)를 쓰되 해석 불가면 수신 시각으로 대체한다(스냅샷
      // appr_dt는 해석된 값만 저장 — 불명확한 외부 표기를 사실처럼 남기지 않는다).
      const { data: updated, error: updateError } = await db
        .from("payments")
        .update({
          status: "paid",
          paid_at: apprDtIso ?? new Date().toISOString(),
          appr_state: "F",
          appr_num: apprNum,
          appr_dt: apprDtIso,
          appr_price: payment.amount,
          appr_issuer: apprIssuer,
          last_synced_at: new Date().toISOString(), // 방금 /bill/read 대조를 통과했다
        })
        .eq("tenant_id", payment.tenant_id)
        .eq("id", payment.id)
        .in("status", ["pending", "overdue"])
        .select("id")
        .maybeSingle();

      if (updateError || !updated) {
        // 클레임은 남았는데 반영이 안 됐다 — 이대로 두면 재시도가 23505 no-op으로 흡수돼
        // 수납이 영영 누락된다. 클레임을 회수해 재시도가 다시 반영을 시도하게 한다.
        // (원장 보존 원칙은 "수신 사건"에 대한 것 — 적용 실패한 클레임 회수는 그 예외다.)
        if (claim.id) {
          const { error: undoError } = await db
            .from("payssam_events")
            .delete()
            .eq("tenant_id", payment.tenant_id)
            .eq("id", claim.id);
          if (undoError) {
            // 회수 실패 = 재시도가 전부 no-op이 되는 최악 경로 — 사람 손으로 수렴시킨다.
            console.error("[payssam/callback] applied 클레임 회수 실패", undoError.code);
            await createWorkItem(payment.tenant_id, {
              kind: "automation_failure",
              title: "결제선생 수납 반영 실패(원장 클레임 잔존)",
              sourceType: "payment",
              sourceId: payment.id,
              priority: "money",
              detail: `bill_id=${billId} 승인 대조는 통과했으나 수납 반영에 실패했고, applied 이벤트 회수도 실패했습니다. 재통보는 멱등 no-op으로 흡수됩니다.`,
              nextAction: "결제선생 승인 내역을 확인해 해당 청구를 수동 완납 처리하고 payssam_events를 정리하세요.",
            });
          }
        }
        if (updateError) console.error("[payssam/callback] 수납 반영 실패", updateError.code);
        return { ok: false as const, error: "수납 반영에 실패했습니다." };
      }
      return { ok: true as const, dedup: false };
    },
  );

  if (!result.ok) {
    // 감사 선기록 실패 포함 — 처리 실패는 500으로 페이민트 재시도 여지를 남긴다(fail-closed).
    console.error("[payssam/callback] 수납 처리 실패", result.error);
    return NextResponse.json({ error: "apply failed" }, { status: 500 });
  }
  if ("auditWarning" in result && result.auditWarning) {
    console.error("[payssam/callback]", result.auditWarning);
  }

  // ⑥ 모든 정상 수신 경로의 응답 — {"code":"0000"} (검수 기준).
  return NextResponse.json(OK_BODY);
}
