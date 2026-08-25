"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  PortalHomework,
  PortalHomeworkSubmission,
} from "@/lib/data/homework";
import {
  getSubmissionFileUrl,
  submitHomework,
  withdrawSubmission,
} from "@/app/portal/[token]/actions";
import { QuestionForm } from "./question-form";
import { formatDate, formatDateTime } from "./format";

// 포털 과제 카드 (H-02·H-03 학생 접점) — 리포트 카드와 같은 카드 스타일.
//  - 기한 경과여도 제출은 허용하고 "기한 경과"만 표시한다(H-02: 지연 사실 연결, 차단 아님).
//  - 제출 이력은 회차(attempt) 순 전체 보존분 — 재제출해도 이전 제출이 남는다(검수 27).
//  - 피드백은 승인된 것만 내려온다(검수 28) — 미승인 상태는 아예 렌더링할 데이터가 없다.
//  - 재제출 요청(reviewResult=resubmit) 상태면 안내 배지를 띄운다(H-03 분기).
//  - 검토 전 최신 제출은 철회 가능(H-02) — 판정은 서버가 하고, 여기서는 버튼만 조건부 노출.
//  - 파일 재열람은 요청 시 서명 URL 발급(1시간 만료, 자기 제출만 — H-06).

const RESULT_LABEL: Record<string, string> = {
  complete: "완료",
  resubmit: "보완 후 재제출 요청",
};

function FileLink({
  token,
  submissionId,
  fileName,
}: {
  token: string;
  submissionId: string;
  fileName: string;
}) {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        // 팝업 차단 회피 — 클릭 제스처 안에서 창을 먼저 열고, 발급된 서명 URL로 이동시킨다.
        const popup = window.open("about:blank", "_blank");
        try {
          const result = await getSubmissionFileUrl(token, submissionId);
          if (result.ok) {
            if (popup) popup.location.href = result.url;
            else window.location.href = result.url;
          } else {
            popup?.close();
            window.alert(result.error ?? "파일을 열 수 없습니다.");
          }
        } catch {
          popup?.close();
          window.alert("파일 열람 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.");
        } finally {
          setPending(false);
        }
      }}
      className="inline-flex max-w-full items-center gap-1 truncate text-xs font-extrabold tracking-tight text-brand-700 hover:underline disabled:opacity-50"
    >
      {pending ? "링크 발급 중..." : `첨부 파일: ${fileName}`}
    </button>
  );
}

function SubmissionItem({
  token,
  submission,
  isLatest,
  canWithdraw,
}: {
  token: string;
  submission: PortalHomeworkSubmission;
  isLatest: boolean;
  canWithdraw: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const withdrawn = Boolean(submission.withdrawnAt);

  return (
    <li
      className={`rounded-xl border border-line p-4 ${withdrawn ? "bg-soft opacity-70" : "bg-white"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-extrabold tracking-tight text-ink">
          {submission.attemptNo}회차
        </span>
        <span className="text-xs text-muted">
          {formatDateTime(submission.submittedAt)}
        </span>
        {submission.late && (
          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-extrabold text-amber-700">
            기한 경과 제출
          </span>
        )}
        {withdrawn && (
          <span className="rounded-full border border-line bg-white px-2.5 py-0.5 text-[11px] font-bold text-muted">
            철회함 · {formatDateTime(submission.withdrawnAt)}
          </span>
        )}
        {isLatest && !withdrawn && (
          <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-extrabold text-brand-700">
            최신 제출본
          </span>
        )}
      </div>
      {submission.content && (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
          {submission.content}
        </p>
      )}
      {submission.fileName && (
        <div className="mt-2">
          <FileLink
            token={token}
            submissionId={submission.id}
            fileName={submission.fileName}
          />
        </div>
      )}
      {/* 승인된 피드백만 데이터에 존재한다(검수 28) — draft 피드백은 여기 오지 않는다. */}
      {submission.feedback !== null && (
        <div className="mt-3 rounded-xl bg-brand-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-extrabold tracking-tight text-brand-700">
              선생님 피드백
            </span>
            {submission.reviewResult && (
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${
                  submission.reviewResult === "complete"
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-amber-100 text-amber-700"
                }`}
              >
                {RESULT_LABEL[submission.reviewResult] ?? submission.reviewResult}
              </span>
            )}
            {submission.feedbackApprovedAt && (
              <span className="text-[11px] text-muted">
                {formatDate(submission.feedbackApprovedAt)}
              </span>
            )}
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
            {submission.feedback}
          </p>
        </div>
      )}
      {canWithdraw && (
        <div className="mt-3">
          <button
            type="button"
            disabled={pending}
            onClick={async () => {
              if (
                !window.confirm(
                  "이 제출을 철회할까요? 철회해도 제출 이력은 남습니다.",
                )
              ) {
                return;
              }
              setPending(true);
              try {
                const result = await withdrawSubmission(token, submission.id);
                if (result.ok) router.refresh();
                else window.alert(result.error ?? "철회하지 못했습니다.");
              } catch {
                window.alert("철회 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.");
              } finally {
                setPending(false);
              }
            }}
            className="text-xs font-bold text-rose-600 hover:underline disabled:opacity-50"
          >
            {pending ? "철회 중..." : "제출 철회"}
          </button>
        </div>
      )}
    </li>
  );
}

