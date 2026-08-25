import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import {
  formatKDate,
  formatKDateTime,
  formatWon,
  getStudent,
  hasDb,
} from "@/lib/data/crm";
import { getEnrollment, getSeatAvailability } from "@/lib/data/intake";
import type { Contract } from "@/lib/data/intake";
import { createServiceClient } from "@/lib/supabase/server";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ActionButton } from "@/components/admin/crm/action-button";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { studentStatusLabel } from "../../students/constants";
import { GateCard } from "../gate-card";
import {
  CANCEL_REASON_HINT,
  END_REASON_HINT,
  GATE_LABEL,
  GATE_PENDING_LABEL,
  enrollmentStatusLabel,
  enrollmentStatusTone,
  preparingNotice,
} from "../constants";
import {
  activateEnrollment,
  cancelEnrollment,
  confirmPaymentGate,
  confirmRelationGate,
  confirmScheduleGate,
  endEnrollment,
  recordContractAgreement,
  releaseGate,
} from "../actions";

// 정규 등록 상세 — 네 게이트 화면 (R-02~R-06 · 검수 12·13·14·15).
//
// 화면의 규율:
//  · 각 게이트는 "확인했다"는 체크가 아니라 근거를 보여준다 — 관계는 지금 열린 포털 관계,
//    계약은 동의된 계약본과 조건 스냅샷, 결제는 완납된 청구, 일정은 확정 회차. 근거가 화면에
//    없으면 통과 폼도 열지 않는다(결제·일정은 근거가 아예 없으면 안내와 링크만 준다).
//  · 활성화 버튼은 네 게이트가 모두 통과했을 때만 열린다. 열려 있어도 판정의 정본은 여기가
//    아니라 activate_enrollment RPC의 WHERE다 — 그 사이 게이트가 풀리면 실패로 수렴한다(검수 15).
//  · pending은 끝까지 "등록 준비 중"이라고 부른다. 결제만 됐거나 일정만 잡힌 상태를 확정 수업으로
//    읽히게 하지 않는 것이 검수 13·14의 요구다.
//  · 포털 초대는 여기서 발급하지 않는다 — 활성화 성공 후 학생 상세로 보내는 링크만 둔다(R-06
//    최소 연결). students/actions.ts의 invitePortalRelation은 이 범위의 소유 파일이 아니다.

/** 포털 관계 역할 라벨 — lib/portal/auth.ts는 서버 전용 모듈이라 화면 문구는 여기에 둔다. */
const ROLE_LABEL: Record<string, string> = {
  student: "학생",
  guardian: "보호자",
  payer: "납부자",
  contractor: "계약자",
};

interface RelationRow {
  role: string;
  status: string;
  name: string;
}

/** 지금 이 학생에게 열려 있는 포털 관계(회수분 제외) — 관계 게이트의 참고 자료. */
async function loadRelations(tenantId: string, studentId: string): Promise<RelationRow[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data: relations } = await db
    .from("portal_relations")
    .select("contact_id, role, status")
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId)
    .neq("status", "revoked");
  const rows = (relations ?? []) as { contact_id: string; role: string; status: string }[];
  if (rows.length === 0) return [];
  const { data: contacts } = await db
    .from("portal_contacts")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .in("id", [...new Set(rows.map((r) => r.contact_id))]);
  const nameById = new Map(
    ((contacts ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
  );
  return rows.map((r) => ({
    role: r.role,
    status: r.status,
    name: nameById.get(r.contact_id) ?? "(이름 없음)",
  }));
}

interface PaymentRow {
  id: string;
  amount: number;
  status: string;
  period_start: string | null;
  period_end: string | null;
  due_date: string | null;
  paid_at: string | null;
}

/** 이 학생의 청구 — 완납분은 결제 게이트의 근거이고, 미결·미납분은 남은 대사를 보여준다. */
async function loadPayments(tenantId: string, studentId: string): Promise<PaymentRow[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("payments")
    .select("id, amount, status, period_start, period_end, due_date, paid_at")
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId)
    .in("status", ["pending", "paid", "overdue"])
    .order("due_date", { ascending: false });
  return (data ?? []) as unknown as PaymentRow[];
}

