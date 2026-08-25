import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import {
  formatKDate,
  formatWon,
  getStudent,
  getStudentSummary,
  listConsents,
  listMaterials,
  listStudentNotifications,
} from "@/lib/data/crm";
import { createServiceClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Textarea } from "@/components/ui/form";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { PortalLinkCard } from "@/components/admin/portal-link";
import {
  invitePortalRelation,
  reEnrollStudent,
  regeneratePortalToken,
  resendPortalInvite,
  revokePortalRelation,
  updateStudent,
} from "../actions";
import {
  PortalRelationsCard,
  type PortalRelationItem,
} from "../portal-relations-card";
import { StudentFormFields } from "../student-form-fields";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://axiommathlab.kr";
import { classTypeLabel, studentStatusLabel, studentStatusTone } from "../constants";
import { consentItemLabel } from "../../consultations/constants";

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  draft: "작성 중",
  pending: "청구",
  paid: "완납",
  overdue: "미납",
};

const NOTIFY_STATUS_LABEL: Record<string, string> = {
  queued: "대기",
  sent: "발송",
  failed: "실패",
};

function notifyStatusTone(status: string): "success" | "danger" | "soft" {
  if (status === "sent") return "success";
  if (status === "failed") return "danger";
  return "soft";
}

/**
 * 이 학생에 열려 있는 포털 관계 목록(P-01·P-06).
 *
 * 회수(revoked)된 관계는 싣지 않는다 — 카드는 "지금 열려 있는 접근"만 보여주고, 회수 이력은
 * 감사(activity_log)가 갖는다. 회수된 사람을 다시 부르려면 초대 발급 폼으로 새로 발급하면
 * 같은 관계 행이 되살아난다(invitePortalRelation).
 *
 * PostgREST 임베딩 대신 세 번 나눠 조회한다: portal_relations는 (tenant_id, contact_id) 복합 FK로
 * 연결돼 있어 임베딩 힌트가 스키마 변경에 취약하다. 관계 수는 학생당 한 자릿수라 비용 차이가 없다.
 */
