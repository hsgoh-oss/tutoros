// AI 리포트 룰 검증 — 기획서 v11.1 7-3 "품질검증 3층" ①(길이·형식·금지표현·실명 노출 차단)과
// 「AI 리포트 개발 기획안 v1.0」§8(공통 문체·발송 클린 검사)의 규칙을 코드로 옮긴 것.
//
// 왜 필요한가: 승인 게이트(③)만으로는 선생님이 매번 전 문장을 대조해야 한다. 실제로 이 모듈 없이
// 생성된 초안이 "…의 결과로 보입니다"(원인 단정), "성실하게 수행하고 있습니다"(숙제 기록 없이 단정),
// "좋은 결과를 기대할 수 있을 것으로 예상됩니다"(성과 보장)를 한 문단에 모두 만들어 냈다.
//
// 차단(block) / 경고(warn) 구분 기준:
//   block — 두 문서가 "발송 차단"으로 명시한 것. 외부로 나가면 사고이거나 명백한 결함이다.
//   warn  — 문체·표현 규칙 위반. 맥락에 따라 정당할 수 있어 선생님 판단에 맡기고 표시만 한다.

import type { ReportAudience } from "@/lib/types";

export type IssueLevel = "block" | "warn";

export interface ValidationIssue {
  level: IssueLevel;
  rule: string;
  message: string;
  /** 문제가 된 원문 조각 — 검토 화면에서 어디를 고칠지 바로 보이게 */
  excerpt?: string;
}

/** 리포트 본문 최소 길이 — 이보다 짧으면 생성 실패나 빈 응답으로 본다. */
const MIN_CONTENT_LENGTH = 40;

// 기획안 §8 "발송 클린 검사": 내부 표기가 외부 본문에 남으면 발송 차단.
// 자료가 없으면 문구를 남기지 말고 섹션 자체를 생략하는 것이 계약이다.
const PLACEHOLDER_PATTERN =
  /자료\s*부족|기록\s*없음|기록이\s*없|확인\s*필요|미기록|해당\s*없음|\bN\/A\b|\bnull\b|\bundefined\b/gi;

interface PhraseRule {
  rule: string;
  message: string;
  pattern: RegExp;
}

// 기획안 §8 "금지 표현 / 권장 표현" 표를 패턴화. 각 항목이 표의 어느 줄에서 왔는지 주석으로 남긴다.
const BANNED_PHRASE_RULES: PhraseRule[] = [
  {
    rule: "causal_claim",
    message: "원인을 단정하는 표현입니다. 관찰된 기록과 횟수만 서술하세요.",
    // "이는 …의 결과로 보입니다" — 기록에 없는 인과를 만들어 내는 가장 흔한 패턴
    pattern: /결과로\s*보입니다|결과입니다|때문입니다|때문으로\s*보입니다|덕분입니다|탓입니다|영향으로\s*보입니다/g,
  },
  {
    rule: "diagnosis",
    message: "성향·질환을 단정·암시하는 표현입니다. 기록된 행동으로 바꾸세요.",
    // "집중력 장애가 의심됩니다"
    pattern: /의심됩니다|의심된다|장애가|증상|진단|성격이\s*(급|산만|소극)/g,
  },
  {
    rule: "guarantee",
    message: "성과를 보장·예측하는 표현입니다. 확인 계획으로 바꾸세요.",
    // "이 계획을 따르면 2등급이 보장됩니다"
    pattern: /보장(됩니다|합니다|된다)|틀림없|반드시\s*[^.]{0,20}(오릅|상승|향상|합격)|기대할\s*수\s*있을\s*것으로\s*예상/g,
  },
  {
    rule: "character_judgment",
    message: "학생의 인격·태도를 평가하는 표현입니다. 행동 기록으로 바꾸세요.",
    // "학생이 게을러 숙제를 하지 않았습니다"
    pattern: /게으르|게을러|불성실|태만|의지가\s*부족|노력하지\s*않/g,
  },
  {
    rule: "vague_praise",
    message: "근거 없는 총평입니다. 확인 문제 수·점수 같은 수치로 바꾸세요.",
    // "이해도가 매우 높습니다"
    pattern: /매우\s*(우수|높|뛰어|훌륭)|아주\s*(우수|훌륭)|완벽합니다|탁월합니다/g,
  },
];

