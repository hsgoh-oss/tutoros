import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

// Opt-in write tests against local Supabase only. Fixtures are isolated by student and removed;
// the application's append-only audit records remain, as they do for normal operations.
test.describe("캘린더 안에서 수업 처리", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(process.env.CALENDAR_INTEGRATION !== "1", "CALENDAR_INTEGRATION=1로 로컬 DB 검증을 실행합니다");
  let db: SupabaseClient;
  let tenantId: string;
  const studentId = randomUUID();
  const ids = Array.from({ length: 7 }, () => randomUUID());
  const dates = ["2020-01-08", "2020-01-09", "2020-01-10", "2099-09-08", "2020-01-11", "2099-09-09", "2020-01-12"];

  test.beforeAll(async ({ browser }, testInfo) => {
    const require = createRequire(`${process.cwd()}/package.json`);
    const { loadEnvConfig } = require(require.resolve("@next/env", { paths: [require.resolve("next/package.json")] }));
    loadEnvConfig(process.cwd(), true);
    const url = process.env.SUPABASE_URL!;
    expect(["127.0.0.1", "localhost"]).toContain(new URL(url).hostname);
    db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const context = await browser.newContext({ storageState: testInfo.project.use.storageState });
    const token = (await context.cookies()).find((cookie) => cookie.name === "tutoros_admin")!.value;
    await context.close();
    const authSecret = testInfo.config.webServer?.env?.AUTH_SECRET ?? process.env.AUTH_SECRET ?? "dev-only-secret-change-me";
    const hash = createHmac("sha256", authSecret).update(`session:${token}`).digest("hex");
    const session = await db.from("admin_sessions").select("tenant_id").eq("token_hash", hash).single();
    expect(session.error).toBeNull(); tenantId = session.data!.tenant_id;
    const student = await db.from("students").insert({ id: studentId, tenant_id: tenantId, name: `캘린더 기능 검증 ${studentId.slice(0, 8)}`, parent_phone: "01000000000", class_type: "video", status: "active" });
    expect(student.error).toBeNull();
    const schedules = await db.from("schedules").insert(ids.map((id, index) => ({ id, tenant_id: tenantId, student_id: studentId, scheduled_at: `${dates[index]}T10:00:00+09:00`, ends_at: `${dates[index]}T11:00:00+09:00`, class_type: "video", status: "planned" })));
    expect(schedules.error).toBeNull();
  });

  test.afterAll(async () => {
    if (!db || !tenantId) return;
    const result = await db.from("students").delete().eq("tenant_id", tenantId).eq("id", studentId);
    expect(result.error).toBeNull();
  });

  async function day(page: Page, index: number) {
    await page.goto(`/admin/schedules?view=month&month=${dates[index].slice(0, 7)}&student=${studentId}&day=${dates[index]}`);
    await expect(page.locator(".dash-navbar h1")).toBeVisible();
    await expect(page.getByRole("dialog").locator(".calendar-agenda-item")).toHaveCount(1);
    return page.getByRole("dialog");
  }
  async function row(index: number) {
    const result = await db.from("schedules").select("*").eq("tenant_id", tenantId).eq("id", ids[index]).single();
    expect(result.error).toBeNull(); return result.data!;
  }

  test("출석 확정: 팝업·학생·날짜 유지, 차감 없는 수업의 실제 저장", async ({ page }) => {
    const dialog = await day(page, 0);
    const url = page.url();
    await dialog.getByRole("button", { name: "출결 처리", exact: true }).click();
    await expect(dialog.getByRole("radio", { name: "출석", exact: true })).toBeChecked();
    await expect(dialog.getByRole("checkbox")).toBeDisabled();
    await dialog.getByRole("button", { name: "출석 확정", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("출석 처리했습니다");
    await expect(dialog.getByRole("button", { name: "출결 정정", exact: true })).toBeVisible();
    await expect(page).toHaveURL(url);
    expect(await row(0)).toMatchObject({ attendance: "present", status: "done", deduction_state: "waived" });
  });

  test("결석 확정·정정 요청·승인: 모든 전환을 팝업에서 완료", async ({ page }) => {
    const dialog = await day(page, 1);
    await dialog.getByRole("button", { name: "결석", exact: true }).click();
    await expect(dialog.getByRole("radio", { name: "일반 결석", exact: true })).toBeChecked();
    await dialog.getByLabel("출결 메모").fill("검증: 사전 연락 없이 결석");
    await dialog.getByRole("button", { name: "일반 결석 확정", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("일반 결석 처리했습니다");
    expect(await row(1)).toMatchObject({ attendance: "absent", status: "done", deduction_state: "waived" });
    await dialog.getByRole("button", { name: "출결 정정", exact: true }).click();
    await dialog.getByRole("radio", { name: "출석", exact: true }).check();
    await dialog.getByLabel("정정 사유").fill("검증: 출석 확인 후 정정");
    await dialog.getByRole("button", { name: "정정 요청", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("출결 정정을 요청했습니다");
    await dialog.getByRole("button", { name: "출결 정정", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "정정 요청 검토", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "정정 승인", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("승인했습니다");
    expect(await row(1)).toMatchObject({ attendance: "present", correction_count: 1, deduction_state: "waived" });
  });

  test("취소: 이유 입력·확정 후 취소 표시, 기존 회차 보존", async ({ page }) => {
    const dialog = await day(page, 2);
    await dialog.getByRole("button", { name: "수업 취소", exact: true }).click();
    await dialog.getByLabel("취소 사유").fill("검증: 학생 요청");
    await dialog.getByRole("button", { name: "수업 취소 확정", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("수업을 취소했습니다");
    await expect(dialog.locator(".calendar-agenda-item")).toContainText("취소");
    await expect(dialog.getByRole("button", { name: "출결 처리", exact: true })).toHaveCount(0);
    expect(await row(2)).toMatchObject({ status: "canceled", attendance: null, deduction_state: "waived" });
  });

  test("일정 변경: 다른 달 보강 생성·원 회차 보존·새 날짜 바로 보기", async ({ page }) => {
    const dialog = await day(page, 3);
    await dialog.getByRole("button", { name: "일정 변경·보강", exact: true }).click();
    await dialog.getByLabel("변경 날짜").fill("2099-10-01");
    await dialog.getByLabel("변경 시간").fill("19:30");
    await dialog.getByLabel("수업 길이(분)").fill("1e100");
    await expect(dialog.getByRole("button", { name: "변경·보강 등록", exact: true })).toBeDisabled();
    await expect(dialog.getByLabel("변경·보강 사유")).toBeVisible();
    await dialog.getByLabel("수업 길이(분)").fill("90");
    await dialog.getByLabel("변경·보강 사유").fill("검증: 다른 달로 일정 변경");
    await dialog.getByRole("button", { name: "변경·보강 등록", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("보강 수업을 등록했습니다");
    expect(await row(3)).toMatchObject({ status: "canceled", deduction_state: "waived" });
    const replacement = await db.from("schedules").select("*").eq("tenant_id", tenantId).eq("origin_schedule_id", ids[3]).single();
    expect(replacement.error).toBeNull();
    expect(replacement.data).toMatchObject({ student_id: studentId, status: "makeup", class_type: "video" });
    expect(new Date(replacement.data!.scheduled_at).toISOString()).toBe("2099-10-01T10:30:00.000Z");
    expect(new Date(replacement.data!.ends_at).toISOString()).toBe("2099-10-01T12:00:00.000Z");
    await dialog.getByRole("link", { name: "변경된 수업 보기" }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("month") === "2099-10" && url.searchParams.get("student") === studentId);
    await expect(dialog.getByRole("heading", { level: 2 })).toContainText("2099.10.01");
    await expect(dialog.locator(".calendar-agenda-item")).toContainText("19:30–21:00");
  });

  test("노쇼: 연락 세 번 기록하기 전 확정 금지, 기록 후 확정", async ({ page }) => {
    const dialog = await day(page, 4);
    await dialog.getByRole("button", { name: "출결 처리", exact: true }).click();
    await dialog.getByRole("radio", { name: "노쇼", exact: true }).check();
    await expect(dialog.getByRole("button", { name: "노쇼 확정", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: /연락 기록 확인/ }).click();
    for (const mark of ["10", "20", "30"]) {
      await expect(dialog.getByLabel("연락 시점")).toHaveValue(mark);
      await dialog.getByRole("button", { name: "연락 기록 저장", exact: true }).click();
      await expect(dialog.locator('.calendar-contact-timeline li[data-recorded="true"]')).toHaveCount(Number(mark) / 10);
    }
    await dialog.getByRole("button", { name: "노쇼 출결 처리로 이동" }).click();
    await dialog.getByRole("button", { name: "노쇼 확정", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("노쇼 처리했습니다");
    expect(await row(4)).toMatchObject({ attendance: "noshow", status: "done" });
  });

  test("시작 전 확정 금지·연락 기록 금지·변경 중복 차단·요청 실패 시 입력 유지", async ({ page }) => {
    const dialog = await day(page, 5);
    await dialog.getByRole("button", { name: "출결 처리", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "출석 확정", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "연락 기록", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "연락 기록 저장", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "일정 변경·보강", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "변경·보강 등록", exact: true })).toBeDisabled();
    await dialog.getByLabel("변경 날짜").fill("2099-10-01");
    await dialog.getByLabel("변경 시간").fill("19:30");
    await dialog.getByLabel("변경·보강 사유").fill("검증: 서버에서 다른 달 중복도 검사");
    await dialog.getByRole("button", { name: "변경·보강 등록", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("이미 다른 수업");
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
    await dialog.getByLabel("취소 사유").fill("네트워크 실패 입력 보존");
    await page.route("**/admin/schedules?**", (route) => route.request().method() === "POST" ? route.abort() : route.continue());
    await dialog.getByRole("button", { name: "수업 취소 확정", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("입력 내용은 유지됩니다");
    await expect(dialog.getByLabel("취소 사유")).toHaveValue("네트워크 실패 입력 보존");
    expect(await row(5)).toMatchObject({ status: "planned", attendance: null });
  });

  test("모바일 다크 모드: 지각·조퇴 시각 입력, 팝업 내부 스크롤과 복귀", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const dialog = await day(page, 6);
    await dialog.getByRole("button", { name: "일정 팝업 닫기" }).click();
    await page.getByRole("button", { name: "다크 모드로 전환" }).click();
    await page.getByRole("button", { name: /^2020-01-12 수업/ }).click();
    await dialog.getByRole("button", { name: "출결 처리", exact: true }).click();
    await dialog.getByRole("radio", { name: "지각", exact: true }).check();
    await expect(dialog.getByLabel("실제 시작 시각")).toBeVisible();
    await dialog.getByRole("radio", { name: "조퇴", exact: true }).check();
    await expect(dialog.getByLabel("실제 시작 시각")).toHaveCount(0);
    await dialog.getByLabel("실제 종료 시각").fill("2020-01-12T10:30");
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await dialog.getByRole("button", { name: "조퇴 확정", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("조퇴 처리했습니다");
    expect(await row(6)).toMatchObject({ attendance: "early_leave", status: "done" });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });
});
