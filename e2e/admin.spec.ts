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
      "/admin/privacy",
      "/admin/messages",
      "/admin/trials",
      "/admin/enrollments",
      "/admin/packages",
      "/admin/homework",
      "/admin/attendance",
    ];
    for (const p of paths) {
      const resp = await page.goto(p);
      expect(resp?.status(), p).toBeLessThan(400);
      // 보호 레이아웃이 렌더 = 인증 통과 + 크래시 없음.
      // 판정 대상은 **상단 모듈 바**다: 좌측 메뉴는 지금 모듈 것만 보여주므로
      // 특정 항목("학생 관리")으로 판정하면 다른 모듈 화면에서 전부 실패한다.
      await expect(
        page.getByRole("navigation", { name: "업무 모듈" }),
        p,
      ).toBeVisible();
    }
  });

  test("모듈 바: 고른 모듈의 하위 메뉴만 보인다", async ({ page }) => {
    await page.goto("/admin/schedules");
    const moduleBar = page.getByRole("navigation", { name: "업무 모듈" });
    await expect(moduleBar.getByRole("link", { name: "수업" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // 같은 모듈의 형제는 좌측에 있고, 다른 모듈 화면은 없다.
    const sideMenu = page.getByRole("navigation", { name: "수업 메뉴" });
    await expect(sideMenu.getByRole("link", { name: "출결·정정" })).toBeVisible();
    await expect(sideMenu.getByRole("link", { name: "결제 관리" })).toHaveCount(0);

    // 모듈을 바꾸면 좌측이 통째로 갈린다.
    await moduleBar.getByRole("link", { name: "정산" }).click();
    await expect(page).toHaveURL(/\/admin\/payments/);
    await expect(
      page.getByRole("navigation", { name: "정산 메뉴" }).getByRole("link", {
        name: "메시지 발송",
      }),
    ).toBeVisible();
  });

  test("개인정보 보존: 한계를 화면이 먼저 밝힌다", async ({ page }) => {
    await page.goto("/admin/privacy");
    await expect(
      page.getByText("이 원장은 기한을 계산하고 기록할 뿐, 데이터를 지우지 않습니다."),
    ).toBeVisible();
    // 자동 기산하지 못하는 사건을 숨기지 않는다 — 비어 있는 이유가 화면에 있어야 한다.
    await expect(page.getByText("아직 자동으로 기산하지 않는 사건")).toBeVisible();
    await expect(page.getByText("콘텐츠·후기 철회", { exact: false })).toBeVisible();
  });

  test("발송 현황: 상태 필터가 URL로 유지된다", async ({ page }) => {
    await page.goto("/admin/messages?status=failed");
    await expect(page.getByRole("heading", { name: "발송 현황" })).toBeVisible();
    await expect(page.getByRole("link", { name: "실패", exact: true })).toHaveAttribute(
      "href",
      "/admin/messages?status=failed",
    );
  });

  test("옛 포털 토큰 경로는 사라졌다", async ({ page }) => {
    // 만료·회수 없는 링크였다(00024로 은퇴). 404가 아니면 회귀다.
    const resp = await page.goto("/portal/anything");
    expect(resp?.status()).toBe(404);
  });

  test("일정: 월/주 캘린더 뷰 토글", async ({ page }) => {
    await page.goto("/admin/schedules?view=month");
    await expect(page.getByRole("link", { name: "월간", exact: true })).toBeVisible();
    await expect(page.getByText("일", { exact: true }).first()).toBeVisible();
    await page.goto("/admin/schedules?view=week");
    await expect(page.getByRole("link", { name: "주간", exact: true })).toBeVisible();
  });

  test("변경 이력: 범주 필터", async ({ page }) => {
    await page.goto("/admin/activity");
    await expect(page.getByRole("heading", { name: "변경 이력" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "개인정보", exact: true }),
    ).toHaveAttribute("href", "/admin/activity?category=privacy");
  });
});
