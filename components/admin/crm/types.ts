// CRM 서버 액션 공용 반환 타입 — 전 모듈(상담·학생·수업·일정·성적·결제·자료) 액션이 이 형태로 통일.
export interface CrmActionResult {
  ok: boolean;
  error?: string;
  /**
   * 성공했지만 운영자가 알아야 하는 사실.
   *
   * "실패는 아닌데 조용히 넘기면 안 되는" 결과가 있다 — 대조 결과 내부 기록이 바뀌었다든가.
   * error로 쓰면 실패로 보이고, 안 쓰면 화면이 아무 말 없이 새로고침돼 "왜 바뀌었지"가 남는다.
   */
  warning?: string;
}