interface ScheduleRow {
  id: string;
  scheduled_at: string;
  status: string;
}

/** 확정 회차(취소 제외) — 일정 게이트의 근거. 첫 회차가 곧 '수업이 잡혔다'는 사실이다. */
async function loadSchedules(tenantId: string, studentId: string): Promise<ScheduleRow[]> {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db
    .from("schedules")
    .select("id, scheduled_at, status")
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId)
    .in("status", ["planned", "done", "makeup"])
    .order("scheduled_at", { ascending: true })
    .limit(5);
  return (data ?? []) as unknown as ScheduleRow[];
}

/** terms(jsonb) 스냅샷 읽기 — 어떤 조건에 동의했는지가 분쟁 시 대조 대상이라 원본 키를 그대로 읽는다. */
function readTerms(terms: Record<string, unknown>) {
  const text = (key: string): string | null =>
    typeof terms[key] === "string" && terms[key] ? (terms[key] as string) : null;
  const num = (key: string): number | null =>
    typeof terms[key] === "number" ? (terms[key] as number) : null;
  return {
    subject: text("subject"),
    schedule: text("schedule"),
    tuition: num("tuition"),
    startDate: text("start_date"),
    note: text("note"),
  };
}

function ContractSummary({ contract }: { contract: Contract }) {
  const t = readTerms(contract.terms);
  return (
    <div className="text-sm text-ink-soft">
      <p className="font-bold text-ink">
        {t.schedule ?? "수업 조건 미기재"}
        {t.subject ? ` · ${t.subject}` : ""}
      </p>
      <p className="mt-1 text-xs text-muted">
        {t.tuition !== null ? `수업료 ${formatWon(t.tuition)}` : "수업료 미기재"}
        {t.startDate ? ` · 시작 ${formatKDate(t.startDate)}` : ""}
      </p>
      {t.note && <p className="mt-1 text-xs text-muted">비고: {t.note}</p>}
      <p className="mt-1 text-xs text-muted">
        {contract.agreedAt
          ? `동의 ${formatKDateTime(contract.agreedAt)} · ${contract.agreedByName ?? "-"}`
          : `미동의(제안 ${formatKDate(contract.createdAt)})`}
      </p>
    </div>
  );
}

