import { test, expect } from "@playwright/test";

// storageState(admin.json)로 이미 인증된 상태 — 재로그인 불필요.
test.describe("관리자", () => {
  test("대시보드: 신규 위젯 5종 렌더", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await expect(page.getByRole("heading", { name: "대시보드" })).toBeVisible();
    for (const label of ["오늘 수업", "청구 필요", "D-day", "모집 상태", "최근 변경"]) {
      await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
    }
  });

  test("전 관리자 페이지 로드(크래시 없음)", async ({ page }) => {
    test.setTimeout(180_000); // dev 콜드 컴파일 15개 라우트 여유
    const paths = [
      "/admin/students",
      "/admin/consultations",
      "/admin/lessons",
      "/admin/schedules",
      "/admin/grades",
      "/admin/payments",
      "/admin/reviews",
      "/admin/faq",
      "/admin/materials",
      "/admin/dday",
      "/admin/recruit",
      "/admin/settings",
      "/admin/reports",
      "/admin/activity",
    ];
    for (const p of paths) {
      const resp = await page.goto(p);
      expect(resp?.status(), p).toBeLessThan(400);
      // 보호 레이아웃(사이드바)이 렌더 = 인증 통과 + 크래시 없음
      await expect(page.getByRole("link", { name: "학생 관리" }), p).toBeVisible();
    }
  });

  test("일정: 월/주 캘린더 뷰 토글", async ({ page }) => {
    await page.goto("/admin/schedules?view=month");
    await expect(page.getByRole("link", { name: "월간", exact: true })).toBeVisible();
    await expect(page.getByText("일", { exact: true }).first()).toBeVisible();
    await page.goto("/admin/schedules?view=week");
    await expect(page.getByRole("link", { name: "주간", exact: true })).toBeVisible();
  });

  test("변경 이력 페이지 로드", async ({ page }) => {
    await page.goto("/admin/activity");
    await expect(page.locator("h1")).toBeVisible();
  });
});
