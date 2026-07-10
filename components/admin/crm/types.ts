// CRM 서버 액션 공용 반환 타입 — 전 모듈(상담·학생·수업·일정·성적·결제·자료) 액션이 이 형태로 통일.
export interface CrmActionResult {
  ok: boolean;
  error?: string;
}
