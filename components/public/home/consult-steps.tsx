const STEPS = [
  {
    step: "01",
    title: "상담 신청",
    desc: "폼으로 남겨주시면 빠르게 연락드립니다.",
  },
  {
    step: "02",
    title: "일정 협의",
    desc: "학생 상황에 맞춰 수업 방식과 일정을 정합니다.",
  },
  {
    step: "03",
    title: "시범수업 (선택)",
    desc: "1회 체험 후 등록 여부를 자유롭게 결정합니다.",
  },
  {
    step: "04",
    title: "정규 수업 시작",
    desc: "맞춤 커리큘럼으로 정규 수업을 시작합니다.",
  },
] as const;

export function ConsultSteps() {
  return (
    <ol className="grid gap-8 sm:grid-cols-2 md:grid-cols-4 md:gap-6">
      {STEPS.map((item) => (
        <li key={item.step}>
          <p className="text-3xl font-black tracking-tight text-brand-200">
            {item.step}
          </p>
          <h3 className="mt-3 text-lg font-black tracking-tight text-ink">
            {item.title}
          </h3>
          <p className="mt-2 text-[15px] leading-[1.7] tracking-tight text-muted">
            {item.desc}
          </p>
        </li>
      ))}
    </ol>
  );
}
