import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getPayment } from "@/lib/payments/toss";
import { sendNotification } from "@/lib/notify/send";
import { renderTemplate } from "@/lib/notify/templates";

// 토스 결제 웹훅 — PAYMENT_STATUS_CHANGED 등 일반 결제 웹훅은 서명 헤더가 없다
// (토스 문서 확인: 일반 결제 웹훅은 서명 없이 발송되며 Payment 조회 API 재호출로만 검증 가능,
// 정산/판매자 웹훅만 tosspayments-webhook-signature 헤더 제공). 그래서 본문을 신뢰하지 않고
// paymentKey로 토스 API를 재조회해 위변조를 검증한 뒤에만 상태를 반영한다.

interface TossWebhookBody {
  paymentKey?: string;
  orderId?: string;
  data?: { paymentKey?: string; orderId?: string };
}

interface WebhookPaymentRow {
  id: string;
  tenant_id: string;
  status: string;
  student_id: string | null;
  students: { parent_phone: string; name: string } | null;
}

export async function POST(request: Request) {
  let body: TossWebhookBody;
  try {
    body = (await request.json()) as TossWebhookBody;
  } catch {
    console.error("[toss webhook] invalid JSON body");
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const paymentKey = body.paymentKey ?? body.data?.paymentKey;
  const orderId = body.orderId ?? body.data?.orderId;
  if (!paymentKey || !orderId) {
    console.error("[toss webhook] missing paymentKey/orderId", body);
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  // 위변조 검증 — 본문 상태를 신뢰하지 않고 토스 API로 재조회한다.
  const verified = await getPayment(paymentKey);
  if (!verified.ok || !verified.payment) {
    console.error("[toss webhook] verification failed", verified.error);
    return NextResponse.json({ error: "verification failed" }, { status: 400 });
  }
  if (verified.payment.orderId !== orderId) {
    console.error(
      "[toss webhook] orderId mismatch",
      verified.payment.orderId,
      orderId,
    );
    return NextResponse.json({ error: "orderId mismatch" }, { status: 400 });
  }
  if (verified.payment.status !== "DONE") {
    // 완료 전 상태 변경 웹훅 — 처리할 것 없이 200으로 재시도만 방지한다.
    return NextResponse.json({ ok: true, ignored: true });
  }

  const db = createServiceClient();
  if (!db) {
    console.error("[toss webhook] DB 미연결");
    return NextResponse.json({ error: "db not configured" }, { status: 400 });
  }

  // tenant-scope-ok: 웹훅에는 테넌트 컨텍스트가 없다(플랫폼 경로). orderId(=payments.id)는
  // 위에서 토스 API 재조회로 위변조를 검증한 값이며, 조회된 행의 tenant_id를 이후 처리에 사용한다.
  const { data: payment, error: fetchError } = await db
    .from("payments")
    .select("id, tenant_id, status, student_id, students(parent_phone, name)")
    .eq("id", orderId)
    .maybeSingle();
  if (fetchError || !payment) {
    console.error("[toss webhook] payment not found", orderId, fetchError);
    return NextResponse.json({ error: "payment not found" }, { status: 400 });
  }
  // students는 payments.student_id 기준 to-one 관계 — Database 제네릭 없이는
  // supabase-js가 임베드 관계를 배열로 추론해 직접 캐스트가 거부된다. 실제 응답은 단일 객체.
  const row = payment as unknown as WebhookPaymentRow;

  if (row.status === "paid") {
    return NextResponse.json({ ok: true, alreadyPaid: true }); // 멱등
  }

  const { error: updateError } = await db
    .from("payments")
    .update({
      status: "paid",
      paid_at: verified.payment.approvedAt ?? new Date().toISOString(),
      toss_payment_key: paymentKey,
    })
    .eq("tenant_id", row.tenant_id)
    .eq("id", orderId);
  if (updateError) {
    console.error("[toss webhook] update failed", updateError);
    return NextResponse.json({ error: "update failed" }, { status: 400 });
  }

  if (row.students?.parent_phone) {
    await sendNotification({
      tenantId: row.tenant_id,
      studentId: row.student_id,
      type: "payment_paid",
      phone: row.students.parent_phone,
      message: renderTemplate("payment_paid", { name: row.students.name }),
      isAd: false,
    });
  }

  return NextResponse.json({ ok: true });
}
