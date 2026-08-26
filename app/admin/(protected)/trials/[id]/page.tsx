import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { toKstDateTimeLocal } from "@/lib/kst";
import { createServiceClient } from "@/lib/supabase/server";
import {
  formatKDateTime,
  formatWon,
  getConsultation,
  listPayments,
} from "@/lib/data/crm";
import { getTrialSession, TRIAL_GATE_LABEL } from "@/lib/data/intake";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ActionButton } from "@/components/admin/crm/action-button";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { paymentStatusLabel, type PaymentStatusEx } from "../../payments/constants";
import {
  cancelTrial,
  completeTrial,
  confirmTrial,
  confirmTrialPayment,
  decideTrialResult,
  linkTrialPayment,
  rescheduleTrial,
  resendTrialConfirmedNotice,
  saveTrialSchedule,
  setTrialPaid,
} from "../actions";
import { ConflictAwareForm } from "../conflict-form";
import { NoshowPanel, type NoshowContactRecord } from "../noshow-panel";
import {
  NOSHOW_CONTACT_MINUTES,
  noshowContactAction,
  TRIAL_CANCEL_FAULT_OPTIONS,
  TRIAL_RESULT_OPTIONS,
  trialResultLabel,
  trialResultTone,
  trialStatusLabel,
  trialStatusTone,
} from "../constants";

// 시범 회차 상세 — 일정 합의·결제 확인·확정(T-02), 재예약·취소·노쇼(T-03), 결과 결정(T-04).
// 정본: docs/flow-canon/01_atlas_01_intake.md · 03_scenarios_133.md 검수 8·9·10·11.
//
// 화면 규율:
//  · 확정은 두 게이트가 모두 선 뒤에만 열린다 — 남은 게이트는 감추지 않고 이름 그대로 보여준다.
//  · 노쇼는 연락 기록 3건 전에는 확정 버튼이 열리지 않고, 확정 전에는 금액·등록 판단에
//    반영하지 않는다는 사실을 화면에 적는다(검수 10).
//  · 결과는 덮어쓰지 않는다 — 이력 전체를 시간순으로 남기고 최신 결정만 '현재 결과'로 표시한다.

/** datetime-local 기본값(YYYY-MM-DDTHH:mm) — KST 벽시계. schedules 입력과 같은 규약. */
const toDateTimeLocal = toKstDateTimeLocal;

