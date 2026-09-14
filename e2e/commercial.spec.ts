import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

test.describe("상용 운영 저장 흐름", () => {
  test.skip(process.env.CALENDAR_INTEGRATION !== "1", "로컬 DB에서만 실행");
  test.describe.configure({ mode: "serial" });
  let db: SupabaseClient, tenantId: string;
  const studentId = randomUUID(), enrollmentId = randomUUID(), contractId = randomUUID(), packageId = randomUUID();
  const reviewId = randomUUID(), retentionId = randomUUID();
  let objectPath: string;
  const createdBuckets: string[] = [];
  test.beforeAll(async ({ browser }, info) => {
    const require = createRequire(`${process.cwd()}/package.json`);
    require(require.resolve("@next/env", { paths: [require.resolve("next/package.json")] })).loadEnvConfig(process.cwd(), true);
    expect(["localhost", "127.0.0.1"]).toContain(new URL(process.env.SUPABASE_URL!).hostname);
    db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const context = await browser.newContext({ storageState: info.project.use.storageState });
    const token = (await context.cookies()).find((c) => c.name === "tutoros_admin")!.value;
    await context.close();
    const hash = createHmac("sha256", info.config.webServer?.env?.AUTH_SECRET ?? process.env.AUTH_SECRET ?? "dev-only-secret-change-me").update(`session:${token}`).digest("hex");
    const session = await db.from("admin_sessions").select("tenant_id").eq("token_hash", hash).single();
    expect(session.error).toBeNull(); tenantId = session.data!.tenant_id;
    for (const [table, payload] of [
      ["students", { id: studentId, tenant_id: tenantId, name: `묶음 연결 검증 ${studentId.slice(0, 8)}`, parent_phone: "01000000000" }],
      ["enrollments", { id: enrollmentId, tenant_id: tenantId, student_id: studentId, status: "active", relation_ok: true, contract_ok: true, payment_ok: true, schedule_ok: true, activated_at: "2018-01-01" }],
      ["contracts", { id: contractId, tenant_id: tenantId, enrollment_id: enrollmentId, terms: {}, agreed_at: "2018-01-01", agreed_by_name: "Fixture", agreed_by_phone: "01000000000" }],
      ["lesson_packages", { id: packageId, tenant_id: tenantId, student_id: studentId, enrollment_id: enrollmentId, contract_id: contractId, title: "브라우저 검증 8회", total_sessions: 8, starts_on: "2018-01-01", status: "active", activated_at: "2018-01-01" }],
    ] as const) expect((await db.from(table).insert(payload)).error).toBeNull();
    const buckets = await db.storage.listBuckets(); expect(buckets.error).toBeNull();
    for (const bucket of ["reviews", "review-evidence"]) {
      if (!buckets.data?.some((item) => item.id === bucket)) {
        expect((await db.storage.createBucket(bucket, { public: bucket === "reviews" })).error).toBeNull();
        createdBuckets.push(bucket);
      }
    }
    objectPath = `${tenantId}/${reviewId}.txt`;
    for (const bucket of ["reviews", "review-evidence"]) expect((await db.storage.from(bucket).upload(objectPath, Buffer.from("Isolated privacy fixture"), {contentType:"text/plain"})).error).toBeNull();
    expect((await db.from("reviews").insert({ id: reviewId, tenant_id: tenantId, reviewer_type: "parent", content: "Isolated erasure fixture", screenshots: [objectPath], status: "retracted", retracted_at: "2020-01-01" })).error).toBeNull();
    expect((await db.from("retention_records").insert({ id: retentionId, tenant_id: tenantId, subject_type: "review", subject_id: reviewId, subject_label: `파기 검증 ${reviewId.slice(0, 8)}`, category: "review_consent", event: "review_retracted", started_at: "2020-01-01", retain_until: "2023-01-01", policy_days: 1095, policy_label: "Isolated fixture" })).error).toBeNull();
  });
  test.afterAll(async () => {
    if (!db || !tenantId) return;
    for (const [table, key, value] of [["retention_records", "id", retentionId], ["reviews", "id", reviewId], ["privacy_tombstones", "record_id", reviewId], ["students", "id", studentId]] as const) expect((await db.from(table).delete().eq("tenant_id", tenantId).eq(key, value)).error).toBeNull();
    for (const bucket of ["reviews", "review-evidence"]) await db.storage.from(bucket).remove([objectPath]);
    for (const bucket of createdBuckets) expect((await db.storage.deleteBucket(bucket)).error).toBeNull();
  });
  test("캘린더 등록 → 계약 자동 연결 → 출석 차감", async ({ page }) => {
    await page.goto(`/admin/schedules?view=month&month=2020-02&student=${studentId}&day=2020-02-03`);
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /수업 추가/ }).click();
    await dialog.getByLabel("시작 시간").fill("10:00");
    await expect(dialog.getByLabel("수업 묶음")).toContainText("브라우저 검증 8회");
    await page.screenshot({ path: test.info().outputPath("calendar-package.png"), fullPage: true });
    await dialog.getByRole("button", { name: "일정 등록", exact: true }).click();
    await expect(dialog.locator(".calendar-agenda-item")).toHaveCount(1);
    const schedule = await db.from("schedules").select("id,package_id,contract_id").eq("tenant_id", tenantId).eq("student_id", studentId).single();
    expect(schedule.data).toMatchObject({ package_id: packageId, contract_id: contractId });
    await dialog.getByRole("button", { name: "출결 처리", exact: true }).click();
    await expect(dialog.getByRole("checkbox")).toBeEnabled();
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "출석 확정", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("출석 처리했습니다");
    const balance = await db.from("lesson_package_balances").select("remaining").eq("tenant_id", tenantId).eq("package_id", packageId).single();
    expect(balance.data?.remaining).toBe(7);
  });
  test("파기 실패 시 진행 상태 보존 → 파일 재시도 → 외부 확인 후 완료", async ({ page }) => {
    // A malformed legacy path exercises partial completion without touching another tenant's files.
    expect((await db.from("reviews").update({ screenshots: ["wrong-tenant/fixture.txt"] }).eq("tenant_id", tenantId).eq("id", reviewId)).error).toBeNull();
    await page.goto("/admin/privacy?state=due");
    const card = page.locator(".ui-card").filter({ hasText: `파기 검증 ${reviewId.slice(0, 8)}` });
    await card.getByRole("button", { name: "파기 범위 확인" }).click();
    await card.getByLabel("‘파기’를 입력해 확인").fill("파기");
    await card.getByRole("button", { name: "원본·첨부파일 삭제", exact: true }).click();
    await expect(card.getByText("원본 삭제 완료 · 첨부파일 처리 필요")).toBeVisible();
    await expect(card.getByRole("button", { name: "외부 확인 후 파기 완료" })).toHaveCount(0);
    expect((await db.from("retention_records").select("destroyed_at").eq("tenant_id", tenantId).eq("id", retentionId).single()).data?.destroyed_at).toBeNull();
    expect((await db.from("privacy_erasure_jobs").update({ files: [{bucket:"reviews",location:objectPath},{bucket:"review-evidence",location:objectPath}] }).eq("tenant_id", tenantId).eq("retention_id", retentionId)).error).toBeNull();
    await card.getByLabel("‘파기’를 입력해 확인").fill("파기");
    await card.getByRole("button", { name: "첨부파일 삭제 재시도" }).click();
    await expect(card.getByText("원본·첨부파일 삭제 완료 · 외부 보관 확인 대기")).toBeVisible();
    for (const bucket of ["reviews", "review-evidence"]) {
      const files = await db.storage.from(bucket).list(tenantId, { search: `${reviewId}.txt` });
      expect(files.error).toBeNull(); expect(files.data).toHaveLength(0);
    }
    await page.screenshot({ path: test.info().outputPath("privacy-stages.png"), fullPage: true });
    await card.getByRole("checkbox").check();
    await card.getByLabel("처리 근거").fill("격리된 테스트 자료: 외부 전송·별도 백업 없음, 첨부파일 삭제 확인.");
    await card.getByRole("button", { name: "외부 확인 후 파기 완료" }).click();
    await expect(card).toHaveCount(0);
    expect((await db.from("retention_records").select("destroyed_at").eq("tenant_id", tenantId).eq("id", retentionId).single()).data?.destroyed_at).toBeTruthy();
  });
});
