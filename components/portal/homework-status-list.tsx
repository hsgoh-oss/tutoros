import type { PortalHomework } from "@/lib/data/homework";
import { formatDate, formatDateTime } from "./format";

// 보호자용 과제 현황 — 읽기 전용 (P-04 "과제 현황 확인").
//
// 학생 카드(components/portal/homework-card.tsx)와 달리 제출 폼·철회 버튼·질문 폼이 없다.
// 이것이 이 컴포넌트가 따로 있는 이유다: "보호자는 학생 대신 과제·답안을 제출하지 않는다"
// (P-04 예외)는 버튼을 숨겨서가 아니라 제출 경로를 가진 컴포넌트를 보호자 뷰에 넣지 않는 것으로
// 지킨다. 제출 파일 열람도 없다 — 제출 파일은 본인 것만 열 수 있다(H-06).
//
// 검토 진행 여부는 표시하지 않는다(검수 28): 승인된 피드백만 데이터로 내려오므로
// "검토 중"이라는 상태 자체가 이 화면에 존재하지 않는다.

/** 과제 한 건의 현재 상태 — 최신 제출본과 승인된 판정만으로 정한다. */
function statusBadge(homework: PortalHomework, today: string) {
  const latest = homework.latestSubmission;
  if (latest?.reviewResult === "complete") {
    return { label: "완료", tone: "bg-emerald-100 text-emerald-700" };
  }
  if (latest?.reviewResult === "resubmit") {
    return { label: "보완 후 재제출 요청", tone: "bg-amber-100 text-amber-700" };
  }
  if (latest) {
    return { label: "제출 완료", tone: "bg-brand-50 text-brand-700" };
  }
  if (homework.status === "assigned" && homework.dueDate && homework.dueDate < today) {
    return { label: "미제출 · 기한 경과", tone: "bg-rose-100 text-rose-700" };
  }
  return { label: "미제출", tone: "bg-soft text-muted" };
}

export function HomeworkStatusList({
  items,
  today,
}: {
  items: PortalHomework[];
  today: string;
}) {
  return (
    <ul className="space-y-4">
      {items.map((h) => {
        const badge = statusBadge(h, today);
        const latest = h.latestSubmission;
        return (
          <li
            key={h.id}
            className="rounded-card border border-line bg-white p-5 shadow-card"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${badge.tone}`}
              >
                {badge.label}
              </span>
              {h.status === "closed" && (
                <span className="rounded-full border border-line bg-soft px-2.5 py-0.5 text-[11px] font-bold text-muted">
                  종료된 과제
                </span>
              )}
              <span className="ml-auto text-xs text-muted">
                기한 {h.dueDate ? formatDate(h.dueDate) : "없음"}
              </span>
            </div>

            <h3 className="mt-2 text-base font-black tracking-tight text-ink">
              {h.title}
            </h3>
            {h.description && (
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                {h.description}
              </p>
            )}

            {latest && (
              <p className="mt-2 text-xs font-bold text-muted">
                최근 제출 {formatDateTime(latest.submittedAt)}
                {latest.late && " · 기한 경과 제출"}
                {latest.fileName && " · 첨부 포함"}
              </p>
            )}

            {/* 승인·게시된 피드백만 내려온다(검수 28) — 미승인 초안은 존재째 없다. */}
            {latest?.feedback && (
              <div className="mt-3 rounded-xl bg-brand-50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-extrabold tracking-tight text-brand-700">
                    선생님 피드백
                  </span>
                  {latest.feedbackApprovedAt && (
                    <span className="text-[11px] text-muted">
                      {formatDate(latest.feedbackApprovedAt)}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                  {latest.feedback}
                </p>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
