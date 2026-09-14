import { defineConfig, devices } from "@playwright/test";

// 기본 스위트는 dev OTP 로그인과 공개·관리자 화면 및 상호작용을 검증한다.
// CALENDAR_INTEGRATION=1이면 로컬 Supabase에서 별도 테스트 학생으로 캘린더 변경도 검증한다.
// 변경 검증은 외부 DB에서 실행되지 않으며, 테스트 학생과 일정은 종료 시 삭제한다.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "public",
      testMatch: /public\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "admin",
      testMatch: /(?:admin|commercial|calendar(?:-actions)?)\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/admin.json" },
    },
  ],
  // 화면에 OTP를 표시하는 E2E는 개발 서버에서만 실행한다. 운영 모드는 AUTH_DEV_MODE를 차단한다.
  webServer: {
    command: 'node "node_modules/next/dist/bin/next" dev --turbopack -p 3100',
    url: "http://localhost:3100",
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
    timeout: 120_000,
    env: {
      AUTH_DEV_MODE: "true",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-playwright-secret-do-not-use-in-prod",
    },
  },
});
