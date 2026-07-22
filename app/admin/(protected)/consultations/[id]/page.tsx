import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { getConsultation, listConsents, formatKDate } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Textarea } from "@/components/ui/form";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { InlineSelect } from "@/components/admin/crm/inline-select";
import {
  CONSULTATION_STATUS_OPTIONS,
  consentItemLabel,
  consultationStatusTone,
} from "../constants";
import {
  sendTrialScheduledNotice,
  updateConsultationMemo,
  updateConsultationStatus,
} from "../actions";
import { ConvertButton } from "../convert-button";
import { ConsultBriefButton } from "../consult-brief-button";

export default async function ConsultationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAdminSession();
  if (!session) notFound();

  const consultation = await getConsultation(session.tenantId, id);
  if (!consultation) notFound();

  const consents = await listConsents(session.tenantId, "consultation", id);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black tracking-tight">{consultation.name}</h1>
          <p className="mt-1 text-sm text-muted">{formatKDate(consultation.createdAt)} 신청</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={consultationStatusTone(consultation.status)}>
            <InlineSelect
              action={updateConsultationStatus}
              id={consultation.id}
              value={consultation.status}
              options={CONSULTATION_STATUS_OPTIONS}
              className="border-none bg-transparent p-0 text-xs font-bold"
            />
          </Badge>
          <ConsultBriefButton consultationId={consultation.id} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <h2 className="mb-4 text-sm font-black text-ink-soft">기본 정보</h2>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-muted">연락처</dt>
                <dd className="font-bold">{consultation.phone}</dd>
              </div>
              <div>
                <dt className="text-muted">과목</dt>
                <dd className="font-bold">{consultation.subject ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-muted">수업 유형</dt>
                <dd className="font-bold">
                  {consultation.classType === "video"
                    ? "화상"
                    : consultation.classType === "inperson"
                      ? "대면"
                      : "-"}
                </dd>
              </div>
              <div>
                <dt className="text-muted">학생 본인 신청</dt>
                <dd className="font-bold">{consultation.isStudentSelf ? "예" : "아니오"}</dd>
              </div>
              {consultation.guardianName && (
                <>
                  <div>
                    <dt className="text-muted">보호자명</dt>
                    <dd className="font-bold">{consultation.guardianName}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">보호자 연락처</dt>
                    <dd className="font-bold">{consultation.guardianPhone ?? "-"}</dd>
                  </div>
                </>
              )}
              {consultation.birthYear && (
                <div>
                  <dt className="text-muted">출생연도</dt>
                  <dd className="font-bold">{consultation.birthYear}</dd>
                </div>
              )}
            </dl>
            {consultation.message && (
              <div className="mt-4 rounded-panel bg-soft p-4 text-sm">
                {consultation.message}
              </div>
            )}
          </Card>

          {consultation.checklistItems.length > 0 && (
            <Card>
              <h2 className="mb-3 text-sm font-black text-ink-soft">자기진단 체크리스트</h2>
              <div className="flex flex-wrap gap-2">
                {consultation.checklistItems.map((item) => (
                  <Badge key={item} tone="soft">
                    {item}
                  </Badge>
                ))}
              </div>
            </Card>
          )}

          {consultation.prefill && (
            <Card>
              <h2 className="mb-3 text-sm font-black text-ink-soft">
                수업료 계산기 프리필
              </h2>
              <dl className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <dt className="text-muted">방식</dt>
                  <dd className="font-bold">{consultation.prefill.mode ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-muted">회당 시간</dt>
                  <dd className="font-bold">{consultation.prefill.hours ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-muted">주당 횟수</dt>
                  <dd className="font-bold">{consultation.prefill.freq ?? "-"}</dd>
                </div>
              </dl>
            </Card>
          )}

          <Card>
            <h2 className="mb-3 text-sm font-black text-ink-soft">메모</h2>
            <SubmitForm action={updateConsultationMemo} submitLabel="메모 저장">
              <input type="hidden" name="id" value={consultation.id} />
              <Textarea
                name="memo"
                defaultValue={consultation.memo ?? ""}
                placeholder="상담 관련 메모를 남겨 주세요."
              />
            </SubmitForm>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 text-sm font-black text-ink-soft">학생 전환</h2>
            {consultation.studentId ? (
              <div className="space-y-3">
                <p className="text-sm text-muted">이미 학생으로 전환되었습니다.</p>
                <Link
                  href={`/admin/students/${consultation.studentId}`}
                  className="text-sm font-bold text-brand-700 hover:underline"
                >
                  학생 상세 보기 →
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted">
                  등록 확정 시 학생 정보를 자동으로 생성하고 이 상담과 연결합니다.
                </p>
                <ConvertButton consultationId={consultation.id} />
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-black text-ink-soft">시범수업 확정 안내</h2>
            <p className="mb-3 text-sm text-muted">
              일시를 입력하고 발송하면 학부모({consultation.guardianPhone ?? consultation.phone})에게
              시범수업 확정 알림톡(실패 시 SMS)이 전송됩니다.
            </p>
            <SubmitForm action={sendTrialScheduledNotice} submitLabel="확정 안내 발송">
              <input type="hidden" name="id" value={consultation.id} />
              <Field label="시범수업 일시">
                <Input
                  name="date"
                  placeholder="예: 8월 20일(수) 오후 5시"
                  required
                />
              </Field>
            </SubmitForm>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-black text-ink-soft">동의 내역</h2>
            {consents.length === 0 ? (
              <p className="text-sm text-muted">기록된 동의 내역이 없습니다.</p>
            ) : (
              <ul className="space-y-3">
                {consents.map((c) => (
                  <li key={c.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
                    <p className="text-sm font-bold">{consentItemLabel(c.item)}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {formatKDate(c.consentedAt)} · {c.policyVersion} · {c.via}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
