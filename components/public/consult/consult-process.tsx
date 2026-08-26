import { Container } from "@/components/public/section";

/**
 * 상담 진행 절차.
 *
 * 정본(axiom-platform)의 승인된 문구를 그대로 옮겼다. 새 문장을 만들지 않는다.
 * 이 절차 설명이 신청 폼과 같은 화면에 있어야 "그래서 신청하면 무슨 일이 생기나"를
 * 스크롤만으로 확인할 수 있다.
 */
export const CONSULT_STEPS = [
  {
    number: "01",
    title: "상담 신청서 작성",
    description: "현재 성적, 학습 목표, 희망 수업 방식과 고민을 남겨 주세요.",
  },
  {
    number: "02",
    title: "학습 상태 확인",
    description:
      "작성 내용을 바탕으로 학생의 현재 학습 상태와 목표, 수업 가능 여부를 확인합니다.",
  },
  {
    number: "03",
    title: "맞춤 수업 방향 안내",
    description:
      "학생의 현재 상태와 목표에 맞춰 먼저 보완해야 할 부분과 수업 방향을 안내드립니다.",
  },
  {
    number: "04",
    title: "일정 조율 및 수업 확정",
    description:
      "상담 후 수업 일정과 진행 방식을 조율하고, 결제 완료 후 시범수업 또는 정규수업이 최종 확정됩니다.",
  },
] as const;

/** 확정되는 것과 확정되지 않는 것. 신청 직전 이탈의 원인이라 폼과 같은 화면에 둔다. */
export const CONSULT_CONFIRMATION_NOTICE =
  "상담 신청만으로 시범수업 또는 정규수업이 확정되는 것은 아니며, 수업은 상담, 일정 조율 및 결제 완료 후 최종 확정됩니다.";

export const CONSULT_PROGRESS_NOTICE =
  "상담 신청 후 진행 사항은 카카오톡 문의하기를 통해 확인해 주세요.";

export const CONSULT_PROCESS_ID = "consult-process";

/**
 * /apply 하단의 전체 절차. 모바일에서도 접기식이 아니라 펼쳐진 상태로 둔다 —
 * 접어두면 폼을 쓰다 멈춘 사람의 불확실성이 그대로 남는다.
 */
export function ConsultProcess() {
  return (
    <section
      className="axm-section"
      id={CONSULT_PROCESS_ID}
      aria-labelledby="consult-process-title"
    >
      <Container>
        <p className="axm-eyebrow">
          <b aria-hidden="true">02</b>PROCESS
        </p>
        <h2 id="consult-process-title" className="axm-section-title">
          상담 진행 절차
        </h2>

        <ol className="axm-statements mt-6">
          {CONSULT_STEPS.map((step) => (
            <li key={step.number}>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </li>
          ))}
        </ol>

        <p className="consult-process-note">{CONSULT_CONFIRMATION_NOTICE}</p>
        {/* 승인 문구 그대로 — 여기서는 링크가 아니라 강조다. 실제 카카오 진입점은
            상시 CTA와 제출 완료 화면의 연락 행이 제공한다. 같은 화면에 같은 이름의
            CTA를 두 번 두지 않는다. */}
        <p className="consult-process-note">
          간단한 문의와 상담 신청 후 진행 사항 확인은 <b>카카오톡 문의하기</b>{" "}
          버튼을 통해 가능합니다.
        </p>
      </Container>
    </section>
  );
}

/**
 * 색인 보완용 요약.
 *
 * /apply 는 개인정보 수집 폼이라 robots: noindex 다. 색인되던 상담 절차 설명이
 * 색인에서 빠지므로, 홈 05 CONSULTATION 블록과 /classes 하단에 같은 절차를 요약으로
 * 남겨 색인 경로를 유지한다.
 */
export function ConsultProcessSummary({ headingId }: { headingId: string }) {
  return (
    <div className="consult-summary">
      <h3 id={headingId} className="consult-summary-title">
        상담 진행 절차
      </h3>
      <ol className="consult-summary-steps">
        {CONSULT_STEPS.map((step) => (
          <li key={step.number}>
            <b>{step.title}</b>
            <span>{step.description}</span>
          </li>
        ))}
      </ol>
      {/* 여기에 CTA를 두지 않는다. 두 호스트 화면(홈 05 블록 · /classes)에 이미
          상담 신청 버튼이 있어 같은 이름의 행동이 나란히 두 번 나온다.
          이 요약의 역할은 색인 보존이지 새 행동이 아니다. */}
      <p className="consult-summary-note">{CONSULT_CONFIRMATION_NOTICE}</p>
    </div>
  );
}
