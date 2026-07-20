// 자동화 잡 라우터(?job=) — DB 조인·조건부 큐잉이 필요한 잡들을 한 엣지 함수로 통합한다.
// 순수 SQL로 되는 나머지는 migrations/00002_automation.sql의 pg_cron이 담당한다.
// 실 발송은 하지 않는다 — notifications에 queued 적재까지만, 실발송은 app/api/cron/flush. 상세: docs/cron-definitions.md

import { createServiceClient } from "../_shared/db.ts";
import { runLessonReminder } from "./jobs/lessonReminder.ts";
import { runPaymentD3 } from "./jobs/paymentD3.ts";
import { runPaymentOverdueNotice } from "./jobs/paymentOverdueNotice.ts";
import { runWeeklyReportDraft } from "./jobs/weeklyReportDraft.ts";
import { runReviewRequest } from "./jobs/reviewRequest.ts";
import { runMonthlyReportDraft } from "./jobs/monthlyReportDraft.ts";
import { runDdayRecalc } from "./jobs/ddayRecalc.ts";
import { runNotifyRetry } from "./jobs/notifyRetry.ts";

type JobResult = Record<string, number>;
type JobHandler = (db: ReturnType<typeof createServiceClient>) => Promise<JobResult>;

const JOBS: Record<string, JobHandler> = {
  lesson_reminder: runLessonReminder,
  payment_d3: runPaymentD3,
  payment_overdue_notice: runPaymentOverdueNotice,
  weekly_report_draft: runWeeklyReportDraft,
  review_request: runReviewRequest,
  monthly_report_draft: runMonthlyReportDraft,
  dday_recalc: runDdayRecalc,
  notify_retry: runNotifyRetry,
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
