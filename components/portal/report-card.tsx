import type { PortalReport } from "@/lib/data/crm";
import { restore } from "@/lib/ai/pseudonym";
import { formatDate } from "./format";

// 리포트 카드 — 역할별 포털(/p)의 학생·보호자 뷰가 함께 쓴다.
// 어떤 리포트를 넘길지(대상 audience·승인 상태)는 호출부의 조회 함수가 정한다.
// 이 컴포넌트는 렌더링만 하고 스스로 조회하지 않는다 — 역할별 노출 범위를 화면이 아니라
// 데이터 계층 한 곳(lib/portal/data.ts)에서만 결정하기 위해서다.
//
// 저장된 본문은 가명(김○○) 상태다 — AI에 실명을 넘기지 않기 위해서(기획안 §15).
// 실명 복원은 최종 렌더링 시점에만 한다.
//
// children: 질문 폼처럼 이 리포트에 붙는 액션 자리. 보호자 뷰는 아무것도 넘기지 않는다
// (질문·정정 요청은 학생 본인 행위 — P-04 대리 제출 금지 정신).

const TYPE_LABEL: Record<string, string> = {
  lesson: "수업 리포트",
  weekly: "주간 리포트",
  monthly: "월간 리포트",
  exam: "시험 리포트",
};

/** 리포트 종류 라벨 — 질문 카드의 원 기록 표기에서도 같은 문구를 쓴다. */
export function reportTypeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}

export function ReportCard({
  report,
  studentName,
  children,
}: {
  report: PortalReport;
  studentName: string;
  children?: React.ReactNode;
}) {
  return (
    <article className="rounded-card border border-line bg-white p-6 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-extrabold tracking-tight text-brand-700">
          {reportTypeLabel(report.type)}
        </span>
        <span className="text-xs text-muted">{formatDate(report.createdAt)}</span>
      </div>
      <div className="whitespace-pre-wrap text-[15px] leading-[1.9] tracking-tight text-ink-soft">
        {restore(report.content, studentName)}
      </div>
      {children}
    </article>
  );
}
