import { test as setup, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// 관리자 dev OTP 로그인 → storageState 저장(관리자 스펙이 재사용해 재로그인/rate-limit 회피).
const authFile = "e2e/.auth/admin.json";
const ADMIN_EMAIL = "hsgoh05@gmail.com";

setup("관리자 로그인(dev OTP)", async ({ page }) => {
  await page.goto("/admin/login?next=/admin/dashboard");
  await page.getByPlaceholder("you@example.com").fill(ADMIN_EMAIL);
  await page.getByRole("button", { name: "인증번호 받기" }).click();

  const codeLine = page.getByText(/개발 모드 인증번호:/);
  await expect(codeLine).toBeVisible();
  const code = ((await codeLine.textContent()) ?? "").match(/(\d{6})/)?.[1];
  expect(code, "dev OTP 코드가 화면에 표시되어야 함").toBeTruthy();

  await page.getByPlaceholder("000000").fill(code!);
  await page.getByRole("button", { name: "로그인" }).click();

  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15_000 });
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
});
