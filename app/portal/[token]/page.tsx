import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  formatKDate,
  getStudentByPortalToken,
  listPortalReports,
} from "@/lib/data/crm";

// 네이티브 학생/학부모 리포트 포털 (Notion API 대체 — 기획 7-10).
// 비공개 토큰 링크로 접근, 승인된 리포트만 읽기 전용 조회. 검색 색인 금지.
export const metadata: Metadata = {
  title: "학습 리포트",
  robots: { index: false, follow: false },
};

const TYPE_LABEL: Record<string, string> = {
  lesson: "수업 리포트",
  weekly: "주간 리포트",
  monthly: "월간 리포트",
  exam: "시험 리포트",
};

export default async function PortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const student = await getStudentByPortalToken(token);
  if (!student) notFound();

  const reports = await listPortalReports(student.tenantId, student.id);

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-5 py-12">
      <header className="mb-8">
        <p className="text-sm font-extrabold tracking-tight text-brand-600">
          학습 리포트
        </p>
        <h1 className="mt-1 text-2xl font-black tracking-tight text-ink">
          {student.name} 학생
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          선생님이 승인한 리포트입니다. 읽기 전용이며, 이 링크는 외부에 공유하지
          말아 주세요.
        </p>
      </header>

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
                {r.content}
              </div>
              <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
                ※ 본 리포트는 AI가 생성한 참고용 자료입니다.
              </p>
            </article>
          ))}
        </div>
      )}

      <footer className="mt-10 text-center text-xs font-bold tracking-tight text-muted">
        TUTOR OS
      </footer>
    </main>
  );
}