/** 마크다운 제목만 있고 본문이 없는 섹션 찾기 — 기획안 §8 "빈 제목·빈 섹션" 차단. */
function findEmptySections(content: string): string[] {
  const lines = content.split("\n");
  const empty: string[] = [];

  lines.forEach((line, i) => {
    if (!/^#{1,6}\s+\S/.test(line)) return;
    // 다음 제목이 나오기 전까지 실질 내용이 한 줄이라도 있는지 본다(구분선·공백은 내용이 아니다).
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (/^#{1,6}\s/.test(next)) break;
      if (next && !/^[-*_=\s]+$/.test(next)) return;
    }
    empty.push(line.trim());
  });

  return empty;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

export interface ValidateOptions {
  /** 저장된 본문은 가명 상태여야 한다. 실명이 남아 있으면 가명화가 뚫린 것이므로 차단한다. */
  studentName?: string | null;
  audience: ReportAudience;
}

/**
 * 리포트 본문을 룰로 검증한다. AI를 호출하지 않으므로 생성·검토·발송 어디서든 부담 없이 부를 수 있다.
 * (기획안 §3.2가 요구하는 fact_id 근거 연결은 Canonical Facts 도입 이후의 별도 과제다.)
 */
export function validateReportContent(
  content: string,
  options: ValidateOptions,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const body = content.trim();

  if (body.length < MIN_CONTENT_LENGTH) {
    issues.push({
      level: "block",
      rule: "too_short",
      message: `본문이 너무 짧습니다(${body.length}자). 생성이 정상적으로 끝났는지 확인하세요.`,
    });
  }

  const placeholders = dedupe(body.match(PLACEHOLDER_PATTERN) ?? []);
  if (placeholders.length > 0) {
    issues.push({
      level: "block",
      rule: "placeholder",
      message:
        "내부 표기가 본문에 남아 있습니다. 자료가 없으면 문구를 쓰지 말고 해당 섹션을 통째로 지우세요.",
      excerpt: placeholders.join(", "),
    });
  }

  const emptySections = findEmptySections(body);
  if (emptySections.length > 0) {
    issues.push({
      level: "block",
      rule: "empty_section",
      message: "내용 없는 제목이 있습니다. 근거가 없으면 제목까지 제거해야 합니다.",
      excerpt: emptySections.join(" / "),
    });
  }

  // 외부 발송본에만 적용 — 내부용 브리핑은 선생님이 보는 화면이라 실명이 있어도 유출이 아니다.
  const realName = options.studentName?.trim();
  if (realName && options.audience !== "internal" && body.includes(realName)) {
    issues.push({
      level: "block",
      rule: "real_name",
      message:
        "가명화되어야 할 실명이 본문에 있습니다. AI에 실명이 전달됐거나 수정 중 입력됐을 수 있습니다.",
      excerpt: realName,
    });
  }

  for (const { rule, message, pattern } of BANNED_PHRASE_RULES) {
    const hits = dedupe(body.match(pattern) ?? []);
    if (hits.length > 0) {
      issues.push({ level: "warn", rule, message, excerpt: hits.join(", ") });
    }
  }

  return issues;
}

export function hasBlockingIssue(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.level === "block");
}

/**
 * 전 리포트 유형 프롬프트에 공통으로 붙이는 생성 규칙 — 검증에서 걸러내기 전에 애초에 만들지 않게 한다.
 * 규칙 번호는 기획안 §8·§3.2와 대응한다.
 */
export const REPORT_PROMPT_RULES = [
  "",
  "[작성 규칙 — 반드시 지킬 것]",
  "1. 아래 제공된 기록에 있는 내용만 쓴다. 없는 사실을 추측하거나 만들어 내지 않는다.",
  "2. 원인을 단정하지 않는다. '~의 결과로 보입니다', '~때문입니다' 같은 표현을 쓰지 않는다.",
  "3. 성향·질환·집중력을 진단하지 않는다. 기록된 행동과 횟수만 서술한다.",
  "4. 성과를 보장하거나 예측하지 않는다. 대신 다음에 확인할 방법을 쓴다.",
  "5. 인격·태도를 평가하지 않는다('게으르다', '불성실하다' 금지). 행동 기록으로 대체한다.",
  "6. 근거 없는 총평('매우 우수합니다')을 쓰지 않는다. 점수·문항 수 같은 수치로 쓴다.",
  "7. 자료가 없는 항목은 '자료 부족', '기록 없음', '확인 필요', 'N/A' 같은 문구를 쓰지 말고 그 항목을 통째로 생략한다. 제목만 남기지 않는다.",
  "8. 학생 이름은 제공된 가명 표기(예: 김○○)를 그대로 쓴다.",
].join("\n");
