import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { EnrollmentGate } from "@/lib/data/intake";
import { GATE_EVIDENCE, GATE_LABEL } from "./constants";

// 게이트 한 칸(서버 컴포넌트) — 네 게이트가 같은 모양으로 보이게 하는 껍데기다.
// 통과 여부, 정본이 요구하는 근거 문장, 지금 화면이 확인한 근거, 그리고 처리 폼을 한 자리에 모은다.
// 상태 판정·전환은 여기 없다(actions.ts) — 이 파일은 배치만 한다.

export function GateCard({
  gate,
  step,
  done,
  evidence,
  children,
}: {
  gate: EnrollmentGate;
  /** 정본 R-04가 세는 순서(1~4) — 화면에서 '몇 번째 조건'인지 눈에 보이게 한다. */
  step: number;
  done: boolean;
  /** 지금 이 등록에서 확인된 근거(계약본·완납 청구·확정 회차 등). 없으면 미확인 안내를 그린다. */
  evidence?: ReactNode;
  /** 통과 처리·해제 폼. 이미 닫힌 등록이면 호출부가 넘기지 않는다. */
  children?: ReactNode;
}) {
  return (
    <div className="rounded-panel border border-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">
          <span className="mr-2 text-muted">{step}</span>
          {GATE_LABEL[gate]}
        </p>
        <Badge tone={done ? "success" : "warning"}>{done ? "통과" : "미완"}</Badge>
      </div>
      <p className="mt-2 text-xs text-muted">{GATE_EVIDENCE[gate]}</p>
      {evidence && <div className="mt-3 text-sm text-ink-soft">{evidence}</div>}
      {children && <div className="mt-4 border-t border-line pt-4">{children}</div>}
    </div>
  );
}
