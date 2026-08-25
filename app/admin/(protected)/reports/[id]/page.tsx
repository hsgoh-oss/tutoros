import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { formatKDate, formatKDateTime, getStudent } from "@/lib/data/crm";
import { getReport, listReplacedReports } from "@/lib/data/reports";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Textarea } from "@/components/ui/form";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { ActionButton } from "@/components/admin/crm/action-button";
import {
  reportAudienceLabel,
  reportDeliveryLabel,
  reportDeliveryTone,
  reportStatusLabel,
  reportStatusTone,
  reportTypeLabel,
} from "../constants";
import { approveReport, createReport, retractReport, sendReport, updateReportContent } from "../actions";
import { validateReportContent } from "@/lib/ai/validate";

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAdminSession();
  if (!session) notFound();

  const report = await getReport(session.tenantId, id);
  if (!report) notFound();

  const student = report.studentId ? await getStudent(session.tenantId, report.studentId) : null;
  // G-03 대체 연결 표시 — 이 본이 대체한 이전 본(철회본) 목록.
  const replaced = await listReplacedReports(session.tenantId, id);
  // 업무 상태(승인)와 전달 상태를 분리 판정(N-02) — 발송 실패해도 승인 상태는 유지되므로
  // 전달 상태가 미발송(none)·실패(failed)일 때 발송 버튼을 노출한다. queued는 크론 발송 예정(중복 방지).
  const canSend =
    report.audience !== "internal" &&
    (report.status === "approved" || report.status === "sent") &&
    (report.deliveryStatus === "none" || report.deliveryStatus === "failed");
  // G-03 철회 — 게시(승인·발송)된 본만 대상. 초안은 승인하지 않으면 노출되지 않고, 철회본은 이미 철회됐다.
  const canRetract = report.status === "approved" || report.status === "sent";
  // G-03 정정본 생성(이전 본 대체) — 게시된 본, 또는 아직 대체 연결이 없는 철회본(철회 후 재공개 경로).
  // 상담 브리핑·내부용은 포털 게시 흐름 밖이라 createReport의 신규 생성 제약과 동일하게 제외한다.
  const canRevise =
    !!report.studentId &&
    report.type !== "consult_brief" &&
    report.audience !== "internal" &&
    !report.supersededBy &&
    (canRetract || report.status === "retracted");

  // 룰 검증(기획서 7-3 ①) — 발송 시에도 재검사하지만, 선생님이 승인 전에 고칠 수 있게 여기서 먼저 보여 준다.
  const issues = validateReportContent(report.content, {
    studentName: student?.name,
    audience: report.audience,
  });
  const blockingIssues = issues.filter((i) => i.level === "block");
  const warnIssues = issues.filter((i) => i.level === "warn");

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-xl font-black tracking-tight">
            {reportTypeLabel(report.type)} 리포트
            <Badge tone={reportStatusTone(report.status)}>{reportStatusLabel(report.status)}</Badge>
            {/* 전달 상태 뱃지 — 업무 상태와 분리 표시. 미발송(none)은 헤더에서 생략(초안·내부용 소음 방지). */}
            {report.deliveryStatus !== "none" && (
              <Badge tone={reportDeliveryTone(report.deliveryStatus)}>
                {reportDeliveryLabel(report.deliveryStatus)}
              </Badge>
            )}
            {/* G-03 이전본 대체 표시 — 이 본을 대체한 정정 최신본으로 연결한다. */}
            {report.supersededBy && (
              <Link
                href={`/admin/reports/${report.supersededBy}`}
                className="text-sm font-bold text-brand-700 hover:underline"
              >
                최신본 보기 →
              </Link>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {student?.name ?? "학생 미연결"} · {reportAudienceLabel(report.audience)} ·{" "}
            {report.depth === "deep" ? "심화" : "기본"} · {formatKDate(report.createdAt)} 생성
            {report.modelUsed && ` · ${report.modelUsed}`}
          </p>
        </div>
        <Link href="/admin/reports" className="text-sm font-bold text-muted hover:text-ink">
          ← 목록으로
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <h2 className="mb-3 text-sm font-black text-ink-soft">내용 미리보기 · 수정</h2>
            {/* 발송 완료본은 수정 금지, 철회본은 이력 보존(본문 덮어쓰기 금지 — 정정은 새 리포트) — 읽기 전용. */}
            {report.status === "sent" || report.status === "retracted" ? (
              <div className="whitespace-pre-wrap rounded-panel bg-soft p-4 text-sm">
                {report.content}
              </div>
            ) : (
              <SubmitForm action={updateReportContent} submitLabel="저장">
                <input type="hidden" name="id" value={report.id} />
                <Textarea name="content" defaultValue={report.content} className="min-h-72" />
              </SubmitForm>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {issues.length > 0 && (
            <Card>
              <h2 className="mb-3 text-sm font-black text-ink-soft">품질 검사</h2>
              <ul className="space-y-3">
                {[...blockingIssues, ...warnIssues].map((issue) => (
                  <li key={issue.rule} className="text-sm">
                    <Badge tone={issue.level === "block" ? "danger" : "warning"}>
                      {issue.level === "block" ? "발송 차단" : "확인 권장"}
                    </Badge>
                    <p className="mt-1.5 leading-relaxed text-ink-soft">{issue.message}</p>
                    {issue.excerpt && (
                      <p className="mt-1 break-all text-xs text-muted">해당 표현: {issue.excerpt}</p>
                    )}
                  </li>
                ))}
              </ul>
              {blockingIssues.length > 0 && (
                <p className="mt-4 text-xs font-bold text-rose-600">
                  차단 항목이 남아 있으면 발송되지 않습니다. 본문을 수정한 뒤 다시 저장해 주세요.
                </p>
              )}
            </Card>
          )}

          <Card>
            <h2 className="mb-3 text-sm font-black text-ink-soft">발송 처리</h2>
            {report.status === "retracted" ? (
              // G-03 — 철회본은 승인·발송 경로가 모두 닫힌다(재활성 금지). 재공개는 정정본 생성으로만.
              <p className="text-sm text-muted">
                철회된 리포트입니다. 포털에서 비노출되며 재승인·재발송할 수 없습니다. 정정이
                필요하면 정정본을 생성해 주세요.
              </p>
            ) : (
              <>
                <p className="mb-4 text-sm text-muted">
                  초안을 검토한 뒤 승인하고, 승인된 리포트만 실제 발송할 수 있습니다.
                </p>
                <div className="flex flex-col items-start gap-3">
                  {report.status === "draft" && (
                    <ActionButton
                      action={approveReport}
                      id={report.id}
                      label="승인"
                      confirmText="이 리포트를 승인하시겠습니까?"
                    />
                  )}
                  {report.audience === "internal" ? (
                    <p className="text-xs text-muted">내부용 리포트는 발송 대상이 없습니다.</p>
                  ) : canSend ? (
                    <>
                      {report.deliveryStatus === "failed" && (
                        <p className="text-xs font-bold text-rose-600">
                          이전 발송이 실패했습니다. 다시 시도해 주세요. (리포트는 승인 상태로 유지됩니다)
                        </p>
                      )}
                      <ActionButton
                        action={sendReport}
                        id={report.id}
                        label={report.deliveryStatus === "failed" ? "재발송" : "발송"}
                        confirmText="실명 복원 후 발송합니다. 계속할까요?"
                      />
                    </>
                  ) : report.deliveryStatus === "queued" ? (
                    <p className="text-xs text-muted">
                      발송 대기 중 — 다음 발송 슬롯에서 자동 발송됩니다.
                    </p>
                  ) : report.deliveryStatus === "sent" ? (
                    <p className="text-xs text-muted">{formatKDate(report.sentAt)} 발송 완료</p>
                  ) : (
                    <p className="text-xs text-muted">승인 후 발송할 수 있습니다.</p>
                  )}
                </div>
              </>
            )}
          </Card>

          {/* G-03 철회 정보 — 철회된 행이 곧 철회 이력: 시각·사유를 그대로 보여 준다. */}
          {report.status === "retracted" && (
            <Card>
              <h2 className="mb-3 text-sm font-black text-ink-soft">철회 정보</h2>
              <p className="text-sm text-ink-soft">{formatKDateTime(report.retractedAt)} 철회</p>
              <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted">
                사유: {report.retractReason ?? "-"}
              </p>
              {report.supersededBy && (
                <Link
                  href={`/admin/reports/${report.supersededBy}`}
                  className="mt-3 inline-block text-sm font-bold text-brand-700 hover:underline"
                >
                  이 본을 대체한 최신본 보기 →
                </Link>
              )}
            </Card>
          )}

          {/* G-03 대체 연결 — 이 리포트가 정정본으로 대체한 이전 본(철회본) 이력. */}
          {replaced.length > 0 && (
            <Card>
              <h2 className="mb-3 text-sm font-black text-ink-soft">대체한 이전 본</h2>
              <ul className="space-y-2">
                {replaced.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/admin/reports/${r.id}`}
                      className="text-sm font-bold text-brand-700 hover:underline"
                    >
                      {reportTypeLabel(r.type)} · {formatKDate(r.createdAt)} 생성본 →
                    </Link>
                    <span className="ml-2 text-xs text-muted">
                      {formatKDate(r.retractedAt)} 철회
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* G-03 철회 · 정정 — 게시본의 철회와 정정본 생성(이전 본 대체) 진입점. */}
          {(canRetract || canRevise) && (
            <Card>
              <h2 className="mb-3 text-sm font-black text-ink-soft">철회 · 정정</h2>
              {canRetract && (
                <>
                  <p className="mb-3 text-sm text-muted">
                    철회하면 포털 열람이 즉시 차단되고 발송 대기 중인 알림은 회수됩니다. 행과
                    사유는 철회 이력으로 보존됩니다.
                  </p>
                  <SubmitForm action={retractReport} submitLabel="철회" pendingLabel="철회 중...">
                    <input type="hidden" name="id" value={report.id} />
                    <Field label="철회 사유" required>
                      <Textarea
                        name="reason"
                        placeholder="예: 성적 입력 오류로 내용이 사실과 다름"
                        className="min-h-20"
                      />
                    </Field>
                  </SubmitForm>
                </>
              )}
              {canRevise && (
                <div className={canRetract ? "mt-6 border-t border-line pt-5" : undefined}>
                  <p className="mb-3 text-sm text-muted">
                    정정본 생성은 최근 수업·성적 데이터로 새 AI 초안을 만들고, 이 본을 철회
                    처리한 뒤 대체 연결합니다. 새 본은 재승인 후에야 포털에 게시됩니다.
                  </p>
                  <SubmitForm
                    action={createReport}
                    submitLabel="정정본 생성 (이전 본 대체)"
                    pendingLabel="생성 중..."
                    redirectTo="/admin/reports"
                  >
                    <input type="hidden" name="studentId" value={report.studentId ?? ""} />
                    <input type="hidden" name="type" value={report.type} />
                    <input type="hidden" name="audience" value={report.audience} />
                    <input type="hidden" name="depth" value={report.depth} />
                    <input type="hidden" name="supersedes" value={report.id} />
                  </SubmitForm>
                </div>
              )}
            </Card>
          )}

          {student && (
            <Card>
              <h2 className="mb-3 text-sm font-black text-ink-soft">연결 학생</h2>
              <Link
                href={`/admin/students/${student.id}`}
                className="text-sm font-bold text-brand-700 hover:underline"
              >
                {student.name} →
              </Link>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
