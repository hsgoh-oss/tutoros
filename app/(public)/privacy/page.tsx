// 변호사 검수 전 초안 — 갑 확정 필요.

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Container, Section, SectionHeading } from "@/components/public/section";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "개인정보 처리방침" };

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

export default function PrivacyPage() {
  return (
    <Section className="pt-14 md:pt-20">
      <Container className="max-w-3xl">
        <SectionHeading as="h1" eyebrow="약관" title="개인정보 처리방침" />

        <div className="mb-10 flex flex-wrap items-center gap-3 rounded-panel border border-line bg-soft px-5 py-4 text-sm text-muted">
          <Badge tone="warning">v0.9 초안</Badge>
          <span>시행 예정일 2026-08-14</span>
        </div>

        <Article no={1} title="수집하는 개인정보 항목">
          <p>
            액시엄매스랩(이하 &ldquo;회사&rdquo;)은 상담 신청, 수업 운영,
            리포트 발송을 위해 다음 정보를 수집합니다.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>필수: 학생(또는 신청자) 이름, 연락처</li>
            <li>선택: 과목, 희망 수업 방식, 문의 내용</li>
            <li>
              학생 본인 신청 중 만 14세 미만인 경우: 출생년도, 보호자 성명·연락처
            </li>
            <li>
              수업 등록 이후: 학년, 학교, 최근 성적 등 민감할 수 있는 학습
              정보(수업 진행 및 리포트 작성 목적)
            </li>
          </ul>
        </Article>

        <Article no={2} title="수집 및 이용 목적">
          <p>
            상담 응대, 수업 배정 및 운영, 학부모 리포트 발송, 결제 안내,
            서비스 품질 개선을 위해 개인정보를 이용합니다.
          </p>
        </Article>

        <Article no={3} title="보유 및 이용 기간">
          <p>
            수집일로부터 서비스 이용 종료 후 3년간 보관 후 파기합니다.
            단, 관계 법령에 따라 보존이 필요한 경우 해당 기간 동안
            보관합니다.
          </p>
        </Article>

        <Article no={4} title="처리위탁">
          <p>
            회사는 서비스 제공을 위해 아래와 같이 개인정보 처리를
            위탁합니다.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>TUTOR OS 플랫폼 운영: 엔큐솔루션</li>
            <li>데이터베이스·인증·파일 저장: Supabase</li>
            <li>서비스 배포·호스팅: Vercel</li>
            <li>알림톡·문자 발송: Solapi</li>
            <li>결제 처리: 토스페이먼츠</li>
          </ul>
        </Article>

        <Article no={5} title="AI 처리 목적 가명화 국외이전">
          <p>
            회사는 학습 리포트 작성 등 AI 처리 과정에서 이름 등 식별 정보를
            가명 처리한 뒤 해외에 소재한 AI 처리 서버로 이전할 수
            있습니다. 실명은 AI 처리 서버로 전송되지 않으며, AI가 생성한
            결과물은 &ldquo;참고용&rdquo;으로 표기되어 담당 선생님의 검토·승인
            후에만 발송됩니다.
          </p>
        </Article>

        <Article no={6} title="만 14세 미만 아동의 개인정보 보호">
          <p>
            학생 본인이 만 14세 미만인 경우, 법정대리인(보호자)의 동의 없이
            상담 신청 및 개인정보 수집이 진행되지 않습니다. 법정대리인은
            아동의 개인정보에 대한 열람·정정·삭제를 요청할 수 있습니다.
          </p>
        </Article>

        <Article no={7} title="파기 절차 및 방법">
          <p>
            보유 기간이 경과하거나 처리 목적이 달성된 개인정보는 지체 없이
            파기합니다. 전자적 파일은 복구 불가능한 방법으로 삭제하며,
            서면은 분쇄 또는 소각합니다.
          </p>
        </Article>

        <Article no={8} title="정보주체의 권리">
          <p>
            정보주체(또는 법정대리인)는 언제든지 자신의 개인정보에 대한
            열람, 정정, 삭제, 처리정지를 요청할 수 있습니다. 요청은 아래
            문의처로 접수하며, 회사는 관계 법령이 정한 기간 내에
            조치합니다.
          </p>
        </Article>

        <Article no={9} title="문의처">
          <p>
            개인정보 관련 문의는 아래로 연락해 주세요.
            <br />
            이메일: hsgoh05@gmail.com
          </p>
        </Article>
      </Container>
    </Section>
  );
}
