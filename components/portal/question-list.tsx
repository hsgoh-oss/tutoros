import type { PortalHomeworkQuestion } from "@/lib/data/homework";
import { formatDate } from "./format";

// 질문과 답변 목록 (H-04 · 검수 29) — 본인 질문만, 승인된 답변만.
//
// 미승인 답변 초안은 데이터 계층에서 이미 제거돼 내려오지 않는다(검수 28) — 여기서 거르지 않는다.
// 원 기록 라벨(originLabel)은 호출부가 만든다: 본인에게 노출되는 과제·리포트 범위 안에서만
// 이름을 해석해야 하므로(해석 못 하면 일반 명사로 수렴) 조회 범위를 아는 쪽이 만드는 것이 맞다.

/** 닫힘 = 답변 게시 또는 해결 완료(검수 29) — 판정은 데이터 계층(closed)이 이미 했다. */
function StatusBadge({ question }: { question: PortalHomeworkQuestion }) {
  if (!question.closed) {
    return (
      <span className="rounded-full border border-line bg-soft px-2.5 py-0.5 text-[11px] font-bold text-muted">
        답변 준비 중
      </span>
    );
  }
  return (
    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-700">
      {question.answer ? "답변 완료" : "해결 완료"}
    </span>
  );
}

export function QuestionList({
  questions,
  originLabel,
}: {
  questions: PortalHomeworkQuestion[];
  originLabel: (question: PortalHomeworkQuestion) => string;
}) {
  return (
    <div className="space-y-4">
      {questions.map((q) => (
        <article
          key={q.id}
          className="rounded-card border border-line bg-white p-5 shadow-card"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-extrabold tracking-tight text-brand-700">
              {originLabel(q)}
            </span>
            <StatusBadge question={q} />
            <span className="ml-auto text-xs text-muted">
              {formatDate(q.askedAt)}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">
            {q.question}
          </p>
          {q.answer !== null && (
            <div className="mt-3 rounded-xl bg-brand-50 p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold tracking-tight text-brand-700">
                  선생님 답변
                </span>
                {q.answeredAt && (
                  <span className="text-[11px] text-muted">
                    {formatDate(q.answeredAt)}
                  </span>
                )}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                {q.answer}
              </p>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
