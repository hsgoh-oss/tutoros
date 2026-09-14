import { test, expect } from "@playwright/test";

// storageState(admin.json)로 이미 인증된 상태 — 재로그인 불필요.
test.describe("관리자", () => {
  test("학생 검색: 상태를 바꿔도 검색어가 유지되고 빈 결과에서 복귀할 수 있다", async ({ page }) => {
    await page.goto("/admin/students");
    await page.getByRole("textbox", { name: "학생 이름 검색" }).fill("UI검토_없는학생");
    await page.getByRole("button", { name: "검색", exact: true }).click();
    const main = page.locator("main");
    await expect(page).toHaveURL((url) => url.searchParams.get("q") === "UI검토_없는학생");
    await expect(main.getByText("조건에 맞는 학생이 없습니다")).toBeVisible();
    await main.getByRole("link", { name: "재원", exact: true }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("q") === "UI검토_없는학생" && url.searchParams.get("status") === "active");
    await expect(main.getByText("조건에 맞는 학생이 없습니다")).toBeVisible();
    await main.getByRole("link", { name: "전체", exact: true }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("q") === "UI검토_없는학생" && !url.searchParams.has("status"));
    await main.getByRole("link", { name: "전체 학생 보기", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/students$/);
  });

  test("학생별 조회: 상태·유형 필터를 바꿔도 학생 조건을 유지한다", async ({ page }) => {
    test.setTimeout(90_000);
    const student = "00000000-0000-4000-8000-000000000001";
    const cases = [
      { path: "payments", key: "status", value: "paid", label: "완납" },
      { path: "reports", key: "type", value: "lesson", label: "수업" },
      { path: "packages", key: "status", value: "active", label: "진행" },
      { path: "enrollments", key: "status", value: "active", label: "활성" },
      { path: "homework", key: "status", value: "draft", label: "초안" },
    ];
    for (const item of cases) {
      await page.goto(`/admin/${item.path}?student=${student}`);
      const main = page.locator("main");
      await main.getByRole("link", { name: item.label, exact: true }).click();
      await expect(page).toHaveURL((url) => url.searchParams.get("student") === student && url.searchParams.get(item.key) === item.value);
      await expect(main.getByRole("link", { name: item.label, exact: true })).toHaveAttribute("aria-current", "page");
      await main.getByRole("link", { name: "전체", exact: true }).click();
      await expect(page).toHaveURL((url) => url.searchParams.get("student") === student && !url.searchParams.has(item.key));
    }
  });

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
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const p of paths) {
      const resp = await page.goto(p);
      expect(resp?.status(), p).toBeLessThan(400);
      await expect(page.getByRole("navigation", { name: "관리자 메뉴", exact: true }), p).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 }), p).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test("사이드바: 그룹 펼침·경로 표시·접기", async ({ page }) => {
    await page.goto("/admin/schedules");
    const sideMenu = page.getByRole("navigation", { name: "관리자 메뉴", exact: true });
    await expect(sideMenu.getByRole("link", { name: "수업 캘린더" })).toHaveAttribute("aria-current", "page");
    await expect(sideMenu.getByRole("link", { name: "출결·정정" })).toBeVisible();
    await sideMenu.getByRole("button", { name: "정산", exact: true }).click();
    await sideMenu.getByRole("link", { name: "결제 관리" }).click();
    await expect(page).toHaveURL(/\/admin\/payments/);
    await expect(sideMenu.getByRole("link", { name: "결제 관리" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "사이드바 접기" }).click();
    await expect(page.getByRole("button", { name: "사이드바 펼치기" })).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "사이드바 펼치기" }).click();
    await expect(sideMenu.getByRole("link", { name: "결제 관리" })).toBeVisible();
  });

  test("메뉴 검색: 단축키·키보드 이동·검색·닫기", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "메뉴 검색", exact: true });
    const search = dialog.getByRole("combobox");
    await expect(search).toBeFocused();
    await search.press("ArrowDown");
    await expect(search).toHaveAttribute("aria-activedescendant", "admin-search-1");
    await search.fill("없는메뉴");
    await expect(dialog.getByText("일치하는 메뉴가 없습니다.")).toBeVisible();
    await search.fill("결제");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/admin\/payments/);
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "메뉴 검색", exact: true }).click();
    await search.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("button", { name: "메뉴 검색", exact: true })).toBeFocused();
  });

  test("테마: 페이지 이동과 새로고침 후 유지", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await page.getByRole("button", { name: "다크 모드로 전환" }).click();
    await page.goto("/admin/students/new");
    await expect(page.locator(".admin-surface")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("input").first()).toHaveCSS("background-color", "rgb(24, 24, 27)");
    await page.reload();
    await expect(page.locator(".admin-surface")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "라이트 모드로 전환" }).click();
    await expect(page.locator(".admin-surface")).toHaveAttribute("data-theme", "light");
  });

  test("모바일: 메뉴 열기·이동·닫기와 가로 넘침 없음", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/dashboard");
    await page.getByRole("button", { name: "메뉴 열기" }).click();
    const drawer = page.getByRole("dialog", { name: "관리자 메뉴", exact: true });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: "학생", exact: true }).click();
    await drawer.getByRole("link", { name: "학생 관리" }).click();
    await expect(page).toHaveURL(/\/admin\/students/);
    await expect(drawer).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "메뉴 열기" }).click();
    await page.keyboard.press("Escape");
    await expect(drawer).not.toBeVisible();
  });

  test("대시보드: 기간 변경과 차트 키보드 조회", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await page.getByRole("navigation", { name: "상담 추이 기간" }).getByRole("link", { name: "7일", exact: true }).click();
    await expect(page).toHaveURL(/range=7/);
    await expect(page.getByRole("heading", { name: "최근 7일 상담 접수" })).toBeVisible();
    const plot = page.getByRole("group", { name: /일별 상담 접수/ });
    await plot.focus();
    await plot.press("ArrowRight");
    await expect(plot.getByRole("status")).toContainText("건");
  });

  test("삭제 확인: 취소와 Escape로 작업 없이 복귀", async ({ page }) => {
    await page.goto("/admin/students");
    const trigger = page.locator("main").getByRole("button", { name: "삭제", exact: true }).first();
    test.skip(await trigger.count() === 0, "삭제할 수 있는 학생이 없는 데이터셋");
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "삭제", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "취소" })).toBeFocused();
    await dialog.getByRole("button", { name: "취소" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeVisible();
  });

  test("업무 처리: 사유 입력과 취소", async ({ page }) => {
    await page.goto("/admin/dashboard");
    const trigger = page.getByRole("button", { name: "완료", exact: true }).first();
    test.skip(await trigger.count() === 0, "열려 있는 업무가 없는 데이터셋");
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "업무 완료", exact: true });
    await expect(dialog.getByRole("textbox", { name: "처리 내용" })).toBeFocused();
    await expect(dialog.getByRole("button", { name: "완료 처리" })).toBeDisabled();
    await dialog.getByRole("textbox").fill("검토 완료");
    await expect(dialog.getByRole("button", { name: "완료 처리" })).toBeEnabled();
    await dialog.getByRole("button", { name: "취소" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeVisible();
  });

  test("작업 요청 실패: 안내 후 다시 시도할 수 있다", async ({ page }) => {
    await page.goto("/admin/students");
    const trigger = page.locator("main").getByRole("button", { name: "삭제", exact: true }).first();
    test.skip(await trigger.count() === 0, "학생이 없는 데이터셋");
    // 서버로 전송하기 전에 차단해 실제 데이터는 변경하지 않는다.
    await page.route("**/admin/students", (route) => route.request().method() === "POST" ? route.abort() : route.continue());
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "삭제", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("요청을 완료하지 못했습니다");
    await dialog.getByRole("button", { name: "확인" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeEnabled();
  });

  test("설정: 수업료·브라우저 푸시 카드가 있다", async ({ page }) => {
    await page.goto("/admin/settings");
    await expect(page.getByRole("heading", { name: "수업료" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "브라우저 푸시 알림" })).toBeVisible();
  });

  test("개인정보 보존: 한계를 화면이 먼저 밝힌다", async ({ page }) => {
    await page.goto("/admin/privacy");
    await expect(
      page.getByText("이 원장은 기한을 계산하고 기록할 뿐, 데이터를 지우지 않습니다."),
    ).toBeVisible();
    // 자동 기산하지 못하는 사건을 숨기지 않는다 — 비어 있는 이유가 화면에 있어야 한다.
    await expect(page.getByText("아직 자동으로 기산하지 않는 사건")).toBeVisible();
    // 후기 철회는 00025 이후 기산한다(retracted_at) — 남은 미기산 사건은 반려·미게시 종료다.
    await expect(page.getByText("후기·사례 반려·미게시 종료", { exact: false })).toBeVisible();
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
