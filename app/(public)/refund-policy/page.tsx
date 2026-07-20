// 변호사 검수 전 초안 — 갑 확정 필요.

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Container, Section, SectionHeading } from "@/components/public/section";
import { Badge } from "@/components/ui/badge";
import { TableWrap, Table, Th, Td } from "@/components/ui/table";

export const metadata: Metadata = { title: "환불 규정" };

function Article({
  no,
  title,
  children,
}: {
  no: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-line py-8 first:pt-0 last:border-none">
      <h2 className="text-lg font-black tracking-tight text-ink">
        제{no}조 ({title})
      </h2>
      <div className="mt-4 space-y-3 text-[15px] leading-[1.86] tracking-tight text-ink-soft">
        {children}
      </div>
    </section>
  );
}

const REFUND_TABLE = [
  { stage: "교습 개시 전", rate: "전액 환불" },
  { stage: "총 교습시간의 1/3 경과 전", rate: "수강료의 2/3 반환" },
  { stage: "총 교습시간의 1/2 경과 전", rate: "수강료의 1/2 반환" },
  { stage: "총 교습시간의 1/2 경과 후", rate: "반환하지 않음" },
];

export default function RefundPolicyPage() {
  return (
    <Section className="pt-14 md:pt-20">
      <Container className="max-w-3xl">
        <SectionHeading as="h1" eyebrow="약관" title="환불 규정" />

        <div className="mb-10 flex flex-wrap items-center gap-3 rounded-panel border border-line bg-soft px-5 py-4 text-sm text-muted">
          <Badge tone="warning">v0.9 초안</Badge>
          <span>시행 예정일 2026-08-14</span>
        </div>

        <Article no={1} title="적용 범위">
          <p>
            이 규정은 액시엄매스랩이 제공하는 정규 수업 및 시범수업의 교습비
            환불 기준을 정합니다. 정규 수업은 학원의 설립·운영 및 과외교습에
            관한 법률(학원법)의 교습비 등 반환 기준을 준용합니다.
          </p>
        </Article>

        <Article no={2} title="정규 수업 환불 기준">
          <p>4주 단위로 선납된 수강료는 아래 기준에 따라 반환합니다.</p>
          <TableWrap className="mt-4">
            <Table>
              <thead>
                <tr>
                  <Th>경과 시점</Th>
                  <Th>반환 기준</Th>
                </tr>
              </thead>
              <tbody>
                {REFUND_TABLE.map((row) => (
                  <tr key={row.stage}>
                    <Td>{row.stage}</Td>
                    <Td>{row.rate}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Article>

        <Article no={3} title="시범수업 환불 기준">
          <p>
            시범수업(1시간 5만 원)은 진행 완료 후에는 환불이 불가합니다.
            시범수업 예정일 기준 24시간 전에 취소하는 경우 전액
            환불됩니다.
          </p>
        </Article>

        <Article no={4} title="환불 신청 방법">
          <p>
            환불은 상담 페이지 또는 카카오톡을 통해 신청할 수 있으며,
            신청 접수 후 확인을 거쳐 영업일 기준 5일 이내에 처리합니다.
          </p>
        </Article>

        <Article no={5} title="기타">
          <p>
            이 규정에서 정하지 않은 사항은 학원법 관련 규정 및 일반
            상관례에 따릅니다.
          </p>
        </Article>
      </Container>
    </Section>
  );
}
