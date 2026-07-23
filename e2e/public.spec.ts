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

  test("수업료 계산기: 스테퍼 재계산 · 경계값 비활성 · 프리필", async ({ page }) => {
    await page.goto("/classes");
    const calc = page.locator("#calculator");

    // 대면 80,000 × 2.5h × 주2회 × 4주 = 1,600,000 (기본값) + 산식 병기(기획 7-6 필수)
    await expect(calc).toContainText("1,600,000");
    await expect(calc).toContainText("시간당 80,000원 × 2.5시간 × 주 2회 × 4주 = 1,600,000원");

    await calc.getByLabel("회당 시간 30분 늘리기").click(); // 3.0h
    await expect(calc).toContainText("1,920,000"); // 80,000 × 3 × 2 × 4

    await calc.getByLabel("주당 횟수 늘리기").click(); // 주 3회
    await expect(calc).toContainText("2,880,000"); // 80,000 × 3 × 3 × 4

    await calc.getByRole("button", { name: "화상", exact: true }).click();
    await expect(calc).toContainText("2,160,000"); // 60,000 × 3 × 3 × 4

    // 상담 폼 프리필(mode/hours/freq)
    await expect(calc.getByRole("link", { name: "이 구성으로 상담 신청" })).toHaveAttribute(
      "href",
      "/consult?mode=video&hours=3&freq=3",
    );

    // 경계값 비활성 — 최소 2시간에서 감소 버튼 disabled
    const dec = calc.getByLabel("회당 시간 30분 줄이기");
    await dec.click(); // 2.5
    await dec.click(); // 2.0
    await expect(dec).toBeDisabled();
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

  // .env.local의 SUPABASE_* 를 상속해 실 DB에 접수한다(현 Supabase는 테스트 환경).
  // 남는 행은 이름 접두사 E2E상담- 으로 식별한다.
  test("상담 폼 제출: 접수 완료 화면까지 도달", async ({ page }) => {
    await page.goto("/consult");
    await page.getByPlaceholder("홍길동").fill(`E2E상담-${Date.now()}`);
    await page.locator('input[inputmode="numeric"]').first().fill("01012345678");
    // [필수] 개인정보 동의 체크박스 — 라벨 내 링크 오클릭 방지 위해 input 직접 체크
    await page.locator('input[name="privacyConsent"]').check();
    await page.getByRole("button", { name: "상담 신청하기" }).click();

    await expect(
      page.getByRole("heading", { name: "상담 신청이 접수되었습니다" }),
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
