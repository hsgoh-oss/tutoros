import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { formatKDate, hasDb, listConsultations, listStudentOptions } from "@/lib/data/crm";
import { getSeatAvailability, listEnrollments, listForms } from "@/lib/data/intake";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Select } from "@/components/ui/form";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import { FilterChips } from "@/components/admin/crm/filter-chips";
import { Toolbar } from "@/components/admin/crm/toolbar";
import { createEnrollment } from "./actions";
import {
  ENROLLMENT_STATUS_OPTIONS,
  GATE_PENDING_LABEL,
  enrollmentStatusLabel,
  enrollmentStatusTone,
  isEnrollmentStatus,
} from "./constants";

// 정규 등록 목록 (R-04 · R-05) — 정본: docs/flow-canon/01_atlas_01_intake.md, 검수 12·13·14.
//
// 이 화면이 답하는 질문은 "누가 등록 준비 중이고, 무엇이 남았는가"다. 그래서 목록의 주인공은
// 상태가 아니라 남은 게이트다 — 준비 중 행은 미완 조건을 그대로 배지로 세워, 오늘 할 일이
// 목록에서 바로 읽히게 한다(R-04 "미완료 원인별 운영자 업무").

export default async function EnrollmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const session = await getAdminSession();
  const connected = hasDb();

  // 상태 필터는 화면에서 건다 — 집계 카드가 전체를 보고, 표만 좁힌다(같은 목록을 두 번 읽지 않는다).
  const all = session ? await listEnrollments(session.tenantId) : [];
  const filterStatus = isEnrollmentStatus(status) ? status : undefined;
  const rows = filterStatus ? all.filter((e) => e.status === filterStatus) : all;

  const pendingCount = all.filter((e) => e.status === "pending").length;
  const readyCount = all.filter(
    (e) => e.status === "pending" && e.pendingGates.length === 0,
  ).length;
  const activeCount = all.filter((e) => e.status === "active").length;

  // O-04 정원 — 정본 R-04가 세는 네 번째 조건(정원 확보)은 등록 행의 플래그가 아니라 이 산정이다.
  const seats = session
    ? await getSeatAvailability(session.tenantId)
    : { seatCount: null, remainingSeats: null, activeEnrollments: 0, openOffers: 0, overbooked: false };

  const studentOptions = session ? await listStudentOptions(session.tenantId) : [];
  const consultations = session ? await listConsultations(session.tenantId) : [];
  // R-01: 등록의 근거가 되는 것은 '제출된' 정규 신청폼뿐이다(발송·마감·만료는 근거가 아니다).
  const submittedForms = session
    ? await listForms(session.tenantId, { kind: "regular", status: "submitted" })
    : [];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">정규 등록</h1>
        <p className="mt-1 text-sm text-muted">
          관계·계약·결제·일정 네 조건이 모두 확인돼야 등록이 활성화됩니다(R-04). 조건이 남아 있는
          동안에는 &lsquo;등록 준비 중&rsquo;이며 확정 수업으로 안내하지 않습니다.
        </p>
      </div>

      {!connected && <DbBanner />}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs font-bold text-muted">등록 준비 중</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-amber-600">{pendingCount}</p>
          <p className="mt-1 text-xs text-muted">네 조건 확인 대기</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-muted">활성화 가능</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-brand-700">{readyCount}</p>
          <p className="mt-1 text-xs text-muted">네 조건 충족 — 활성화만 남음</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-muted">활성 등록</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-emerald-600">{activeCount}</p>
          <p className="mt-1 text-xs text-muted">지금 자리를 쓰고 있는 등록</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-muted">남은 자리</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-ink">
            {seats.seatCount === null ? "미설정" : `${seats.remainingSeats ?? 0}`}
          </p>
          <p className="mt-1 text-xs text-muted">
            {seats.seatCount === null
              ? "모집 현황에서 정원을 정하면 계산됩니다"
              : `정원 ${seats.seatCount} · 활성 ${seats.activeEnrollments} · 열린 제안 ${seats.openOffers}`}
          </p>
          {seats.overbooked && (
            <p className="mt-1 text-xs font-bold text-rose-600">
              정원 초과 — 기존 등록·유효한 제안은 그대로 두고 새 제안만 중단합니다(검수 63).
            </p>
          )}
        </Card>
      </div>

      {studentOptions.length > 0 && (
        <Card className="mb-6">
          <h2 className="text-sm font-semibold text-ink-soft">등록 만들기</h2>
          <p className="mt-1 mb-3 text-sm text-muted">
            학생을 연결해 <strong>등록 준비 중</strong> 상태로 만듭니다. 네 게이트는 모두 미완으로
            시작하며, 여기서 활성화되는 것은 없습니다. 제출된 정규 신청폼을 고르면 그 폼의 상담이
            함께 연결됩니다(R-01).
          </p>
          <SubmitForm action={createEnrollment} submitLabel="등록 준비 시작">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="학생" required>
                <Select name="studentId" required defaultValue="">
                  <option value="">학생 선택</option>
                  {studentOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="정규 신청폼" hint="제출된 폼만 근거가 됩니다">
                <Select name="formId" defaultValue="">
                  <option value="">선택 안 함</option>
                  {submittedForms.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.consultationName ?? "이름 없음"} · {formatKDate(f.submittedAt)} 제출
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="상담" hint="폼을 고르면 그 폼의 상담이 우선합니다">
                <Select name="consultationId" defaultValue="">
                  <option value="">선택 안 함</option>
                  {consultations.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.phone}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </SubmitForm>
        </Card>
      )}

      <Toolbar>
        <FilterChips
          basePath="/admin/enrollments"
          paramKey="status"
          current={filterStatus}
          options={ENROLLMENT_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
      </Toolbar>

      {rows.length === 0 ? (
        <EmptyState
          title="등록이 없습니다"
          description={
            studentOptions.length > 0
              ? "위의 '등록 만들기'에서 학생을 연결해 등록 준비를 시작할 수 있습니다."
              : "학생을 먼저 등록하면 정규 등록을 만들 수 있습니다."
          }
          action={
            studentOptions.length === 0 ? (
              <Link href="/admin/students/new" className={buttonClass("outline", "sm")}>
                학생 등록
              </Link>
            ) : undefined
          }
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>학생</Th>
                <Th>상태</Th>
                <Th>남은 조건</Th>
                <Th>생성</Th>
                <Th>활성·종료</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <Td>
                    <Link
                      href={`/admin/enrollments/${e.id}`}
                      className="font-bold text-ink hover:text-brand-600"
                    >
                      {e.studentName ?? "알 수 없음"}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={enrollmentStatusTone(e.status)}>
                      {enrollmentStatusLabel(e.status)}
                    </Badge>
                  </Td>
                  <Td>
                    {e.status !== "pending" ? (
                      <span className="text-xs text-muted">-</span>
                    ) : e.pendingGates.length === 0 ? (
                      <span className="text-xs font-bold text-brand-700">
                        네 조건 충족 — 활성화 대기
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {e.pendingGates.map((gate) => (
                          <Badge key={gate} tone="warning">
                            {GATE_PENDING_LABEL[gate]}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </Td>
                  <Td className="text-xs text-muted">{formatKDate(e.createdAt)}</Td>
                  <Td className="text-xs text-muted">
                    {e.activatedAt ? `활성 ${formatKDate(e.activatedAt)}` : "-"}
                    {e.endedAt && (
                      <>
                        <br />
                        {`종료 ${formatKDate(e.endedAt)}${e.endReason ? ` · ${e.endReason}` : ""}`}
                      </>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