async function listPortalRelations(
  tenantId: string,
  studentId: string,
): Promise<PortalRelationItem[]> {
  const db = createServiceClient();
  if (!db) return [];

  const { data: relations, error } = await db
    .from("portal_relations")
    .select("id, contact_id, role, status, invited_at, accepted_at")
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId)
    .neq("status", "revoked")
    .order("invited_at", { ascending: false });
  if (error) {
    console.error("[students] portal relation list failed", error);
    return [];
  }
  const rows = (relations ?? []) as {
    id: string;
    contact_id: string;
    role: PortalRelationItem["role"];
    status: PortalRelationItem["status"];
    invited_at: string;
    accepted_at: string | null;
  }[];
  if (rows.length === 0) return [];

  const contactIds = [...new Set(rows.map((r) => r.contact_id))];
  const relationIds = rows.map((r) => r.id);
  const [{ data: contacts }, { data: links }] = await Promise.all([
    db
      .from("portal_contacts")
      .select("id, name, phone")
      .eq("tenant_id", tenantId)
      .in("id", contactIds),
    // revoked_at is null = 지금 쓸 수 있는 링크. 관계당 최대 하나임을 DB 부분 유니크가 보장한다.
    db
      .from("portal_access_links")
      .select("relation_id")
      .eq("tenant_id", tenantId)
      .in("relation_id", relationIds)
      .is("revoked_at", null),
  ]);

  const contactById = new Map(
    ((contacts ?? []) as { id: string; name: string; phone: string }[]).map((c) => [
      c.id,
      c,
    ]),
  );
  const linkedRelations = new Set(
    ((links ?? []) as { relation_id: string }[]).map((l) => l.relation_id),
  );

  return rows.map((r) => {
    const contact = contactById.get(r.contact_id);
    return {
      relationId: r.id,
      role: r.role,
      status: r.status,
      name: contact?.name ?? "(이름 없음)",
      phone: contact?.phone ?? "",
      invitedAt: r.invited_at,
      acceptedAt: r.accepted_at,
      hasActiveLink: linkedRelations.has(r.id),
    };
  });
}

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAdminSession();
  if (!session) notFound();

  const student = await getStudent(session.tenantId, id);
  if (!student) notFound();

  const [summary, consents, notifications, materials, portalRelations] =
    await Promise.all([
      getStudentSummary(session.tenantId, id),
      listConsents(session.tenantId, "student", id),
      listStudentNotifications(session.tenantId, id, 10),
      listMaterials(session.tenantId, id),
      listPortalRelations(session.tenantId, id),
    ]);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-xl font-black tracking-tight">
            {student.name}
            <Badge tone={studentStatusTone(student.status)}>
              {studentStatusLabel(student.status)}
            </Badge>
          </h1>
          <p className="mt-1 text-sm text-muted">
            {classTypeLabel(student.classType)}
            {student.subjectType && ` · ${student.subjectType}`} ·{" "}
            {formatKDate(student.createdAt)} 등록
          </p>
        </div>
        <Link
          href="/admin/students"
          className="text-sm font-bold text-muted hover:text-ink"
        >
          ← 목록으로
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {student.status === "ended" && (
            /* E-05 재등록 확인 — 종료 등록은 수정 폼으로 되돌리지 않는다(서버 가드).
               관계·결제·일정 재확인 + 사유를 거쳐야 활성 전환되며, adjustments(enrollment)에
               재등록 이력이 남는다. 완전한 새 등록 엔티티 생성은 M2 몫. */
            <Card>
              <h2 className="mb-2 text-sm font-black text-ink-soft">재등록 확인</h2>
              <p className="mb-4 text-xs leading-relaxed text-muted">
                종료된 등록은 다시 활성화하지 않고 새 등록으로 처리하는 것이 원칙입니다.
                아래 항목을 실제로 다시 확인한 뒤 재등록해 주세요. 재등록 내역은
                조정 이력으로 기록되어 되돌릴 수 없습니다.
              </p>
              <SubmitForm action={reEnrollStudent} submitLabel="재등록">
                <input type="hidden" name="id" value={student.id} />
                <div className="space-y-3">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      name="relationConfirmed"
                      className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-200"
                    />
                    <span className="text-sm font-bold text-ink-soft">
                      본인·보호자 관계를 다시 확인했습니다
                    </span>
                  </label>
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      name="paymentConfirmed"
                      className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-200"
                    />
                    <span className="text-sm font-bold text-ink-soft">
                      수강료·결제 조건을 다시 확인했습니다
                    </span>
                  </label>
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      name="scheduleConfirmed"
                      className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-200"
                    />
                    <span className="text-sm font-bold text-ink-soft">
                      수업 일정을 다시 확인했습니다
                    </span>
                  </label>
                  <Field label="재등록 사유" required>
                    <Textarea
                      name="reason"
                      rows={2}
                      placeholder="예: 겨울방학 복귀 — 주 2회 대면 수업으로 재개"
                    />
                  </Field>
                </div>
              </SubmitForm>
            </Card>
          )}

          <Card>
            <h2 className="mb-4 text-sm font-black text-ink-soft">기본 정보</h2>
            {student.status === "ended" && (
              <p className="mb-4 rounded-lg bg-soft px-3 py-2 text-xs leading-relaxed text-muted">
                종료된 등록은 이 폼에서 상태를 되돌릴 수 없습니다. 다시 수업을 시작하려면
                위의 재등록 확인 절차를 이용해 주세요.
              </p>
            )}
            <SubmitForm action={updateStudent} submitLabel="저장">
              <input type="hidden" name="id" value={student.id} />
              <StudentFormFields student={student} />
            </SubmitForm>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-black text-ink-soft">최근 수업 기록</h2>
              <Link
                href={`/admin/lessons?student=${student.id}`}
                className="text-xs font-bold text-brand-700 hover:underline"
              >
                전체 보기 →
              </Link>
            </div>
            {summary.lessons.length === 0 ? (
              <p className="text-sm text-muted">수업 기록이 없습니다.</p>
            ) : (
              <ul className="space-y-3">
                {summary.lessons.map((l) => (
                  <li
                    key={l.id}
                    className="border-b border-line pb-3 last:border-0 last:pb-0"
                  >
                    <p className="text-sm font-bold">
                      {l.sessionNumber}회차 · {formatKDate(l.lessonDate)}
                      {l.absent && (
                        <Badge tone="danger" className="ml-2">
                          결석
                        </Badge>
                      )}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted">{l.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-black text-ink-soft">최근 성적</h2>
              <Link
                href={`/admin/grades?student=${student.id}`}
                className="text-xs font-bold text-brand-700 hover:underline"
              >
                전체 보기 →
              </Link>
            </div>
            {summary.grades.length === 0 ? (
              <p className="text-sm text-muted">성적 기록이 없습니다.</p>
            ) : (
              <ul className="space-y-3">
                {summary.grades.map((g) => (
                  <li
                    key={g.id}
                    className="flex items-center justify-between border-b border-line pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm font-bold">{g.examName}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {formatKDate(g.examDate)}
                      </p>
                    </div>
                    <p className="text-sm font-extrabold">
                      {g.grade ? `${g.grade}등급` : g.rawScore != null ? `${g.rawScore}점` : "-"}
                      {g.percentile != null && (
                        <span className="ml-1 text-xs font-bold text-muted">
                          백분위 {g.percentile}
                        </span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-black text-ink-soft">최근 결제</h2>
              <Link
                href={`/admin/payments?student=${student.id}`}
                className="text-xs font-bold text-brand-700 hover:underline"
              >
                전체 보기 →
              </Link>
            </div>
            {summary.payments.length === 0 ? (
              <p className="text-sm text-muted">결제 내역이 없습니다.</p>
            ) : (
              <ul className="space-y-3">
                {summary.payments.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between border-b border-line pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm font-bold">{formatWon(p.amount)}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {formatKDate(p.periodStart)}~{formatKDate(p.periodEnd)}
                      </p>
                    </div>
                    <Badge tone={p.status === "paid" ? "success" : p.status === "overdue" ? "danger" : "soft"}>
                      {PAYMENT_STATUS_LABEL[p.status] ?? p.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-black text-ink-soft">AI 리포트</h2>
              <Link
                href={`/admin/reports?student=${student.id}`}
                className="text-xs font-bold text-brand-700 hover:underline"
              >
                전체 보기 →
              </Link>
            </div>
            <Link
              href={`/admin/reports/new?student=${student.id}`}
              className="text-sm font-bold text-brand-700 hover:underline"
            >
              + 새 리포트 생성
            </Link>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-black text-ink-soft">알림 이력</h2>
            {notifications.length === 0 ? (
              <p className="text-sm text-muted">발송된 알림이 없습니다.</p>
            ) : (
              <ul className="space-y-3">
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    className="flex items-center justify-between border-b border-line pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm font-bold">{n.type}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {formatKDate(n.sentAt)}
                      </p>
                    </div>
                    <Badge tone={notifyStatusTone(n.status)}>
                      {NOTIFY_STATUS_LABEL[n.status] ?? n.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-black text-ink-soft">자료</h2>
            {materials.length === 0 ? (
              <p className="text-sm text-muted">등록된 자료가 없습니다.</p>
            ) : (
              <ul className="space-y-3">
                {materials.map((m) => (
                  <li
                    key={m.id}
                    className="border-b border-line pb-3 last:border-0 last:pb-0"
                  >
                    <a
                      href={m.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-bold text-brand-700 hover:underline"
                    >
                      {m.name}
                    </a>
                    <p className="mt-0.5 text-xs text-muted">
                      {formatKDate(m.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-black text-ink-soft">동의 내역</h2>
            {consents.length === 0 ? (
              <p className="text-sm text-muted">기록된 동의 내역이 없습니다.</p>
            ) : (
              <ul className="space-y-3">
                {consents.map((c) => (
                  <li
                    key={c.id}
                    className="border-b border-line pb-3 last:border-0 last:pb-0"
                  >
                    <p className="text-sm font-bold">{consentItemLabel(c.item)}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {formatKDate(c.consentedAt)} · {c.policyVersion} · {c.via}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* P-01 역할별 초대 — 학생·보호자·납부자·계약자를 각각 초대하고 권한을 따로 회수한다.
              아래 리포트 링크(portal_token)와 병행 운영이며, 자동 은퇴는 하지 않는다(운영자 판단). */}
          <Card>
            {student.status === "ended" ? (
              <>
                <h2 className="mb-2 text-sm font-black text-ink-soft">포털 관계</h2>
                <p className="rounded-lg bg-soft px-3 py-2 text-xs leading-relaxed text-muted">
                  등록이 종료된 학생에게는 새 초대를 발급할 수 없습니다. 기존 초대 링크도
                  열리지 않습니다. 다시 수업을 시작하려면 재등록 확인 절차를 먼저 진행해 주세요.
                </p>
              </>
            ) : (
              <PortalRelationsCard
                studentId={student.id}
                studentName={student.name}
                studentPhone={student.studentPhone}
                parentPhone={student.parentPhone}
                relations={portalRelations}
                invite={invitePortalRelation}
                resend={resendPortalInvite}
                revoke={revokePortalRelation}
              />
            )}
          </Card>

          <Card>
            <h2 className="mb-2 text-sm font-black text-ink-soft">
              학생·학부모 리포트 링크
            </h2>
            <p className="mb-3 text-xs leading-relaxed text-muted">
              승인된 리포트를 학생·학부모가 이 링크로 조회합니다(읽기 전용).
              링크가 있으면 누구나 열람하니 공유에 주의하세요.
            </p>
            {/* 이 링크는 학생 하나당 하나뿐이라 받는 사람을 구분하지 못한다(학생·보호자가 같은
                링크를 쓴다). 역할별 초대는 사람마다 링크가 갈라져 회수도 사람 단위로 된다.
                기능은 그대로 두고 안내만 덧붙인다 — 전환 시점은 운영자가 정한다. */}
            <p className="mb-3 rounded-lg bg-brand-50 px-3 py-2 text-xs leading-relaxed text-brand-700">
              위의 <strong className="font-black">포털 관계</strong>에서 역할별 초대로
              전환을 권장합니다. 역할별 초대는 받는 사람마다 링크가 달라 권한을 따로 회수할
              수 있습니다. 이 링크는 그대로 계속 쓸 수 있습니다.
            </p>
            {student.status === "ended" ? (
              /* E-04 — 종료 학생은 포털 접근이 회수된다(getStudentByPortalToken의 ended 차단).
                 무효인 링크를 노출해 공유 사고를 만들지 않도록 안내로 대체한다. */
              <p className="rounded-lg bg-soft px-3 py-2 text-xs leading-relaxed text-muted">
                등록 종료로 포털 접근이 회수되었습니다. 기존 링크는 열리지 않으며,
                재등록 확인 절차를 거쳐 활성화되면 다시 사용할 수 있습니다.
              </p>
            ) : student.portalToken ? (
              <PortalLinkCard
                url={`${SITE_URL}/portal/${student.portalToken}`}
                studentId={student.id}
                regenerate={regeneratePortalToken}
              />
            ) : (
              <p className="text-xs text-muted">DB 연결 후 자동 발급됩니다.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