export function HomeworkCard({
  token,
  homework,
  overdue,
}: {
  token: string;
  homework: PortalHomework;
  overdue: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileFailed, setFileFailed] = useState(false);

  const latest = homework.latestSubmission;
  const resubmitRequested = latest?.reviewResult === "resubmit";
  const isOpen = homework.status === "assigned";
  // 철회 버튼: 최신 제출본이고, 아직 게시된 피드백·판정이 없을 때만 노출.
  // 검토 시작 여부는 포털에 내려오지 않으므로 최종 판정은 서버가 한다(H-02).
  const canWithdraw = Boolean(
    isOpen && latest && !latest.withdrawnAt && latest.feedback === null && latest.reviewResult === null,
  );

  async function doSubmit(skipFile: boolean) {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    fd.set("token", token);
    fd.set("assignmentId", homework.id);
    if (skipFile) {
      // 파일 업로드 실패 후 "텍스트만 제출" 선택 — 입력한 텍스트는 그대로 살린다(검수 26 정신).
      fd.delete("file");
      fd.set("skipFile", "1");
    }
    setPending(true);
    setError(null);
    try {
      const result = await submitHomework(fd);
      if (result.ok) {
        form.reset();
        setFileFailed(false);
        router.refresh();
      } else {
        setError(result.error ?? "제출에 실패했습니다.");
        setFileFailed(Boolean(result.fileFailed));
      }
    } catch {
      // 전송 자체가 실패 — 서버 액션 본문 한도 초과(대용량 파일)·네트워크 문제 등.
      // 입력값은 폼에 남아 있으므로, 텍스트가 있고 파일을 붙였다면 텍스트만 제출을 안내한다.
      const fileEntry = fd.get("file");
      const hadFile =
        !skipFile && fileEntry instanceof File && fileEntry.size > 0;
      const hasText = String(fd.get("content") ?? "").trim().length > 0;
      setError(
        hadFile
          ? "제출 요청을 보내지 못했습니다. 첨부 파일이 너무 크거나 네트워크 문제일 수 있어요."
          : "제출 요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
      setFileFailed(hadFile && hasText);
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="rounded-card border border-line bg-white p-6 shadow-card">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-extrabold tracking-tight text-brand-700">
          과제
        </span>
        {homework.status === "closed" && (
          <span className="rounded-full border border-line bg-soft px-3 py-1 text-xs font-bold text-muted">
            종료된 과제
          </span>
        )}
        <span className="ml-auto text-xs text-muted">
          배부 {formatDate(homework.assignedAt)}
        </span>
      </div>

      <h3 className="text-base font-black tracking-tight text-ink">
        {homework.title}
      </h3>
      {homework.description && (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
          {homework.description}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-muted">
          기한: {homework.dueDate ? formatDate(homework.dueDate) : "없음"}
        </span>
        {isOpen && overdue && (
          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-extrabold text-amber-700">
            기한 경과 — 지금도 제출할 수 있어요
          </span>
        )}
      </div>

      {resubmitRequested && (
        <div className="mt-3 rounded-xl bg-amber-50 p-3">
          <p className="text-sm font-bold leading-relaxed text-amber-800">
            선생님이 보완 후 재제출을 요청했어요. 피드백을 확인하고 아래에서 다시
            제출해 주세요.
          </p>
        </div>
      )}

      {homework.submissions.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-extrabold tracking-tight text-muted">
            제출 이력
          </p>
          <ul className="space-y-3">
            {homework.submissions.map((s) => (
              <SubmissionItem
                key={s.id}
                token={token}
                submission={s}
                isLatest={latest?.id === s.id}
                canWithdraw={canWithdraw && latest?.id === s.id}
              />
            ))}
          </ul>
        </div>
      )}

      {isOpen && (
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            void doSubmit(false);
          }}
          className="mt-4 rounded-xl bg-soft p-4"
        >
          <p className="text-xs font-extrabold tracking-tight text-ink">
            {homework.submissions.length > 0 ? "다시 제출하기" : "과제 제출"}
          </p>
          {homework.submissions.length > 0 && (
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              다시 제출해도 이전 제출은 그대로 남고, 새 제출본이 검토 대상이
              됩니다.
            </p>
          )}
          <textarea
            name="content"
            rows={4}
            maxLength={20000}
            placeholder="제출할 내용을 입력해 주세요. (파일만 제출할 때는 비워 두세요)"
            className="mt-2 w-full rounded-xl border border-line bg-white p-3 text-sm leading-relaxed text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          <div className="mt-2">
            <input
              type="file"
              name="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              className="block w-full text-xs text-muted file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-xs file:font-extrabold file:text-brand-700"
            />
            <p className="mt-1 text-[11px] text-muted">
              10MB 이하 · pdf, jpg, png, webp — 텍스트와 파일 중 하나는 꼭 넣어
              주세요.
            </p>
          </div>
          {error && (
            <div className="mt-3 rounded-xl bg-rose-50 p-3">
              <p className="text-sm font-bold leading-relaxed text-rose-600">
                {error}
              </p>
              {fileFailed && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void doSubmit(true)}
                  className="mt-2 text-xs font-extrabold text-brand-700 hover:underline disabled:opacity-50"
                >
                  파일 없이 텍스트만 제출하기
                </button>
              )}
            </div>
          )}
          <button
            type="submit"
            disabled={pending}
            className="mt-3 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-extrabold tracking-tight text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {pending ? "제출 중..." : "제출하기"}
          </button>
        </form>
      )}

      <QuestionForm token={token} assignmentId={homework.id} />
    </article>
  );
}
