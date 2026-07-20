// 연도 표기 없음 — 불확실한 정보를 노출하지 않기 위해(기획 고정 문구).
const STEPS = [
  {
    title: "수능 수학 1등급",
    desc: "스스로 증명한 실력으로 시작했습니다.",
  },
  {
    title: "한양대 수리논술 최초합격",
    desc: "논리적으로 서술해 답안을 증명하는 힘을 길렀습니다.",
  },
  {
    title: "김과외 전국 상위 0.2% 튜터",
    desc: "다수의 학생을 지도하며 성적 향상 노하우를 쌓았습니다.",
  },
  {
    title: "AXIOM MATH LAB 운영",
    desc: "학생 10명·월 1,000만 원 규모로 직접 운영하고 있습니다.",
  },
] as const;

export function Timeline() {
  return (
    <ol className="relative space-y-10 border-l-2 border-line pl-8 md:pl-10">
      {STEPS.map((step) => (
        <li key={step.title} className="relative">
          <span className="absolute -left-[41px] top-1 size-4 rounded-full border-4 border-white bg-brand-600 shadow-card md:-left-[49px]" />
          <h3 className="text-lg font-black tracking-tight text-ink md:text-xl">
            {step.title}
          </h3>
          <p className="mt-2 text-[15px] leading-[1.75] tracking-tight text-muted">
            {step.desc}
          </p>
        </li>
      ))}
    </ol>
  );
}
