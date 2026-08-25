import { HomeworkCard } from "@/components/portal/homework-card";
import { QuestionForm } from "@/components/portal/question-form";
import { QuestionList } from "@/components/portal/question-list";
import { ReportCard, reportTypeLabel } from "@/components/portal/report-card";
import { formatDate, kstToday } from "@/components/portal/format";
import type { PortalSession } from "@/lib/portal/auth";
import type { PortalHomeworkQuestion } from "@/lib/data/homework";
import {
  listStudentHomework,
  listStudentQuestions,
  listStudentReports,
} from "@/lib/portal/data";

// 학생 역할 뷰 (P-03 학생 포털 순환).
//
// ⚠️ 검수 17 — "학생은 어떤 직접 경로에서도 청구·수납·환불을 볼 수 없다".
// 이 파일에는 금전 조회로 이어지는 import가 하나도 없다. listPayerPayments·payments 테이블·
// 금액 포맷(formatWon)·결제 라벨 어느 것도 이 모듈의 의존 그래프에 존재하지 않는다.
// 즉 학생 뷰에서 금전 데이터는 "필터로 가려진" 것이 아니라 도달할 코드 경로가 없다.
// 금전은 납부자 뷰(app/p/payer-view.tsx) 한 곳에만 있고, 그 모듈은 이 뷰가 부르지 않는다.
// (app/p/page.tsx의 역할 분기는 view === "student"일 때 payer-view를 아예 실행하지 않는다.)
// 이 파일에 payments·청구·수납·환불을 다루는 코드를 추가하지 말 것 — 추가하는 순간 검수 17이 깨진다.
//
// 제출·질문 액션은 세션 경로다: 카드에 넘기는 token은 빈 문자열이고, 서버 액션
// (app/portal/[token]/actions.ts resolvePortalActor)이 token이 비면 포털 세션 쿠키로
// 행위 주체를 해석한다. 즉 이 화면은 기존 단일 토큰 링크를 알지도, 노출하지도 않는다
// — 관계가 회수되면 세션이 무효가 되어 제출·질문도 함께 닫힌다(검수 21).
//
// 한 사람(contact)이 학생 역할 관계를 둘 이상 가져도(예: 형제가 같은 번호로 각각 학생 초대를
// 받은 경우) 이 화면이 보고 있는 studentId를 액션에 함께 보내 대상을 특정한다(검수 16).
// 액션은 그 id가 세션의 active 관계에 있을 때만 통과시킨다 — 없으면 fail-closed로 거부.

const SESSION_ACTION_TOKEN = ""; // 빈 토큰 = 세션 경로(위 주석 참조)

export async function StudentView({
  session,
  studentId,
  studentName,
}: {
  session: PortalSession;
  studentId: string;
  studentName: string;
}) {
  // 역할 게이트는 각 조회 함수 안에 있다(student 관계가 없으면 빈 결과).
  const [reports, assignments, questions] = await Promise.all([
    listStudentReports(session, studentId),
    listStudentHomework(session, studentId),
    listStudentQuestions(session, studentId),
  ]);
  const today = kstToday();

  // 질문의 원 기록 라벨 — 본인에게 노출되는 과제·리포트 범위 안에서만 해석한다.
  const assignmentTitle = new Map(assignments.map((a) => [a.id, a.title]));
  const reportLabel = new Map(
    reports.map((r) => [
      r.id,
      `${reportTypeLabel(r.type)} (${formatDate(r.createdAt)})`,
    ]),
  );
  const originLabel = (q: PortalHomeworkQuestion): string => {
    if (q.assignmentId) {
      return `과제 · ${assignmentTitle.get(q.assignmentId) ?? "과제"}`;
    }
    if (q.reportId) return `리포트 · ${reportLabel.get(q.reportId) ?? "리포트"}`;
    if (q.lessonId) return "수업";
    return "질문";
  };

  return (
    <>
      <section>
        <h2 className="mb-4 text-lg font-black tracking-tight text-ink">
          리포트
        </h2>
        {reports.length === 0 ? (
          <div className="rounded-card border border-line bg-white p-10 text-center">
            <p className="text-sm text-muted">아직 게시된 리포트가 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {reports.map((r) => (
              <ReportCard key={r.id} report={r} studentName={studentName}>
                {/* 질문은 원 기록(이 리포트)과 연결되어 접수된다(검수 29). */}
                <QuestionForm token={SESSION_ACTION_TOKEN} studentId={studentId} reportId={r.id} />
              </ReportCard>
            ))}
          </div>
        )}
      </section>

      {/* 과제 (H-02) — 배부·종료만 내려온다(초안·취소는 데이터 계층에서 제외). */}
      {assignments.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-lg font-black tracking-tight text-ink">
            과제
          </h2>
          <div className="space-y-5">
            {assignments.map((h) => (
              <HomeworkCard
                key={h.id}
                token={SESSION_ACTION_TOKEN}
                studentId={studentId}
                homework={h}
                overdue={Boolean(h.dueDate && h.dueDate < today)}
              />
            ))}
          </div>
        </section>
      )}

      {/* 질문과 답변 (H-04) — 본인 질문만, 답변은 승인분만. */}
      {questions.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-lg font-black tracking-tight text-ink">
            질문과 답변
          </h2>
          <QuestionList questions={questions} originLabel={originLabel} />
        </section>
      )}
    </>
  );
}
