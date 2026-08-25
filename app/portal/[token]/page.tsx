import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  formatKDate,
  getStudentByPortalToken,
  listPortalReports,
} from "@/lib/data/crm";
import {
  listPortalAssignments,
  listPortalQuestions,
  type PortalHomeworkQuestion,
} from "@/lib/data/homework";
import { restore } from "@/lib/ai/pseudonym";
import { HomeworkCard } from "@/components/portal/homework-card";
import { QuestionForm } from "@/components/portal/question-form";
import { kstToday } from "@/components/portal/format";

// 네이티브 학생/학부모 포털 (Notion API 대체 — 기획 7-10 · 과제 H-02·H-04).
// 비공개 토큰 링크로 접근. 검색 색인 금지.
//  - 리포트: 승인된 것만 읽기 전용 조회.
//  - 과제: 배부(assigned)·종료(closed)만 노출(draft·canceled 비노출 — H-01·H-07).
//    제출·재제출·철회·질문은 서버 액션(actions.ts)이 토큰 스코프로 처리한다.
//  - 피드백·답변: 승인된 것만 렌더링 — 미승인분은 데이터 계층에서 이미 걸러져
//    존재 자체가 내려오지 않는다(검수 28 · lib/data/homework.ts).
//
// 저장된 리포트 본문은 가명(김○○) 상태다 — AI에 실명을 넘기지 않기 위해서다.
// 실명 복원은 최종 렌더링 서버에서만 한다(AI 리포트 기획안 v1.0 §15).
export const metadata: Metadata = {
  title: "학습 포털",
  robots: { index: false, follow: false },
};

const TYPE_LABEL: Record<string, string> = {
  lesson: "수업 리포트",
  weekly: "주간 리포트",
  monthly: "월간 리포트",
  exam: "시험 리포트",
};

/** 질문 상태 라벨 — 닫힘은 답변 게시 또는 해결 완료(검수 29). */
function questionStatusBadge(q: PortalHomeworkQuestion) {
  if (!q.closed) {
    return (
      <span className="rounded-full border border-line bg-soft px-2.5 py-0.5 text-[11px] font-bold text-muted">
        답변 준비 중
      </span>
    );
  }
  return (
    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-700">
      {q.answer ? "답변 완료" : "해결 완료"}
    </span>
  );
}

export default async function PortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const student = await getStudentByPortalToken(token);
  if (!student) notFound();

  const [reports, assignments, questions] = await Promise.all([
    listPortalReports(student.tenantId, student.id),
    listPortalAssignments(student.tenantId, student.id),
    listPortalQuestions(student.tenantId, student.id),
  ]);
  const today = kstToday();

  // 질문의 원 기록 라벨 — 본인에게 노출되는 과제·리포트 범위 안에서만 해석한다.
  const assignmentTitle = new Map(assignments.map((a) => [a.id, a.title]));
  const reportLabel = new Map(
    reports.map((r) => [
      r.id,
      `${TYPE_LABEL[r.type] ?? r.type} (${formatKDate(r.createdAt)})`,
    ]),
  );
  const questionOrigin = (q: PortalHomeworkQuestion): string => {
    if (q.assignmentId) {
      return `과제 · ${assignmentTitle.get(q.assignmentId) ?? "과제"}`;
    }
    if (q.reportId) return `리포트 · ${reportLabel.get(q.reportId) ?? "리포트"}`;
    if (q.lessonId) return "수업";
    return "질문";
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-5 py-12">
      <header className="mb-8">
        <p className="text-sm font-extrabold tracking-tight text-brand-600">
          학습 포털
        </p>
        <h1 className="mt-1 text-2xl font-black tracking-tight text-ink">
          {student.name} 학생
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          선생님이 승인한 리포트와 배부된 과제를 확인하고, 과제 제출과 질문을
          남길 수 있어요. 이 링크는 외부에 공유하지 말아 주세요.
        </p>
      </header>

      {/* ---------- 리포트 ---------- */}
      <section>
        <h2 className="mb-4 text-lg font-black tracking-tight text-ink">
          리포트
        </h2>
        {reports.length === 0 ? (
          <div className="rounded-card border border-line bg-soft p-10 text-center">
            <p className="text-sm text-muted">아직 게시된 리포트가 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {reports.map((r) => (
              <article
                key={r.id}
                className="rounded-card border border-line bg-white p-6 shadow-card"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-extrabold tracking-tight text-brand-700">
                    {TYPE_LABEL[r.type] ?? r.type}
                  </span>
                  <span className="text-xs text-muted">
                    {formatKDate(r.createdAt)}
                  </span>
                </div>
                <div className="whitespace-pre-wrap text-[15px] leading-[1.9] tracking-tight text-ink-soft">
                  {restore(r.content, student.name)}
                </div>
                {/* 질문은 원 기록(이 리포트)과 연결되어 접수된다(검수 29). */}
                <QuestionForm token={token} reportId={r.id} />
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ---------- 과제 (H-02) — 배부·종료만, 초안·취소는 비노출 ---------- */}
      {assignments.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-lg font-black tracking-tight text-ink">
            과제
          </h2>
          <div className="space-y-5">
            {assignments.map((h) => (
              <HomeworkCard
                key={h.id}
                token={token}
                homework={h}
                overdue={Boolean(h.dueDate && h.dueDate < today)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ---------- 질문과 답변 (H-04) — 본인 질문만, 답변은 승인분만 ---------- */}
      {questions.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-lg font-black tracking-tight text-ink">
            질문과 답변
          </h2>
          <div className="space-y-4">
            {questions.map((q) => (
              <article
                key={q.id}
                className="rounded-card border border-line bg-white p-5 shadow-card"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-extrabold tracking-tight text-brand-700">
                    {questionOrigin(q)}
                  </span>
                  {questionStatusBadge(q)}
                  <span className="ml-auto text-xs text-muted">
                    {formatKDate(q.askedAt)}
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
                          {formatKDate(q.answeredAt)}
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
        </section>
      )}

      <footer className="mt-10 text-center text-xs font-bold tracking-tight text-muted">
        TUTOR OS
      </footer>
    </main>
  );
}
