import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { formatKDate, formatKDateTime, listLessons, listStudentOptions } from "@/lib/data/crm";
import { getAssignment, type HomeworkSubmission } from "@/lib/data/homework";
import type { HomeworkAnswerStatus, HomeworkQuestionStatus } from "@/lib/types";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Select, Textarea } from "@/components/ui/form";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { ActionButton } from "@/components/admin/crm/action-button";
import {
  answerStatusLabel,
  answerStatusTone,
  feedbackStatusLabel,
  feedbackStatusTone,
  homeworkStatusLabel,
  homeworkStatusTone,
  questionStatusLabel,
  questionStatusTone,
  REVIEW_RESULT_OPTIONS,
  reviewResultLabel,
  reviewResultTone,
  reviewStatusLabel,
  reviewStatusTone,
} from "../constants";
import {
  answerQuestion,
  approveAndResolveQuestion,
  approveAnswer,
  approveFeedback,
  assignAssignment,
  archiveAssignment,
  cancelAssignment,
  closeAssignment,
  resolveQuestion,
  retractAssignment,
  reviewSubmission,
  saveFeedback,
  updateAssignment,
} from "../actions";
import { HomeworkFormFields } from "../homework-form-fields";

// 과제 상세 — 과제 정보 + 제출 이력 타임라인(append-only, 검수 27) + 검토·피드백(검수 28)
// + 질문 스레드(H-04·검수 29) + 배부/철회/종료/취소(H-01·H-07). 정본: 01_atlas_03_learning.md.

const RECENT_LESSON_LIMIT = 60;

/** 이 과제에 연결된 질문 행 — 상세 화면 전용 조회라 페이지에서 직접 읽는다(테넌트+과제 스코프). */
interface AssignmentQuestionRow {
  id: string;
  question: string;
  asked_at: string;
  answer: string | null;
  answer_status: HomeworkAnswerStatus | null;
  answered_at: string | null;
  status: HomeworkQuestionStatus;
}

