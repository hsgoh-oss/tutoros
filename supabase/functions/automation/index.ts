// 자동화 8종 중 DB 조인·조건부 큐잉이 필요한 4종을 한 엣지 함수로 통합 라우팅한다
// (?job= 파라미터 분기 — 잡별 함수보다 배포·시크릿 관리가 단순해 유지보수가 쉽다).
// 순수 SQL로 가능한 나머지(payment_overdue_flag·content_backup_daily·schedule_autoclean)는
// supabase/migrations/00002_automation.sql의 pg_cron 잡이 DB 함수를 직접 호출한다.
// 실 알림 발송(Solapi)은 여기서 하지 않는다 — notifications에 queued 적재까지만 하고
// 실발송은 app/api/cron/flush(Next, lib/notify/send.ts 재사용)가 담당한다.
// 상세: docs/cron-definitions.md

import { createServiceClient } from "../_shared/db.ts";
import { runLessonReminder } from "./jobs/lessonReminder.ts";
import { runPaymentD3 } from "./jobs/paymentD3.ts";
import { runPaymentOverdueNotice } from "./jobs/paymentOverdueNotice.ts";
import { runWeeklyReportDraft } from "./jobs/weeklyReportDraft.ts";

type JobResult = Record<string, number>;
type JobHandler = (db: ReturnType<typeof createServiceClient>) => Promise<JobResult>;

const JOBS: Record<string, JobHandler> = {
  lesson_reminder: runLessonReminder,
  payment_d3: runPaymentD3,
  payment_overdue_notice: runPaymentOverdueNotice,
  weekly_report_draft: runWeeklyReportDraft,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const job = url.searchParams.get("job") ?? "";
  const handler = JOBS[job];

  if (!handler) {
    return json(
      { ok: false, error: `unknown job: ${job || "(missing)"}`, availableJobs: Object.keys(JOBS) },
      400,
    );
  }

  try {
    const db = createServiceClient();
    const result = await handler(db);
    return json({ ok: true, job, ...result });
  } catch (err) {
    console.error(`[automation] job ${job} failed`, err);
    return json({ ok: false, job, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
