import { AdminPageHeader } from "@/components/admin/page-header";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { formatKDateTime, hasDb } from "@/lib/data/crm";
import { listActivity } from "@/lib/data/activity";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FilterChips } from "@/components/admin/crm/filter-chips";
import { Toolbar } from "@/components/admin/crm/toolbar";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";

// activity_log.action·target_type은 영문 키로 적재한다(집계·필터용 안정 값).
// 화면에는 여기서만 한글로 옮긴다 — 미등록 키는 원문을 그대로 보여 준다.
//
// 이 표가 '운영' 모듈의 정식 메뉴가 되면서 라벨을 전수로 채웠다. 그전에는 등록된 키가
// 다섯 개뿐이라 대부분의 줄이 `payssam_cash_receipt_sync` 같은 영문 키로 떠 있었고,
// 그런 목록은 "무슨 일이 있었나"를 훑는 데 쓸 수가 없었다.
const ACTION_LABEL: Record<string, string> = {
  // 공통
  create: "등록",
  update: "수정",
  delete: "삭제",
  approve: "승인",
  cancel: "취소",
  close: "종료",
  restore: "백업 복원",
  export: "내보내기",
  adjust: "조정",
  settle: "확정",
  notify: "알림 발송",

  // 계정·권한
  admin_login: "관리자 로그인",
  admin_sessions_revoke_all: "전 세션 회수",

  // 유입 — 상담·신청폼·시범·등록
  issue_intake_form: "신청폼 발급",
  reissue_intake_form: "신청폼 재발급",
  generate_consult_brief: "상담 브리프 생성",
  trial_propose: "시범 제안",
  trial_schedule: "시범 일정 확정",
  trial_reschedule: "시범 일정 변경",
  trial_confirm: "시범 확정",
  trial_confirm_payment: "시범 결제 확인",
  trial_set_paid: "시범 유료 지정",
  trial_done: "시범 완료",
  trial_noshow: "시범 노쇼",
  trial_cancel: "시범 취소",
  trial_result: "시범 결과 기록",
  enrollment_create: "등록 생성",
  enrollment_activate: "등록 활성화",
  enrollment_end: "등록 종료",
  enrollment_cancel: "등록 취소",
  enrollment_gate_relation: "등록 게이트 — 관계",
  enrollment_gate_contract: "등록 게이트 — 계약",
  enrollment_gate_payment: "등록 게이트 — 결제",
  enrollment_gate_schedule: "등록 게이트 — 일정",

  // 수업 — 회차·예약 제한
  restrict: "예약 제한",
  unrestrict: "예약 제한 해제",

  // 과제
  homework_draft_create: "과제 초안 작성",
  homework_draft_update: "과제 초안 수정",
  homework_assign: "과제 배부",
  homework_retract: "과제 배부 철회",
  homework_cancel: "과제 취소",
  homework_close: "과제 종료",
  homework_archive: "과제 보관",
  homework_review: "과제 검토",
  homework_answer_draft: "답안 초안",
  homework_answer_retract: "답안 철회",
  homework_feedback_draft: "피드백 초안",
  homework_feedback_approve: "피드백 승인",
  homework_feedback_retract: "피드백 철회",
  homework_question_resolve: "질문 종료",

  // 리포트
  generate_lesson_report: "수업 리포트 생성",
  generate_exam_report: "시험 리포트 생성",
  report_update_content: "리포트 본문 수정",
  report_approve: "리포트 승인",
  report_retract: "리포트 철회",
  report_send: "리포트 발송",

  // 결제선생
  payssam_send: "청구서 발송",
  payssam_resend: "청구서 재발송",
  payssam_destroy: "청구서 파기",
  payssam_sync: "청구서 동기화",
  payssam_refund: "환불",
  payssam_cash_receipt_issue: "현금영수증 발급",
  payssam_cash_receipt_cancel: "현금영수증 취소",
  payssam_cash_receipt_sync: "현금영수증 대조",

  // 사이트 설정
  settings_update_site_info: "사이트 정보 수정",
  settings_restore: "설정 복원",
};

