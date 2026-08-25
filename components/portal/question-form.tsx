"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { askQuestion } from "@/app/portal/[token]/actions";

// 질문 남기기 폼 — 과제 카드·리포트 카드에 접혀 있다가 펼쳐진다.
// 질문은 반드시 원 기록(assignmentId 또는 reportId)과 연결되어 접수된다(검수 29).
// 접수 후 답변은 선생님 승인(게시)된 것만 포털에 나타난다(검수 28) — 안내 문구로 알려준다.
export function QuestionForm({
  token,
  studentId,
  assignmentId,
  reportId,
}: {
  token: string;
  /** 세션 경로에서 대상 학생을 특정한다(한 사람이 학생 역할을 둘 이상 가질 때 — 검수 16). */
  studentId?: string;
  assignmentId?: string;
  reportId?: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit() {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    fd.set("token", token);
    if (studentId) fd.set("studentId", studentId);
    if (assignmentId) fd.set("assignmentId", assignmentId);
    if (reportId) fd.set("reportId", reportId);
    setPending(true);
    setError(null);
    try {
      const result = await askQuestion(fd);
      if (result.ok) {
        form.reset();
        setOpen(false);
        setDone(true);
        router.refresh();
      } else {
        setError(result.error ?? "질문 접수에 실패했습니다.");
      }
    } catch {
      // 전송 자체가 실패(네트워크 등) — 입력한 질문은 폼에 그대로 남는다.
      setError("질문을 전송하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-4 border-t border-line pt-3">
      {done && (
        <p className="mb-2 text-xs font-bold leading-relaxed text-emerald-700">
          질문이 접수되었습니다. 선생님 답변이 게시되면 아래 질문과 답변에서 확인할
          수 있어요.
        </p>
      )}
      {!open ? (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setDone(false);
          }}
          className="text-xs font-extrabold tracking-tight text-brand-700 hover:underline"
        >
          질문 남기기
        </button>
      ) : (
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <textarea
            name="question"
            rows={3}
            required
            maxLength={2000}
            placeholder="궁금한 점을 남겨 주세요. 선생님이 확인 후 답변해 드려요."
            className="w-full rounded-xl border border-line bg-white p-3 text-sm leading-relaxed text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          {error && (
            <p className="mt-2 text-xs font-bold text-rose-600">{error}</p>
          )}
          <div className="mt-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-full bg-brand-600 px-4 py-2 text-xs font-extrabold tracking-tight text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {pending ? "접수 중..." : "질문 보내기"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="text-xs font-bold text-muted hover:underline disabled:opacity-50"
            >
              취소
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