export default async function HomeworkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAdminSession();
  if (!session) notFound();

  const assignment = await getAssignment(session.tenantId, id);
  if (!assignment) notFound();

  const db = createServiceClient();
  let questions: AssignmentQuestionRow[] = [];
  if (db) {
    const { data } = await db
      .from("homework_questions")
      .select("id, question, asked_at, answer, answer_status, answered_at, status")
      .eq("tenant_id", session.tenantId)
      .eq("assignment_id", assignment.id)
      .order("created_at", { ascending: true });
    questions = (data ?? []) as AssignmentQuestionRow[];
  }

  const isDraft = assignment.status === "draft";
  // 초안 수정 폼에만 학생·수업 옵션이 필요하다(H-01: 게시 후 내용 변경은 새 과제본).
  const [studentOptions, lessons] = isDraft
    ? await Promise.all([
        listStudentOptions(session.tenantId),
        listLessons(session.tenantId),
      ])
    : [[], []];
  const lessonOptions = lessons.slice(0, RECENT_LESSON_LIMIT).map((l) => ({
    id: l.id,
    studentId: l.studentId,
    label: `${l.lessonDate} ${l.sessionNumber}회차 — ${l.studentName}`,
  }));

  const latest = assignment.latestSubmission;
  const unreviewedCount = assignment.submissions.filter(
    (s) => !s.withdrawnAt && s.reviewStatus === "pending",
  ).length;

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-xl font-semibold tracking-tight">
            {assignment.title}
            <Badge tone={homeworkStatusTone(assignment.status)}>
              {homeworkStatusLabel(assignment.status)}
            </Badge>
            {unreviewedCount > 0 && (
              <Badge tone="warning">미검토 제출 {unreviewedCount}건</Badge>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {assignment.studentName ?? "학생 미연결"} · 기한 {formatKDate(assignment.dueDate)} ·{" "}
            {formatKDate(assignment.createdAt)} 생성
            {assignment.assignedAt && ` · ${formatKDate(assignment.assignedAt)} 배부`}
          </p>
        </div>
        <Link href="/admin/homework" className="text-sm font-bold text-muted hover:text-ink">
          ← 목록으로
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink-soft">과제 정보</h2>
            {assignment.description ? (
              <div className="whitespace-pre-wrap rounded-panel bg-soft p-4 text-sm">
                {assignment.description}
              </div>
            ) : (
              <p className="text-sm text-muted">설명 없음</p>
            )}
            <div className="mt-4 space-y-1 text-sm text-muted">
              {assignment.lessonId && (
                <p>
                  원 수업:{" "}
                  <Link
                    href={`/admin/lessons/${assignment.lessonId}`}
                    className="font-bold text-brand-700 hover:underline"
                  >
                    수업 기록 보기 →
                  </Link>
                </p>
              )}
              {assignment.closedAt && (
                <p>
                  {assignment.status === "canceled" ? "취소" : "종료"} 시각:{" "}
                  {formatKDateTime(assignment.closedAt)}
                </p>
              )}
              {assignment.closeNote && <p>{assignment.closeNote}</p>}
            </div>
          </Card>

          {isDraft ? (
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-ink-soft">초안 수정</h2>
              <p className="mb-4 text-xs text-muted">
                초안은 학생·보호자에게 노출되지 않습니다. 배부 후에는 내용을 수정할 수 없고 새
                과제본으로 만들어야 합니다.
              </p>
              <SubmitForm action={updateAssignment} submitLabel="초안 저장">
                <input type="hidden" name="id" value={assignment.id} />
                <HomeworkFormFields
                  studentOptions={studentOptions}
                  lessonOptions={lessonOptions}
                  defaults={{
                    studentId: assignment.studentId,
                    lessonId: assignment.lessonId,
                    title: assignment.title,
                    description: assignment.description,
                    dueDate: assignment.dueDate,
                  }}
                />
              </SubmitForm>
            </Card>
          ) : (
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-ink-soft">내용 변경</h2>
              <p className="text-sm text-muted">
                게시된 과제는 내용을 수정하지 않습니다 — 새 과제본을 만들어 재검토·재배부해
                주세요(기존 과제는 철회·취소·종료로 정리).
              </p>
              <Link
                href={`/admin/homework/new?student=${assignment.studentId}`}
                className={buttonClass("outline", "sm", "mt-4")}
              >
                새 과제본 만들기
              </Link>
            </Card>
          )}

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink-soft">
              제출 이력 타임라인
              <span className="ml-2 font-bold text-muted">
                재제출은 이전 제출을 덮어쓰지 않고 회차로 쌓입니다
              </span>
            </h2>
            {assignment.submissions.length === 0 ? (
              <p className="text-sm text-muted">아직 제출이 없습니다.</p>
            ) : (
              <ol className="space-y-4">
                {assignment.submissions.map((s) => (
                  <SubmissionTimelineItem
                    key={s.id}
                    submission={s}
                    isLatestActive={latest?.id === s.id}
                  />
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink-soft">진행 처리</h2>
            {assignment.status === "draft" && (
              <div className="flex flex-col items-start gap-3">
                <p className="text-sm text-muted">
                  검토를 마쳤으면 배부하세요. 배부 시 학부모에게 포털 링크 알림이 발송됩니다.
                </p>
                <ActionButton
                  action={assignAssignment}
                  id={assignment.id}
                  label="게시·배부"
                  confirmText="이 과제를 게시·배부합니다. 학부모에게 포털 링크 알림이 발송됩니다. 계속할까요?"
                />
                <ActionButton
                  action={cancelAssignment}
                  id={assignment.id}
                  label="과제 취소"
                  tone="danger"
                  confirmText="이 초안 과제를 취소합니다. 취소해도 기록은 삭제되지 않고 보존됩니다. 계속할까요?"
                />
              </div>
            )}
            {assignment.status === "assigned" && (
              <div className="flex flex-col items-start gap-3">
                <ActionButton
                  action={retractAssignment}
                  id={assignment.id}
                  label="배부 철회"
                  confirmText="배부를 철회해 초안으로 되돌립니다(잘못된 배부 정정용). 제출물이 있으면 철회할 수 없습니다. 계속할까요?"
                />
                <ActionButton
                  action={closeAssignment}
                  id={assignment.id}
                  label="전체 종료"
                  confirmText="이 과제를 전체 종료합니다. 미검토 제출이 남아 있으면 종료할 수 없습니다. 계속할까요?"
                />
                <ActionButton
                  action={cancelAssignment}
                  id={assignment.id}
                  label="대상 취소"
                  tone="danger"
                  confirmText="이 과제를 취소합니다. 이미 제출된 답안·피드백은 자동 삭제되지 않고 보존됩니다. 계속할까요?"
                />
                <p className="text-xs text-muted">
                  철회는 제출물이 없을 때만, 종료는 미검토 제출이 없을 때만 가능합니다.
                </p>
              </div>
            )}
            {(assignment.status === "closed" || assignment.status === "canceled") && (
              <div className="flex flex-col items-start gap-3">
                <p className="text-sm text-muted">
                  {assignment.status === "closed" ? "전체 종료" : "취소"}된 과제입니다. 제출물·피드백은
                  보존되며, 내용 변경이 필요하면 새 과제본을 만들어 주세요.
                </p>
                {assignment.archivedAt ? (
                  <p className="text-xs text-muted">
                    보관됨 — 현재 목록에서 접혀 있습니다(파기 아님, 이력 접근 유지 — H-07).
                  </p>
                ) : (
                  <ActionButton
                    action={archiveAssignment}
                    id={assignment.id}
                    label="보관"
                    confirmText="이 과제를 보관합니다. 현재 목록에서 접히지만 파기가 아니며 이력 접근은 유지됩니다. 계속할까요?"
                  />
                )}
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink-soft">최신 제출 검토·피드백</h2>
            {!latest ? (
              <p className="text-sm text-muted">
                검토할 제출이 없습니다. 재제출이 들어오면 새 회차가 최신 검토 대상이 됩니다.
              </p>
            ) : (
              <div className="space-y-5">
                <p className="text-sm font-bold text-ink-soft">
                  {latest.attemptNo}회차 · {formatKDateTime(latest.submittedAt)} 제출
                  {latest.late && (
                    <Badge tone="warning" className="ml-2">
                      지연 제출
                    </Badge>
                  )}
                </p>

                {latest.reviewStatus === "pending" ? (
                  <SubmitForm action={reviewSubmission} submitLabel="검토 확정">
                    <input type="hidden" name="submissionId" value={latest.id} />
                    <Field
                      label="검토 판정"
                      required
                      hint="재제출 요청 판정은 피드백 승인·게시와 함께 포털에 표시됩니다."
                    >
                      <Select name="result" defaultValue="complete">
                        {REVIEW_RESULT_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </SubmitForm>
                ) : (
                  <p className="text-sm">
                    <Badge tone={reviewStatusTone(latest.reviewStatus)}>
                      {reviewStatusLabel(latest.reviewStatus)}
                    </Badge>
                    {latest.reviewResult && (
                      <Badge tone={reviewResultTone(latest.reviewResult)} className="ml-2">
                        {reviewResultLabel(latest.reviewResult)}
                      </Badge>
                    )}
                  </p>
                )}

                <div>
                  <SubmitForm action={saveFeedback} submitLabel="피드백 초안 저장">
                    <input type="hidden" name="submissionId" value={latest.id} />
                    <Field
                      label="피드백"
                      hint="초안은 포털에 노출되지 않습니다. 게시된 피드백을 수정하면 초안으로 내려가 재승인이 필요합니다."
                    >
                      <Textarea
                        name="feedback"
                        defaultValue={latest.feedback ?? ""}
                        placeholder="잘한 점과 보완할 점을 적어 주세요."
                      />
                    </Field>
                  </SubmitForm>
                  <div className="mt-3 flex flex-col items-start gap-2">
                    {latest.feedback && latest.feedbackStatus === "draft" && (
                      <ActionButton
                        action={approveFeedback}
                        id={latest.id}
                        label="피드백 승인·게시"
                        confirmText="피드백을 승인해 포털에 게시합니다. 승인 전에는 학생·보호자에게 보이지 않습니다. 계속할까요?"
                      />
                    )}
                    {latest.feedbackStatus === "approved" && (
                      <p className="text-xs text-muted">
                        피드백 게시됨 · {formatKDateTime(latest.feedbackApprovedAt)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-ink-soft">질문 스레드</h2>
        <p className="mb-4 text-xs text-muted">
          답변 초안은 승인 전 학생·보호자에게 노출되지 않으며, 질문은 답변 게시 또는 해결 완료로
          닫힙니다. 다른 학생에게는 질문 존재 자체가 보이지 않습니다.
        </p>
        {questions.length === 0 ? (
          <p className="text-sm text-muted">이 과제에 연결된 질문이 없습니다.</p>
        ) : (
          <ul className="space-y-6">
            {questions.map((q) => (
              <li key={q.id} className="rounded-panel border border-line p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={questionStatusTone(q.status)}>
                    {questionStatusLabel(q.status)}
                  </Badge>
                  {q.answer_status && (
                    <Badge tone={answerStatusTone(q.answer_status)}>
                      {answerStatusLabel(q.answer_status)}
                    </Badge>
                  )}
                  <span className="text-xs text-muted">
                    {formatKDateTime(q.asked_at)} 질문
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm">{q.question}</p>

                {q.answer && q.answer_status === "approved" && (
                  <div className="mt-3 whitespace-pre-wrap rounded-panel bg-soft p-3 text-sm">
                    {q.answer}
                    <p className="mt-2 text-xs text-muted">
                      {formatKDateTime(q.answered_at)} 답변 게시
                    </p>
                  </div>
                )}

                {q.status === "open" ? (
                  <div className="mt-4">
                    <SubmitForm action={answerQuestion} submitLabel="답변 초안 저장">
                      <input type="hidden" name="questionId" value={q.id} />
                      <Textarea
                        name="answer"
                        defaultValue={q.answer ?? ""}
                        placeholder="답변 초안을 작성해 주세요. 승인 전에는 노출되지 않습니다."
                      />
                    </SubmitForm>
                    <div className="mt-3 flex flex-wrap items-center gap-4">
                      {q.answer && q.answer_status === "draft" && (
                        <>
                          <ActionButton
                            action={approveAnswer}
                            id={q.id}
                            label="답변 게시"
                            confirmText="답변을 승인해 포털에 게시합니다. 계속할까요?"
                          />
                          <ActionButton
                            action={approveAndResolveQuestion}
                            id={q.id}
                            label="게시 후 해결 완료"
                            confirmText="답변을 게시하고 질문을 해결 완료로 닫습니다. 계속할까요?"
                          />
                        </>
                      )}
                      <ActionButton
                        action={resolveQuestion}
                        id={q.id}
                        label="해결 완료로 닫기"
                        confirmText="답변 게시 없이 질문을 해결 완료로 닫습니다. 학습 이력은 유지됩니다. 계속할까요?"
                      />
                    </div>
                  </div>
                ) : (
                  !q.answer_status && (
                    <p className="mt-3 text-xs text-muted">답변 게시 없이 해결 완료로 닫혔습니다.</p>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** 제출 1건 타임라인 항목 — 원문·파일·검토 상태·피드백 상태를 한 줄 이력으로 보여준다. */
function SubmissionTimelineItem({
  submission: s,
  isLatestActive,
}: {
  submission: HomeworkSubmission;
  isLatestActive: boolean;
}) {
  return (
    <li className="rounded-panel border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{s.attemptNo}회차</span>
        {isLatestActive && <Badge tone="brand">최신 검토 대상</Badge>}
        {s.late && <Badge tone="warning">지연 제출</Badge>}
        {s.withdrawnAt ? (
          <Badge tone="soft">철회됨 · {formatKDateTime(s.withdrawnAt)}</Badge>
        ) : (
          <>
            <Badge tone={reviewStatusTone(s.reviewStatus)}>
              {reviewStatusLabel(s.reviewStatus)}
            </Badge>
            {s.reviewResult && (
              <Badge tone={reviewResultTone(s.reviewResult)}>
                {reviewResultLabel(s.reviewResult)}
              </Badge>
            )}
          </>
        )}
        <span className="text-xs text-muted">{formatKDateTime(s.submittedAt)} 제출</span>
      </div>

      {s.content && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-ink-soft">{s.content}</p>
      )}

      {s.fileName &&
        (s.fileUrl ? (
          <p className="mt-3 text-sm">
            <a
              href={s.fileUrl}
              target="_blank"
              rel="noreferrer"
              className="font-bold text-brand-700 hover:underline"
            >
              {s.fileName} 열기 →
            </a>
            <span className="ml-2 text-xs text-muted">열람 링크는 1시간 후 만료됩니다</span>
          </p>
        ) : (
          <p className="mt-3 text-xs text-muted">
            첨부 파일({s.fileName}) 열람 링크 발급 실패 — 새로고침 후 다시 시도해 주세요.
          </p>
        ))}

      {s.feedback && (
        <div className="mt-3 rounded-panel bg-soft p-3 text-sm">
          <p className="mb-1 flex items-center gap-2 text-xs font-bold text-muted">
            피드백
            {s.feedbackStatus && (
              <Badge tone={feedbackStatusTone(s.feedbackStatus)}>
                {feedbackStatusLabel(s.feedbackStatus)}
              </Badge>
            )}
            {s.feedbackApprovedAt && <span>{formatKDateTime(s.feedbackApprovedAt)} 게시</span>}
          </p>
          <p className="whitespace-pre-wrap">{s.feedback}</p>
        </div>
      )}
    </li>
  );
}