const TARGET_LABEL: Record<string, string> = {
  // 유입
  consultation: "상담",
  intake_form: "신청폼",
  trial_session: "시범수업",
  enrollment: "정규 등록",
  waitlist_offer: "대기 자리 제안",
  recruit: "모집 현황",

  // 수업
  schedule: "수업 일정",
  lesson: "수업 기록",
  lesson_package: "수업 묶음",
  attendance_correction: "출결 정정",
  booking_restriction: "예약 제한",

  // 과제
  homework_assignment: "과제",
  homework_submission: "과제 제출",
  homework_question: "과제 질문",

  // 학생
  student: "학생",
  grade: "성적",
  grade_record: "성적 기록",
  material: "자료",
  report: "리포트",
  ai_report: "AI 리포트",

  // 정산·알림
  payment: "결제",
  notification: "알림",

  // 사이트
  review: "후기",
  faq: "FAQ",
  dday: "입시 일정",
  site_settings: "사이트 설정",

  // 운영·권한
  retention: "개인정보 보존기록",
  portal_relation: "포털 권한",
  admin_account: "관리자 계정",
  admin_session: "관리자 세션",
  work_item: "오늘 업무",
};

/** 중요 전환 범주 — 돈·권한·성적·개인정보는 나머지와 다른 무게로 읽혀야 한다(00013 P-11). */
const CATEGORY_LABEL: Record<string, string> = {
  money: "금전",
  permission: "권한",
  grade: "성적",
  privacy: "개인정보",
};

const CATEGORY_TONE: Record<string, "brand" | "warning" | "danger" | "success"> = {
  money: "warning",
  permission: "danger",
  grade: "success",
  privacy: "brand",
};

/** 범주 필터 칩 — 'other'는 넣지 않는다. 대다수가 other라 필터로서 아무것도 좁히지 못한다. */
const CATEGORY_FILTERS = Object.keys(CATEGORY_LABEL).map((v) => ({
  value: v,
  label: CATEGORY_LABEL[v],
}));

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category: categoryParam } = await searchParams;
  const category =
    categoryParam && CATEGORY_LABEL[categoryParam] ? categoryParam : undefined;

  const session = await getAdminSession();
  if (!session) notFound();

  const connected = hasDb();
  // 필터가 걸리면 더 넓게 읽는다 — 100건 안에 그 범주가 몇 건 없으면 필터가 빈 화면을 낸다.
  const all = await listActivity(session.tenantId, category ? 500 : 100);
  const entries = category ? all.filter((e) => e.category === category) : all;

  return (
    <div className="dash-page">
      {/* 되돌아갈 링크를 따로 두지 않는다 — '운영' 모듈의 정식 메뉴가 되면서 상단·좌측 메뉴가
          현재 위치를 보여주고, 그 위에 뒤로가기 링크가 또 있으면 어디가 상위인지 흐려진다. */}
      <AdminPageHeader>
        <h1 className="text-xl font-semibold tracking-tight">변경 이력</h1>
        <p className="mt-1 text-sm text-muted">
          상담·학생·결제·개인정보 등 주요 작업의 감사 기록입니다. 최근 100건(범주 필터 시 500건)까지 봅니다.
        </p>
      </AdminPageHeader>

      {!connected && <DbBanner />}

      <Toolbar>
        <FilterChips
          basePath="/admin/activity"
          paramKey="category"
          options={CATEGORY_FILTERS}
          current={category}
        />
      </Toolbar>

      <Card>
        {entries.length === 0 ? (
          <EmptyState
            title={category ? "이 범주의 기록이 없습니다" : "변경 이력이 없습니다"}
            description={
              category
                ? "최근 500건 안에는 없습니다. 필터를 '전체'로 바꿔 보세요."
                : "상담·학생·결제 등 주요 작업이 기록되면 이곳에 표시됩니다."
            }
          />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>시각</Th>
                  <Th>동작</Th>
                  <Th>대상</Th>
                  <Th>범주</Th>
                  <Th>요약</Th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <Td className="whitespace-nowrap text-muted">
                      {formatKDateTime(e.createdAt)}
                    </Td>
                    <Td className="font-bold text-ink">
                      {ACTION_LABEL[e.action] ?? e.action}
                    </Td>
                    <Td>
                      <span className="text-ink-soft">
                        {TARGET_LABEL[e.targetType] ?? e.targetType}
                      </span>
                      {e.targetId && (
                        <span className="ml-1 text-xs text-muted">
                          {e.targetId.slice(0, 8)}
                        </span>
                      )}
                    </Td>
                    <Td>
                      {/* 'other'는 배지를 달지 않는다 — 대부분이 other라서 전부 칠하면
                          정작 금전·권한·개인정보가 눈에 안 띈다. */}
                      {e.category && CATEGORY_LABEL[e.category] ? (
                        <Badge tone={CATEGORY_TONE[e.category] ?? "soft"}>
                          {CATEGORY_LABEL[e.category]}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </Td>
                    <Td className="text-ink-soft">{e.summary}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
