import { defineConfig, devices } from "@playwright/test";

// E2E — DB 미연결 dev 서버(:3003, AUTH_DEV_MODE=true) 대상.
// 공개 사이트는 기본 콘텐츠로 완전 렌더되고, 관리자는 dev OTP로 로그인해 화면 로드까지 검증한다.
// 데이터 변경(CRUD happy-path)은 연결된 Supabase가 필요해 이 스위트 범위 밖(빈 상태/graceful만 검증).
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
      testMatch: /admin\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/admin.json" },
    },
  ],
  // 프로덕션 서버(next start) 대상 — 라우트 콜드 컴파일이 없어 동시성/안정성이 dev보다 훨씬 좋다.
  // 사전에 `next build`가 되어 있어야 한다. AUTH_SECRET은 프로덕션 부팅 하드페일 가드 충족용(E2E 전용값).
  webServer: {
    command: 'node "node_modules/next/dist/bin/next" start -p 3100',
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AUTH_DEV_MODE: "true",
      AUTH_SECRET: "e2e-playwright-secret-do-not-use-in-prod",
    },
  },
});
