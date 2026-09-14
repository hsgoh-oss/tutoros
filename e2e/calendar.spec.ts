import { test, expect } from "@playwright/test";
import { calendarHref, calendarReturnHref, placeSchedulesOnDay, schedulesOnDay, validCalendarDate, validCalendarMonth } from "../lib/admin-calendar";
import type { ScheduleListItem } from "../lib/data/crm";

const sample = (id: string, scheduledAt: string, endsAt: string): ScheduleListItem => ({
  id, studentId: id, studentName: id, scheduledAt, endsAt, classType: "inperson", status: "planned",
  reminderSent: false, lessonId: null, packageId: null, contractId: null, attendance: null,
  deductionState: "none", correctionCount: 0, originScheduleId: null, conflictReason: null,
});

test("캘린더 계산: 실제 날짜와 한국 자정·겹침·연속 수업", () => {
  expect(validCalendarDate("2028-02-29")).toBe(true);
  expect(validCalendarDate("2026-02-29")).toBe(false);
  expect(validCalendarDate("2026-13-01")).toBe(false);
  expect(validCalendarMonth("2026-00")).toBe(false);
  const overnight = sample("night", "2026-09-30T14:30:00Z", "2026-09-30T16:00:00Z");
  expect(schedulesOnDay([overnight], "2026-10-01")).toHaveLength(1);
  expect(placeSchedulesOnDay([overnight], "2026-09-30")[0]).toMatchObject({ startMin: 1410, endMin: 1440 });
  expect(placeSchedulesOnDay([overnight], "2026-10-01")[0]).toMatchObject({ startMin: 0, endMin: 60 });
  const sessions = [
    sample("a", "2026-09-08T10:00:00Z", "2026-09-08T11:00:00Z"),
    sample("b", "2026-09-08T10:30:00Z", "2026-09-08T11:30:00Z"),
    sample("c", "2026-09-08T11:30:00Z", "2026-09-08T12:30:00Z"),
  ];
  expect(placeSchedulesOnDay(sessions, "2026-09-08").map(({ column, columnCount }) => [column, columnCount])).toEqual([[0, 2], [1, 2], [0, 1]]);
});

test("캘린더 복귀: 날짜·학생을 유지하고 외부 주소는 거부", () => {
  const href = calendarHref({ view: "month", date: "2026-09-14", studentId: "00000000-0000-4000-8000-000000000001", day: "2026-09-08" });
  expect(calendarReturnHref(href, "/admin/schedules")).toBe(href);
  expect(calendarReturnHref("https://example.com", "/admin/schedules")).toBe("/admin/schedules");
  expect(calendarReturnHref("/admin/schedules?view=month&month=2026-13", "/admin/schedules")).toBe("/admin/schedules");
});

test("캘린더: 학생 필터·주월 전환·이전 다음 기간", async ({ page }) => {
  await page.goto("/admin/schedules?view=week&week=2099-09-14&date=2099-09-16");
  await expect(page.locator(".dash-navbar h1")).toBeVisible();
  const select = page.getByRole("combobox", { name: "학생별 일정" });
  const id = await select.locator('option:not([value=""])').first().getAttribute("value").catch(() => null);
  test.skip(!id, "학생이 없는 데이터셋");
  await select.selectOption(id!);
  await expect(page).toHaveURL((url) => url.searchParams.get("student") === id);
  await page.getByRole("link", { name: "월간", exact: true }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("month") === "2099-09" && url.searchParams.get("date") === "2099-09-16" && url.searchParams.get("student") === id);
  await page.getByRole("link", { name: "주간", exact: true }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("date") === "2099-09-16" && url.searchParams.get("student") === id);
  await page.getByRole("link", { name: "다음 주", exact: true }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("week") === "2099-09-21" && url.searchParams.get("student") === id);
});

test("캘린더: 날짜 키보드 선택·팝업 등록 전환·포커스 복귀", async ({ page }) => {
  await page.goto("/admin/schedules?view=month&month=2099-09");
  await expect(page.locator(".dash-navbar h1")).toBeVisible();
  const day = page.getByRole("button", { name: /^2099-09-08 수업/ });
  await day.focus();
  await day.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { level: 2 })).toContainText("2099.09.08");
  await dialog.getByRole("button", { name: "수업 추가", exact: true }).click();
  await expect(dialog.getByLabel("시작 시간")).toHaveValue("");
  await expect(dialog.getByRole("button", { name: "일정 등록", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "돌아가기" }).click();
  await expect(dialog.getByRole("button", { name: "수업 추가", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(day).toBeFocused();
});

test("캘린더: 빈 시간에서 등록·길이·학생 자동 입력과 요청 실패", async ({ page }) => {
  await page.goto("/admin/schedules?view=week&week=2099-09-14");
  await expect(page.locator(".dash-navbar h1")).toBeVisible();
  const select = page.getByRole("combobox", { name: "학생별 일정" });
  const id = await select.locator('option:not([value=""])').first().getAttribute("value").catch(() => null);
  test.skip(!id, "학생이 없는 데이터셋");
  await select.selectOption(id!);
  await expect(page).toHaveURL((url) => url.searchParams.get("student") === id);
  await expect(page.locator(".calendar-refreshing")).toHaveCount(0);
  await page.getByRole("button", { name: "2099-09-16 19:00 일정 추가", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("시작 시간")).toHaveValue("19:00");
  await expect(dialog.getByLabel("학생", { exact: false })).toHaveValue(id!);
  await dialog.getByLabel("수업 시간").selectOption("90");
  await expect(dialog.getByText("19:00 시작 · 20:30 종료")).toBeVisible();
  await page.route("**/admin/schedules?**", (route) => route.request().method() === "POST" ? route.abort() : route.continue());
  await dialog.getByRole("button", { name: "일정 등록", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("입력 내용은 유지됩니다");
  await expect(dialog.getByLabel("시작 시간")).toHaveValue("19:00");
  await expect(dialog.getByLabel("수업 시간")).toHaveValue("90");
  await expect(dialog.getByRole("button", { name: "일정 등록", exact: true })).toBeEnabled();
});

test("캘린더: 내보내기에 학생·조회 기간 전달", async ({ page }) => {
  await page.goto("/admin/schedules?view=month&month=2099-09");
  await expect(page.locator(".dash-navbar h1")).toBeVisible();
  const select = page.getByRole("combobox", { name: "학생별 일정" });
  const id = await select.locator('option:not([value=""])').first().getAttribute("value").catch(() => null);
  test.skip(!id, "학생이 없는 데이터셋");
  await select.selectOption(id!);
  await expect(page).toHaveURL((url) => url.searchParams.get("student") === id);
  await page.getByRole("link", { name: "내보내기", exact: true }).click();
  await expect(page.getByLabel("시작일")).toHaveValue("2099-09-01");
  await expect(page.getByLabel("종료일")).toHaveValue("2099-09-30");
  await expect(page.locator('select[name="studentId"]')).toHaveValue(id!);
  await page.getByRole("link", { name: "캘린더로" }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("month") === "2099-09" && url.searchParams.get("student") === id);
});

test("캘린더: 잘못된 날짜 복구·모바일 다크 모드 팝업", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/schedules?view=month&month=2026-99&day=invalid");
  await expect(page.locator(".dash-navbar h1")).toBeVisible();
  await expect(page.locator(".calendar-month")).toBeVisible();
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await expect(page.locator(".admin-surface")).toHaveAttribute("data-theme", "dark");
  await page.locator(".calendar-day-trigger").first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "수업 추가", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