export default async function TrialDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAdminSession();
  if (!session) notFound();

  const trial = await getTrialSession(session.tenantId, id);
  if (!trial) notFound();

  const consultation = await getConsultation(session.tenantId, trial.consultationId);

  // 유료 회차의 청구 후보 — 청구 생성은 결제 관리 몫이라 여기서는 고르기만 한다.
  // 상담이 학생으로 전환돼 있으면 그 학생의 청구만 보여준다(payments.student_id는 필수 컬럼).
  const payments = trial.isPaid ? await listPayments(session.tenantId) : [];
  const paymentOptions = consultation?.studentId
    ? payments.filter((p) => p.studentId === consultation.studentId)
    : payments;

  // 노쇼 연락 기록(검수 10) — 회차 컬럼이 아니라 감사 이력에 남는다(append-only).
  const contacts: NoshowContactRecord[] = [];
  const db = createServiceClient();
  if (db && trial.status === "scheduled") {
    const { data } = await db
      .from("activity_log")
      .select("action, created_at, actor_email")
      .eq("tenant_id", session.tenantId)
      .eq("target_type", "trial_session")
      .eq("target_id", trial.id)
      .in(
        "action",
        NOSHOW_CONTACT_MINUTES.map((m) => noshowContactAction(m)),
      )
      .order("created_at", { ascending: true });
    const rows = (data ?? []) as {
      action: string;
      created_at: string;
      actor_email: string | null;
    }[];
    for (const minute of NOSHOW_CONTACT_MINUTES) {
      const hit = rows.find((r) => r.action === noshowContactAction(minute));
      if (hit) {
        contacts.push({
          minute,
          atLabel: formatKDateTime(hit.created_at),
          actor: hit.actor_email,
        });
      }
    }
  }

  const isProposed = trial.status === "proposed";
  const isScheduled = trial.status === "scheduled";
  const isClosed = trial.status === "done" || trial.status === "noshow" || trial.status === "canceled";
  const canConfirm = isProposed && trial.pendingGates.length === 0;

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex flex-wrap items-center gap-3 text-xl font-semibold tracking-tight">
            {trial.consultationName ?? "상담 정보 없음"} 시범 회차
            <Badge tone={trialStatusTone(trial.status)}>{trialStatusLabel(trial.status)}</Badge>
            {trial.isPaid ? <Badge tone="soft">유료</Badge> : <Badge tone="soft">무료</Badge>}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {trial.scheduledAt ? formatKDateTime(trial.scheduledAt) : "일시 미정"} ·{" "}
            {formatKDateTime(trial.createdAt)} 생성
            {trial.formId && " · 신청폼 제출본 연결됨"}
          </p>
        </div>
        <Link href="/admin/trials" className="text-sm font-bold text-muted hover:text-ink">
          ← 목록으로
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* ① 일정 합의 — 검수 8 */}
          <Card>
            <h2 className="mb-1 text-sm font-semibold text-ink-soft">일정 합의</h2>
            <p className="mb-4 text-xs text-muted">
              일시를 입력하고 신청자와 합의가 끝났으면 합의 표시를 함께 켜세요. 일정만 합의된
              상태는 확정이 아니라 결제 대기입니다(T-02).
            </p>
            {isProposed ? (
              <ConflictAwareForm action={saveTrialSchedule} submitLabel="일정 저장">
                <input type="hidden" name="id" value={trial.id} />
                <Field label="시범 일시" required>
                  <Input
                    type="datetime-local"
                    name="scheduledAt"
                    required
                    defaultValue={toDateTimeLocal(trial.scheduledAt)}
                  />
                </Field>
                <label className="mt-3 flex items-center gap-2 text-sm font-bold text-ink-soft">
                  <input
                    type="checkbox"
                    name="agreed"
                    value="1"
                    defaultChecked={trial.scheduleConfirmed}
                    className="h-4 w-4"
                  />
                  신청자와 일정 합의 완료
                </label>
                <p className="mt-2 text-xs text-muted">
                  저장하기 전에 같은 시각 앞뒤 1시간의 다른 일정과 겹치는지 확인합니다. 겹쳐도
                  진행할 수 있지만, 확인한 뒤에 고르게 합니다.
                </p>
              </ConflictAwareForm>
            ) : (
              <div className="space-y-1 text-sm">
                <p>
                  <span className="text-muted">시범 일시</span>{" "}
                  <span className="font-bold">
                    {trial.scheduledAt ? formatKDateTime(trial.scheduledAt) : "미정"}
                  </span>
                </p>
                <p className="text-xs text-muted">
                  확정 이후의 일시 변경은 재예약으로 처리합니다 — 기존 회차를 닫고 대체 회차를
                  만듭니다(T-03).
                </p>
              </div>
            )}
          </Card>

          {/* ② 비용·결제 — 검수 9·14 */}
          <Card>
            <h2 className="mb-1 text-sm font-semibold text-ink-soft">비용·결제</h2>
            <p className="mb-4 text-xs text-muted">
              무료 시범은 결제 단계를 통과 처리하는 것이 아니라 <strong>결제 불필요</strong>로
              기록됩니다. 유료 시범은 청구를 연결하고 완납을 확인해야 확정할 수 있습니다.
            </p>

            {isProposed ? (
              <SubmitForm action={setTrialPaid} submitLabel="비용 구분 저장">
                <input type="hidden" name="id" value={trial.id} />
                <Field label="비용 구분">
                  <Select name="isPaid" defaultValue={trial.isPaid ? "1" : "0"}>
                    <option value="0">무료 시범 (결제 불필요)</option>
                    <option value="1">유료 시범 (청구·완납 확인 필요)</option>
                  </Select>
                </Field>
              </SubmitForm>
            ) : (
              <p className="text-sm">
                <span className="text-muted">비용 구분</span>{" "}
                <span className="font-bold">{trial.isPaid ? "유료 시범" : "무료 시범(결제 불필요)"}</span>
              </p>
            )}

            {trial.isPaid && (
              <div className="mt-5 border-t border-line pt-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-bold text-ink-soft">청구 연결</p>
                  <Link
                    href="/admin/payments"
                    className="text-xs font-bold text-brand-700 hover:underline"
                  >
                    결제 관리에서 새 청구 만들기 →
                  </Link>
                </div>

                {trial.payment ? (
                  <p className="mb-3 text-sm">
                    연결된 청구 · {formatWon(trial.payment.amount)} ·{" "}
                    <Badge tone={trial.payment.status === "paid" ? "success" : "warning"}>
                      {paymentStatusLabel(trial.payment.status as PaymentStatusEx)}
                    </Badge>
                    {trial.payment.paidAt && (
                      <span className="ml-2 text-xs text-muted">
                        {formatKDateTime(trial.payment.paidAt)} 완납
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="mb-3 text-sm text-muted">연결된 청구가 없습니다.</p>
                )}

                {isProposed && (
                  <SubmitForm action={linkTrialPayment} submitLabel="청구 연결 저장">
                    <input type="hidden" name="id" value={trial.id} />
                    <Field
                      label="청구 선택"
                      hint={
                        consultation?.studentId
                          ? "이 상담에서 전환된 학생의 청구만 보여집니다."
                          : "아직 학생으로 전환되지 않은 상담이라 전체 청구가 보입니다 — 대상을 확인하고 고르세요."
                      }
                    >
                      <Select name="paymentId" defaultValue={trial.paymentId ?? ""}>
                        <option value="">연결 안 함 (선택 시 결제 확인도 함께 해제)</option>
                        {paymentOptions.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.studentName} · {formatWon(p.amount)} ·{" "}
                            {paymentStatusLabel(p.status as PaymentStatusEx)} · {p.periodStart}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </SubmitForm>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {trial.paymentConfirmed ? (
                    <Badge tone="success">결제 확인 완료</Badge>
                  ) : (
                    <Badge tone="warning">결제 미확인</Badge>
                  )}
                  {isProposed && !trial.paymentConfirmed && trial.paymentId && (
                    <ActionButton
                      action={confirmTrialPayment}
                      id={trial.id}
                      label="결제 확인"
                      confirmText="연결된 청구가 완납된 것을 확인했습니까?"
                    />
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* ③ 시범 확정 — T-02 결과물 */}
          <Card>
            <h2 className="mb-1 text-sm font-semibold text-ink-soft">시범 확정</h2>
            <p className="mb-4 text-xs text-muted">
              일정 합의와 결제 확인이 모두 갖춰졌을 때만 확정됩니다. 확정하면 신청자에게 확정
              안내가 나갑니다 — 안내가 실패해도 회차는 유지되고 발송만 재시도합니다(T-02).
            </p>

            {isProposed && (
              <>
                <ul className="mb-4 space-y-2">
                  {(["schedule", "payment"] as const).map((gate) => {
                    // 무료 시범에는 결제 게이트가 애초에 걸리지 않는다(결제 불필요).
                    const skipped = gate === "payment" && !trial.isPaid;
                    const done = skipped || !trial.pendingGates.includes(gate);
                    return (
                      <li key={gate} className="flex items-center gap-2 text-sm">
                        <span className={done ? "text-emerald-600" : "text-amber-600"}>
                          {done ? "●" : "○"}
                        </span>
                        <span className="font-bold">{TRIAL_GATE_LABEL[gate]}</span>
                        <span className="text-xs text-muted">
                          {skipped
                            ? "무료 시범 — 결제 불필요"
                            : done
                              ? "완료"
                              : gate === "schedule"
                                ? "일정 확정 대기"
                                : "결제 대기"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {canConfirm ? (
                  <ActionButton
                    action={confirmTrial}
                    id={trial.id}
                    label="시범 확정하기"
                    confirmText="시범 회차를 확정하고 신청자에게 안내를 보냅니다. 진행할까요?"
                    className="text-sm"
                  />
                ) : (
                  <p className="text-sm font-bold text-amber-700">
                    남은 조건이 있어 아직 확정할 수 없습니다.
                  </p>
                )}
              </>
            )}

            {isScheduled && (
              <div className="space-y-4">
                <p className="text-sm">
                  <Badge tone="success">확정됨</Badge>{" "}
                  <span className="ml-2">{formatKDateTime(trial.scheduledAt)}</span>
                </p>
                <ActionButton
                  action={resendTrialConfirmedNotice}
                  id={trial.id}
                  label="확정 안내 다시 보내기"
                />
                <div className="border-t border-line pt-4">
                  <p className="mb-3 text-sm font-bold text-ink-soft">진행 완료 기록</p>
                  <SubmitForm action={completeTrial} submitLabel="진행 완료로 기록">
                    <input type="hidden" name="id" value={trial.id} />
                    <Field label="참석 일시" hint="비워 두면 지금 시각으로 기록합니다.">
                      <Input
                        type="datetime-local"
                        name="attendedAt"
                        defaultValue={toDateTimeLocal(trial.scheduledAt)}
                      />
                    </Field>
                  </SubmitForm>
                </div>
              </div>
            )}

            {isClosed && (
              <p className="text-sm text-muted">
                이미 종료된 회차입니다({trialStatusLabel(trial.status)}).
                {trial.attendedAt && ` 참석 ${formatKDateTime(trial.attendedAt)}.`}
                {trial.canceledReason && ` 사유: ${trial.canceledReason}`}
              </p>
            )}
          </Card>

          {/* ④ 변경·취소·노쇼 — T-03 */}
          {(isProposed || isScheduled) && (
            <Card>
              <h2 className="mb-1 text-sm font-semibold text-ink-soft">변경·취소·노쇼</h2>
              <p className="mb-5 text-xs text-muted">
                요청 주체와 귀책을 함께 남깁니다. 운영자 귀책이면 무상 재예약 또는 전액 환불,
                신청자 요청이면 승인된 환불·차감 정책을 따릅니다 — 정산 자체는 결제 관리에서
                처리합니다(T-03).
              </p>

              <div className="space-y-6">
                <div>
                  <p className="mb-2 text-sm font-bold text-ink-soft">재예약</p>
                  <p className="mb-3 text-xs text-muted">
                    기존 회차를 닫고 대체 회차를 새로 만듭니다. 유료 회차의 청구·결제 확인은
                    새 회차로 이어지고, 일정 합의는 다시 받습니다.
                  </p>
                  <ConflictAwareForm action={rescheduleTrial} submitLabel="재예약 처리">
                    <input type="hidden" name="id" value={trial.id} />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="새 일시" hint="비워 두면 일시 미정 상태로 새 회차를 만듭니다.">
                        <Input type="datetime-local" name="scheduledAt" />
                      </Field>
                      <Field label="재예약 사유" required>
                        <Input name="reason" required placeholder="예: 신청자 요청으로 일정 변경" />
                      </Field>
                    </div>
                  </ConflictAwareForm>
                </div>

                <div className="border-t border-line pt-5">
                  <p className="mb-2 text-sm font-bold text-ink-soft">취소</p>
                  <SubmitForm action={cancelTrial} submitLabel="회차 취소">
                    <input type="hidden" name="id" value={trial.id} />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="귀책" required>
                        <Select name="fault" required defaultValue="">
                          <option value="" disabled>
                            귀책 선택
                          </option>
                          {TRIAL_CANCEL_FAULT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label} — {o.hint}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="사유" required>
                        <Input name="reason" required placeholder="취소 사유" />
                      </Field>
                    </div>
                  </SubmitForm>
                </div>

                {isScheduled && (
                  <div className="border-t border-line pt-5">
                    <p className="mb-3 text-sm font-bold text-ink-soft">노쇼(미참석)</p>
                    <NoshowPanel sessionId={trial.id} recorded={contacts} />
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* ⑤ 시범 결과 — T-04 · 검수 11 */}
          <Card>
            <h2 className="mb-1 text-sm font-semibold text-ink-soft">시범 결과</h2>
            <p className="mb-4 text-xs text-muted">
              결과는 덮어쓰지 않습니다 — 결정이 바뀌면 이전 결정을 남긴 채 새 결정을 추가합니다.
              현재 결과는 가장 최근 결정입니다(T-04).
            </p>

            {trial.results.length === 0 ? (
              <p className="text-sm text-muted">아직 결과 결정이 없습니다.</p>
            ) : (
              <ol className="space-y-2">
                {trial.results.map((r, index) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-2 rounded-panel border border-line px-4 py-3 text-sm"
                  >
                    <Badge tone={trialResultTone(r.result)}>{trialResultLabel(r.result)}</Badge>
                    {index === trial.results.length - 1 && (
                      <span className="text-xs font-semibold text-brand-700">현재 결과</span>
                    )}
                    <span className="text-xs text-muted">
                      {formatKDateTime(r.decidedAt)}
                      {r.decidedBy && ` · ${r.decidedBy}`}
                    </span>
                    {r.note && <span className="w-full text-xs text-ink-soft">{r.note}</span>}
                  </li>
                ))}
              </ol>
            )}

            {isClosed ? (
              <div className="mt-5 border-t border-line pt-5">
                <SubmitForm action={decideTrialResult} submitLabel="결과 기록">
                  <input type="hidden" name="id" value={trial.id} />
                  <Field label="결과" required>
                    <Select name="result" required defaultValue="">
                      <option value="" disabled>
                        결과 선택
                      </option>
                      {TRIAL_RESULT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label} — {o.hint}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="mt-4">
                    <Field label="메모" hint="결정 근거를 남기면 다음 결정과 대조할 수 있습니다.">
                      <Textarea name="note" placeholder="진단 결과·판단 근거" />
                    </Field>
                  </div>
                </SubmitForm>
              </div>
            ) : (
              <p className="mt-4 rounded-panel bg-soft px-4 py-3 text-xs text-muted">
                진행 결과(완료·노쇼·취소)가 확정된 뒤에 시범 결과를 정할 수 있습니다 — 자동
                합격·부적합 판정은 하지 않습니다(T-04).
              </p>
            )}

            <p className="mt-4 rounded-panel border border-brand-100 bg-brand-50 px-4 py-3 text-xs leading-relaxed text-brand-700">
              결과가 <strong>정규 제안</strong>일 때만 상담 상세에서 정규수업 신청폼을 발급할 수
              있습니다(검수 11). 재시범이면 이 화면에서 새 회차를 만들고, 후속 상담·거절·미진행은
              상담 화면에서 다음 단계를 정합니다.
              {consultation && (
                <>
                  {" "}
                  <Link
                    href={`/admin/consultations/${consultation.id}`}
                    className="font-semibold underline"
                  >
                    상담 상세로 이동 →
                  </Link>
                </>
              )}
            </p>
          </Card>
        </div>

        {/* 오른쪽: 요약 */}
        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink-soft">신청자</h2>
            <div className="space-y-1.5 text-sm">
              <p className="font-bold">{trial.consultationName ?? "상담 정보 없음"}</p>
              {trial.consultationPhone && (
                <p className="text-muted">{trial.consultationPhone}</p>
              )}
              {consultation?.guardianName && (
                <p className="text-muted">
                  보호자 {consultation.guardianName}
                  {consultation.guardianPhone && ` · ${consultation.guardianPhone}`}
                </p>
              )}
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {consultation && (
                <Link
                  href={`/admin/consultations/${consultation.id}`}
                  className={buttonClass("ghost", "sm")}
                >
                  상담 상세
                </Link>
              )}
              {consultation?.studentId && (
                <Link
                  href={`/admin/students/${consultation.studentId}`}
                  className={buttonClass("ghost", "sm")}
                >
                  학생 상세
                </Link>
              )}
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink-soft">회차 요약</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">상태</dt>
                <dd className="font-bold">{trialStatusLabel(trial.status)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">일시</dt>
                <dd className="font-bold">
                  {trial.scheduledAt ? formatKDateTime(trial.scheduledAt) : "미정"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">일정 합의</dt>
                <dd className="font-bold">{trial.scheduleConfirmed ? "완료" : "대기"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">결제</dt>
                <dd className="font-bold">
                  {!trial.isPaid
                    ? "불필요(무료)"
                    : trial.paymentConfirmed
                      ? "확인 완료"
                      : "미확인"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">현재 결과</dt>
                <dd className="font-bold">
                  {trial.latestResult ? trialResultLabel(trial.latestResult.result) : "미결정"}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
