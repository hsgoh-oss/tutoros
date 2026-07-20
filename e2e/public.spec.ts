import { test, expect } from "@playwright/test";

test.describe("공개 사이트", () => {
  test("홈: 히어로 h1 + 상담 CTA 렌더", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("성적이 오르는");
    await expect(page.getByRole("link", { name: "무료 상담 신청" })).toBeVisible();
  });

  test("6페이지 + 약관 3종: 각 페이지 h1 렌더 + 200 응답", async ({ page }) => {
    test.setTimeout(120_000); // dev 콜드 컴파일 다중 네비 여유
    const paths = [
      "/tutor",
      "/classes",
      "/reviews",
      "/faq",
      "/consult",
      "/terms",
      "/privacy",
      "/refund-policy",
    ];
    for (const p of paths) {
      const resp = await page.goto(p);
      expect(resp?.status(), p).toBeLessThan(400);
      await expect(page.locator("h1").first(), p).toBeVisible();
    }
  });

  test("수업료 계산기: 회당 시간 변경 시 총액 갱신", async ({ page }) => {
    await page.goto("/classes");
    const calc = page.locator("#calculator");
    await expect(calc).toContainText("1,600,000"); // 대면 2.5h × 주2회 × 4주 기본값
    await calc.locator("select").first().selectOption("3"); // 회당 3시간
    await expect(calc).toContainText("1,920,000"); // 80,000 × 3 × 2 × 4
  });

  test("상담 폼: 빈 제출 검증 + 만14세 보호자 게이팅", async ({ page }) => {
    await page.goto("/consult");
    await page.getByRole("button", { name: "상담 신청하기" }).click();
    await expect(page.getByText("이름을 입력해 주세요.")).toBeVisible();

    await page.getByText("학생 본인이 신청합니다").click();
    await expect(page.getByText("출생년도")).toBeVisible();
    await page.locator('select[name="birthYear"]').selectOption("2014"); // 만 14세 미만
    await expect(page.getByText(/법정대리인/).first()).toBeVisible();
  });

  test("FAQ: FAQPage 구조화 데이터(JSON-LD) 삽입", async ({ page }) => {
    await page.goto("/faq");
    const ld = page.locator('script[type="application/ld+json"]');
    await expect(ld).toHaveCount(1);
    expect(await ld.textContent()).toContain('"FAQPage"');
  });

  test("상담 폼 제출: DB 미연결 시 graceful 에러 표시", async ({ page }) => {
    await page.goto("/consult");
    await page.getByPlaceholder("홍길동").fill("테스트학생");
    await page.locator('input[inputmode="numeric"]').first().fill("01012345678");
    // [필수] 개인정보 동의 체크박스 — 라벨 내 링크 오클릭 방지 위해 input 직접 체크
    await page.locator('input[name="privacyConsent"]').check();
    await page.getByRole("button", { name: "상담 신청하기" }).click();
    await expect(
      page.getByText(/데이터베이스 미연결|오류가 발생/),
    ).toBeVisible();
  });

  test("모바일 320px: 홈 가로 오버플로우 없음", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/");
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBeFalsy();
  });
});
