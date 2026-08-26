import type { Metadata } from "next";
import Link from "next/link";
import { resolveTenant } from "@/lib/tenant";
import { getSiteContent } from "@/lib/data/content";
import { Container } from "@/components/public/section";
import { CaseResults } from "@/components/public/case-results";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "성적 향상 사례",
  description:
    "AXIOM MATH LAB 성적 향상 사례 — 검증된 근거와 함께 공개된 수강생의 등급 변화입니다.",
  alternates: { canonical: "/case" },
  openGraph: {
    title: "성적 향상 사례",
    url: "/case",
    description: "검증된 근거와 함께 공개된 수강생의 등급 변화입니다.",
  },
};

export default async function CasePage() {
  const tenant = await resolveTenant();
  const content = await getSiteContent(tenant.id);

  // 후기 중 전·후 등급이 모두 기록된 건 — 사례와 같은 근거이므로 같은 화면에 둔다.
  // 정본 S-01·S-03: 공개 콘텐츠는 승인·게시된 것만 노출한다(lib/data/content.ts에서 이미 걸러진다).
  const gradeChanges = content.reviews.filter(
    (r) => r.beforeGrade && r.afterGrade,
  );

  return (
    <>
      <section className="axm-page-hero">
        <Container>
          <h1>성적 향상 사례</h1>
          <p>
            검증된 근거와 함께 공개된 사례입니다. 확인되지 않은 수치는 싣지
            않습니다.
          </p>
        </Container>
      </section>

      <section className="axm-section" aria-labelledby="case-list-title">
        <Container>
          <h2 id="case-list-title" className="axm-section-title">
            등급 변화
          </h2>
          <div className="mt-6">
            {content.cases.length > 0 ? (
              <CaseResults cases={content.cases} />
            ) : (
              <p className="rounded-[var(--radius-panel)] border border-line bg-soft px-6 py-10 text-center text-sm text-muted">
                공개된 사례가 아직 없습니다.
              </p>
            )}
          </div>
        </Container>
      </section>

      {gradeChanges.length > 0 && (
        <section
          className="axm-section axm-section-sunken"
          aria-labelledby="case-review-title"
        >
          <Container>
            <h2 id="case-review-title" className="axm-section-title">
              사례와 함께 남긴 후기
            </h2>
            <ul className="m-0 mt-6 list-none border-t border-line-strong p-0">
              {gradeChanges.map((r) => (
                <li key={r.id} className="border-b border-line py-5">
                  <p className="m-0 text-[13px] font-extrabold tracking-[-0.02em] text-brand-600">
                    {r.beforeGrade} → {r.afterGrade}
                  </p>
                  <p className="mt-2 [font:var(--font-body)] text-muted">
                    {r.content}
                  </p>
                </li>
              ))}
            </ul>
          </Container>
        </section>
      )}

      <section className="axm-section" aria-labelledby="case-next-title">
        <Container>
          <div className="flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
            <div>
              <h2
                id="case-next-title"
                className="m-0 text-xl font-extrabold tracking-[-0.03em] text-ink"
              >
                지금 상태에서 무엇을 바꿔야 하는지
              </h2>
              <p className="mt-2 [font:var(--font-body)] text-muted">
                학생의 현재 상태와 목표를 기준으로, 필요한 학습 방향을 함께
                확인합니다.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/apply" className={buttonClass("primary", "md")}>
                상담 신청하기
              </Link>
              <Link href="/reviews" className={buttonClass("outline", "md")}>
                후기 보기
              </Link>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