export default async function EnrollmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAdminSession();
  if (!session) notFound();

  const enrollment = await getEnrollment(session.tenantId, id);
  if (!enrollment) notFound();

  const student = await getStudent(session.tenantId, enrollment.studentId);
  const [relations, payments, schedules, seats] = await Promise.all([
    loadRelations(session.tenantId, enrollment.studentId),
    loadPayments(session.tenantId, enrollment.studentId),
    loadSchedules(session.tenantId, enrollment.studentId),
    getSeatAvailability(session.tenantId),
  ]);

  const isPending = enrollment.status === "pending";
  const isActive = enrollment.status === "active";
  const paidPayments = payments.filter((p) => p.status === "paid");
  const unsettled = payments.filter((p) => p.status !== "paid");
  const agreedContract = enrollment.contracts.find((c) => c.agreedAt !== null) ?? null;
  const canActivate = isPending && enrollment.pendingGates.length === 0;
  const seatWarning =
    isPending && seats.seatCount !== null && (seats.remainingSeats ?? 0) === 0;

  /** 게이트 해제 폼 — 근거가 뒤집혔을 때만 쓴다(R-04 "완료 후 다시 활성화 조건 확인"). */
  const releaseForm = (gate: "relation" | "contract" | "payment" | "schedule") => (
    <SubmitForm action={releaseGate} submitLabel={`${GATE_LABEL[gate]} 해제`}>
      <input type="hidden" name="id" value={enrollment.id} />
      <input type="hidden" name="gate" value={gate} />
      <Field
        label="해제 사유"
        required
        hint={
          gate === "contract"
            ? "동의된 계약본의 동의도 함께 거둡니다 — 새 조건은 새 계약본으로 다시 동의받습니다(R-03)."
            : "근거가 뒤집혔을 때만 해제합니다(환불·일정 취소·관계 분쟁 등)."
        }
      >
        <Input name="reason" required placeholder="예: 결제 환불로 근거 소멸" />
      </Field>
    </SubmitForm>
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-black tracking-tight">
              {enrollment.studentName ?? "알 수 없음"} 정규 등록
            </h1>
            <Badge tone={enrollmentStatusTone(enrollment.status)}>
              {enrollmentStatusLabel(enrollment.status)}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted">
            생성 {formatKDate(enrollment.createdAt)}
            {enrollment.consultationName ? ` · 상담 ${enrollment.consultationName}` : ""}
            {enrollment.formId ? " · 정규 신청폼 근거 있음" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/enrollments" className={buttonClass("ghost", "sm")}>
            목록
          </Link>
          <Link
            href={`/admin/students/${enrollment.studentId}`}
            className={buttonClass("outline", "sm")}
          >
            학생 상세
          </Link>
          {enrollment.consultationId && (
            <Link
              href={`/admin/consultations/${enrollment.consultationId}`}
              className={buttonClass("ghost", "sm")}
            >
              상담 상세
            </Link>
          )}
        </div>
      </div>

      {!hasDb() && <DbBanner />}

      {isPending && (
        <div className="mb-6 rounded-panel border border-amber-100 bg-amber-50 px-5 py-4">
          <p className="text-sm font-black text-amber-700">등록 준비 중</p>
          <p className="mt-1 text-sm text-amber-700">
            {preparingNotice({
              relationOk: enrollment.relationOk,
              contractOk: enrollment.contractOk,
              paymentOk: enrollment.paymentOk,
              scheduleOk: enrollment.scheduleOk,
            })}
          </p>
          {enrollment.pendingGates.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {enrollment.pendingGates.map((gate) => (
                <Badge key={gate} tone="warning">
                  {GATE_PENDING_LABEL[gate]}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {/* ① 관계 확인 (R-02) */}
        <GateCard
          gate="relation"
          step={1}
          done={enrollment.relationOk}
          evidence={
            <div>
              {relations.length === 0 ? (
                <p className="text-xs text-muted">
                  열려 있는 포털 관계가 없습니다 — 역할별 초대는 등록 활성화 이후에 발급합니다.
                  지금은 학생·보호자·계약자·납부자가 각각 누구인지 확인해 근거로 남겨 주세요.
                </p>
              ) : (
                <ul className="flex flex-col gap-1 text-xs">
                  {relations.map((r, i) => (
                    <li key={`${r.role}-${i}`} className="text-ink-soft">
                      <span className="font-bold">{ROLE_LABEL[r.role] ?? r.role}</span> · {r.name}
                      <span className="ml-1 text-muted">
                        ({r.status === "active" ? "수락" : "초대"})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href={`/admin/students/${enrollment.studentId}`}
                className="mt-2 inline-block text-xs font-bold text-brand-700 hover:underline"
              >
                포털 관계 카드 열기 →
              </Link>
            </div>
          }
        >
          {isPending &&
            (enrollment.relationOk ? (
              releaseForm("relation")
            ) : (
              <SubmitForm action={confirmRelationGate} submitLabel="관계 확인 완료">
                <input type="hidden" name="id" value={enrollment.id} />
                <Field
                  label="확인한 관계"
                  required
                  hint="학생·보호자·계약자·납부자가 각각 누구인지, 학습 공유권한과 청구권한을 어떻게 나눴는지 적습니다."
                >
                  <Textarea
                    name="note"
                    required
                    placeholder="예: 학생 김OO(중2) · 보호자=납부자 김XX(모) · 계약자 동일 · 학습 공유는 보호자만, 청구는 납부자에게"
                  />
                </Field>
              </SubmitForm>
            ))}
        </GateCard>

        {/* ② 계약 수락 (R-03) */}
        <GateCard
          gate="contract"
          step={2}
          done={enrollment.contractOk}
          evidence={
            agreedContract ? (
              <ContractSummary contract={agreedContract} />
            ) : (
              <p className="text-xs text-muted">
                동의된 계약본이 없습니다 — 수업 조건을 확정해 계약본을 만들고 성인 계약자의 동의를
                기록해야 통과합니다.
              </p>
            )
          }
        >
          {isPending &&
            (enrollment.contractOk ? (
              releaseForm("contract")
            ) : !enrollment.relationOk ? (
              <p className="text-xs font-bold text-amber-700">
                관계 확인이 먼저입니다 — 계약자·납부자가 정리되기 전에는 계약 단계를 열지 않습니다(R-01).
              </p>
            ) : (
              <SubmitForm action={recordContractAgreement} submitLabel="계약 동의 기록">
                <input type="hidden" name="id" value={enrollment.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="수업 조건(요일·시간)" required>
                    <Input name="schedule" required placeholder="예: 매주 화·목 19:00~21:00" />
                  </Field>
                  <Field label="과목">
                    <Input name="subject" placeholder="예: 고1 수학" />
                  </Field>
                  <Field label="수업료(원)" required hint="계약 시점 금액을 그대로 굳혀 둡니다">
                    <Input name="tuition" type="number" min={0} step={1000} required />
                  </Field>
                  <Field label="수업 시작일" required>
                    <Input name="startDate" type="date" required />
                  </Field>
                  <Field label="계약자(성인) 이름" required>
                    <Input name="agreedByName" required placeholder="예: 김XX" />
                  </Field>
                  <Field label="계약자 연락처" required hint="숫자만 (예: 01012345678)">
                    <Input name="agreedByPhone" required inputMode="numeric" />
                  </Field>
                </div>
                <Field label="비고" className="mt-3">
                  <Input name="note" placeholder="예: 교재비 별도 · 휴강 정책 안내함" />
                </Field>
                <p className="mt-3 text-xs text-muted">
                  신청폼 동의는 계약 수락이 아닙니다(R-03). 이 기록은 운영자가 성인 계약자에게 확인받은
                  동의를 남기는 것이며, 조건을 바꾸려면 새 계약본으로 다시 동의받습니다.
                </p>
              </SubmitForm>
            ))}
        </GateCard>

        {/* ③ 결제 확인 (R-04 · 검수 14) */}
        <GateCard
          gate="payment"
          step={3}
          done={enrollment.paymentOk}
          evidence={
            <div>
              {paidPayments.length === 0 ? (
                <p className="text-xs text-muted">완납된 청구가 없습니다.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-xs text-ink-soft">
                  {paidPayments.slice(0, 3).map((p) => (
                    <li key={p.id}>
                      <span className="font-bold">{formatWon(p.amount)}</span> ·{" "}
                      {formatKDate(p.period_start)}~{formatKDate(p.period_end)} · 완납{" "}
                      {formatKDate(p.paid_at)}
                    </li>
                  ))}
                </ul>
              )}
              {unsettled.length > 0 && (
                <p className="mt-2 text-xs text-amber-700">
                  대사 남은 청구 {unsettled.length}건(청구·미납) — 결과가 불명확한 동안에는 통과시키지
                  않습니다.
                </p>
              )}
              <Link
                href="/admin/payments"
                className="mt-2 inline-block text-xs font-bold text-brand-700 hover:underline"
              >
                결제 관리 열기 →
              </Link>
            </div>
          }
        >
          {isPending &&
            (enrollment.paymentOk ? (
              releaseForm("payment")
            ) : paidPayments.length === 0 ? (
              <p className="text-xs font-bold text-amber-700">
                완납(paid)된 청구만 근거가 됩니다 — 결제 관리에서 입금 대사를 마친 뒤 다시 확인해
                주세요(검수 14).
              </p>
            ) : (
              <SubmitForm action={confirmPaymentGate} submitLabel="결제 확인 완료">
                <input type="hidden" name="id" value={enrollment.id} />
                <Field label="근거 청구" required hint="완납된 청구만 고를 수 있습니다">
                  <Select name="paymentId" required defaultValue="">
                    <option value="">청구 선택</option>
                    {paidPayments.map((p) => (
                      <option key={p.id} value={p.id}>
                        {formatWon(p.amount)} · {formatKDate(p.period_start)}~
                        {formatKDate(p.period_end)} · 완납 {formatKDate(p.paid_at)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </SubmitForm>
            ))}
        </GateCard>

        {/* ④ 일정 확정 (R-04 · 검수 13) */}
        <GateCard
          gate="schedule"
          step={4}
          done={enrollment.scheduleOk}
          evidence={
            <div>
              {schedules.length === 0 ? (
                <p className="text-xs text-muted">확정된 수업 회차가 없습니다(취소분 제외).</p>
              ) : (
                <ul className="flex flex-col gap-1 text-xs text-ink-soft">
                  {schedules.slice(0, 3).map((s) => (
                    <li key={s.id}>
                      {formatKDateTime(s.scheduled_at)}
                      <span className="ml-1 text-muted">
                        ({s.status === "done" ? "완료" : s.status === "makeup" ? "보강" : "예정"})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href="/admin/schedules"
                className="mt-2 inline-block text-xs font-bold text-brand-700 hover:underline"
              >
                일정 관리 열기 →
              </Link>
            </div>
          }
        >
          {isPending &&
            (enrollment.scheduleOk ? (
              releaseForm("schedule")
            ) : schedules.length === 0 ? (
              <p className="text-xs font-bold text-amber-700">
                일정 관리에서 첫 회차를 먼저 등록해 주세요 — 확정 회차가 없으면 통과시키지 않습니다.
              </p>
            ) : (
              <SubmitForm action={confirmScheduleGate} submitLabel="일정 확정 확인">
                <input type="hidden" name="id" value={enrollment.id} />
                <p className="text-xs text-muted">
                  위 확정 회차를 근거로 일정 게이트를 통과시킵니다. 서버가 저장 직전에 회차를 다시
                  확인합니다.
                </p>
              </SubmitForm>
            ))}
        </GateCard>
      </div>

      {isPending && (
        <Card className="mb-6">
          <h2 className="text-sm font-black text-ink-soft">등록 활성화</h2>
          {canActivate ? (
            <>
              <p className="mt-1 text-sm text-muted">
                네 조건이 모두 확인됐습니다. 활성화는 한 문장으로 판정·전환되며(activate_enrollment),
                그 사이 조건이 하나라도 풀리면 아무것도 바뀌지 않습니다(검수 15). 활성화되면 학생
                상태도 함께 활성으로 맞춰집니다.
              </p>
              {seatWarning && (
                <p className="mt-2 text-sm font-bold text-amber-700">
                  남은 자리가 없습니다(정원 {seats.seatCount} · 활성 {seats.activeEnrollments} · 열린
                  제안 {seats.openOffers}). 정원을 다시 확인하거나 대기·조건 재협의로 보내 주세요(R-04
                  &lsquo;정원 상실&rsquo;).
                </p>
              )}
              <div className="mt-4">
                <ActionButton
                  action={activateEnrollment}
                  id={enrollment.id}
                  label="등록 활성화"
                  pendingLabel="활성화 중..."
                  confirmText="네 조건을 모두 확인했습니다. 등록을 활성화할까요?"
                  className="text-sm"
                />
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted">
                남은 조건이 있어 활성화 버튼이 열리지 않습니다 — 아래 조건을 먼저 확인해 주세요.
              </p>
              <ul className="mt-3 flex flex-col gap-1 text-sm text-ink-soft">
                {enrollment.pendingGates.map((gate) => (
                  <li key={gate}>· {GATE_LABEL[gate]}</li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      {isActive && (
        <Card className="mb-6">
          <h2 className="text-sm font-black text-ink-soft">활성 등록</h2>
          <p className="mt-1 text-sm text-muted">
            활성 {formatKDateTime(enrollment.activatedAt)} · 학생 상태 미러:{" "}
            {student ? studentStatusLabel(student.status) : "-"}
          </p>
          <p className="mt-3 text-sm text-ink-soft">
            역할별 포털 초대는 학생 상세의 포털 관계 카드에서 발급합니다(R-06). 초대 발송이 실패해도
            등록 활성은 유지됩니다.
          </p>
          <div className="mt-4">
            <Link
              href={`/admin/students/${enrollment.studentId}`}
              className={buttonClass("primary", "sm")}
            >
              포털 초대 보내기
            </Link>
          </div>
        </Card>
      )}

      {isActive && (
        <Card className="mb-6">
          <h2 className="text-sm font-black text-ink-soft">등록 종료</h2>
          <p className="mt-1 mb-3 text-sm text-muted">
            종료하면 학생 상태도 종료로 맞춰지고, 그 상태를 읽는 기존 포털 접근 판정이 즉시 닫힙니다
            (E-04 접근 회수). 미수·환불이 남아 있으면 결제 화면에서 정산을 먼저 정리해 주세요.
          </p>
          <SubmitForm
            action={endEnrollment}
            submitLabel="등록 종료"
            redirectTo="/admin/enrollments"
          >
            <input type="hidden" name="id" value={enrollment.id} />
            <Field label="종료 사유" required hint={END_REASON_HINT}>
              <Input name="reason" required placeholder="예: 수강 종료(과정 완료)" />
            </Field>
          </SubmitForm>
        </Card>
      )}

      {isPending && (
        <Card className="mb-6">
          <h2 className="text-sm font-black text-ink-soft">활성화 전 취소</h2>
          <p className="mt-1 mb-3 text-sm text-muted">
            계약 미동의·미결제·일정 미합의·정원 상실·고객 철회로 준비가 끝났을 때 닫습니다(R-06).
            학생 상태는 건드리지 않습니다 — 이 등록은 활성화된 적이 없습니다. 이미 수납된 금액이
            있으면 결제 화면의 환불 흐름으로 먼저 정리해 주세요.
          </p>
          <SubmitForm
            action={cancelEnrollment}
            submitLabel="등록 취소"
            redirectTo="/admin/enrollments"
          >
            <input type="hidden" name="id" value={enrollment.id} />
            <Field label="취소 사유" required hint={CANCEL_REASON_HINT}>
              <Input name="reason" required placeholder="예: 신청자 철회" />
            </Field>
          </SubmitForm>
        </Card>
      )}

      {(enrollment.status === "ended" || enrollment.status === "canceled") && (
        <Card className="mb-6">
          <h2 className="text-sm font-black text-ink-soft">
            {enrollment.status === "ended" ? "종료된 등록" : "취소된 등록"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {formatKDateTime(enrollment.endedAt)}
            {enrollment.endReason ? ` · ${enrollment.endReason}` : ""}
          </p>
          <p className="mt-3 text-xs text-muted">
            재등록은 이 행을 되살리지 않고 새 등록을 만드는 흐름입니다 — 등록의 정본은 이제
            enrollments입니다(검수 48).
          </p>
        </Card>
      )}

      {enrollment.contracts.length > 0 && (
        <Card>
          <h2 className="text-sm font-black text-ink-soft">계약 이력</h2>
          <p className="mt-1 mb-3 text-xs text-muted">
            조건이 바뀌면 이전 계약본을 고치지 않고 새 계약본을 만듭니다 — 동의된 계약본은 한 등록에
            하나뿐입니다(R-03 · R-05).
          </p>
          <ul className="flex flex-col gap-3">
            {enrollment.contracts.map((c) => (
              <li key={c.id} className="rounded-panel border border-line px-4 py-3">
                <ContractSummary contract={c} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
