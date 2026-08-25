import { HomeworkStatusList } from "@/components/portal/homework-status-list";
import { ReportCard } from "@/components/portal/report-card";
import { formatDateTime, kstToday } from "@/components/portal/format";
import {
  classTypeLabel,
  scheduleStatusLabel,
} from "@/app/admin/(protected)/schedules/constants";
import type { PortalSession } from "@/lib/portal/auth";
import { listGuardianHomework, listGuardianReports } from "@/lib/portal/data";
import { getGuardianSchedule, type PortalScheduleItem } from "./schedule";

// 보호자 역할 뷰 (P-04 보호자 포털 순환).
//
// 범위: 연결된 학생의 학부모용 리포트 · 과제 현황(읽기) · 일정 요약.
//  · 연결 판정은 세션의 active guardian 관계 하나뿐이다(검수 18) — 각 조회 함수가 그 게이트를
//    통과하지 못하면 빈 결과이고, 학생 선택 탭도 같은 관계 목록에서만 만들어진다.
//  · 대리 제출 없음(P-04 예외): 이 뷰는 제출·철회·질문 경로를 가진 컴포넌트를 넣지 않는다.
//    HomeworkStatusList는 폼이 없는 읽기 전용 목록이다.
//  · 금전 비노출(P-04 "청구권한 없음"): 학생 뷰와 마찬가지로 이 모듈에는 payments로 이어지는
//    import가 없다. 청구·수납·환불은 납부자 뷰에만 존재한다(검수 17과 같은 경계).
//
// 정정·상담 요청(P-04 주 전환의 뒷부분)은 아직 없다 — 상담은 공개 폼(submitConsult)이 별도
// 경로로 존재하고, 포털 내 요청 접수는 후속 과제다. 여기서 흉내 내지 않는다.

/** 회차 한 줄 — 시각·형태·상태만. 수업기록 본문·내부 메모는 포털에 내려오지 않는다(L-09 정신). */
function ScheduleRow({ item }: { item: PortalScheduleItem }) {
  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-line py-3 last:border-b-0">
      <span className="text-sm font-bold tracking-tight text-ink">
        {formatDateTime(item.scheduledAt)}
      </span>
      <span className="rounded-full border border-line bg-soft px-2.5 py-0.5 text-[11px] font-bold text-muted">
        {classTypeLabel(item.classType)}
      </span>
      <span className="ml-auto rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-extrabold text-brand-700">
        {scheduleStatusLabel(item.status)}
      </span>
    </li>
  );
}

export async function GuardianView({
  session,
  studentId,
  studentName,
}: {
  session: PortalSession;
  studentId: string;
  studentName: string;
}) {
  const [reports, assignments, schedule] = await Promise.all([
    listGuardianReports(session, studentId),
    listGuardianHomework(session, studentId),
    getGuardianSchedule(session, studentId),
  ]);
  const today = kstToday();
  const hasSchedule = schedule.upcoming.length > 0 || schedule.recent.length > 0;

  return (
    <>
      <section>
        <h2 className="mb-4 text-lg font-black tracking-tight text-ink">
          일정 요약
        </h2>
        <div className="rounded-card border border-line bg-white p-6 shadow-card">
          {!hasSchedule ? (
            <p className="text-sm text-muted">표시할 일정이 없습니다.</p>
          ) : (
            <>
              <p className="text-xs font-extrabold tracking-tight text-muted">
                다음 수업
              </p>
              {schedule.upcoming.length === 0 ? (
                <p className="mt-2 text-sm text-muted">
                  예정된 수업이 없습니다.
                </p>
              ) : (
                <ul className="mt-1">
                  {schedule.upcoming.map((s) => (
                    <ScheduleRow key={s.id} item={s} />
                  ))}
                </ul>
              )}
              {schedule.recent.length > 0 && (
                <>
                  <p className="mt-5 text-xs font-extrabold tracking-tight text-muted">
                    최근 완료한 수업
                  </p>
                  <ul className="mt-1">
                    {schedule.recent.map((s) => (
                      <ScheduleRow key={s.id} item={s} />
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-lg font-black tracking-tight text-ink">
          리포트
        </h2>
        {reports.length === 0 ? (
          <div className="rounded-card border border-line bg-white p-10 text-center">
            <p className="text-sm text-muted">아직 게시된 리포트가 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {reports.map((r) => (
              <ReportCard key={r.id} report={r} studentName={studentName} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-1 text-lg font-black tracking-tight text-ink">
          과제 현황
        </h2>
        <p className="mb-4 text-xs leading-relaxed text-muted">
          과제 제출과 질문은 학생 본인 화면에서만 할 수 있어요.
        </p>
        {assignments.length === 0 ? (
          <div className="rounded-card border border-line bg-white p-10 text-center">
            <p className="text-sm text-muted">배부된 과제가 없습니다.</p>
          </div>
        ) : (
          <HomeworkStatusList items={assignments} today={today} />
        )}
      </section>
    </>
  );
}
