import { defineConfig, devices } from '@playwright/test';

// Browser e2e. These specs register real users, so they must run against the ISOLATED,
// disposable e2e stack (frontend 5174 -> backend 8001 -> throwaway ladybug_e2e DB), NEVER
// the live dev stack on 5173/8000 whose backend writes to trashdb. Launch it with
// `scripts\e2e.ps1`, which brings up docker-compose.e2e.yml and sets E2E_BASE_URL below.
// There is no managed webServer here (the script owns the stack lifecycle). Vitest unit
// specs use the *.test.* suffix, Playwright the *.spec.* suffix, so sharing tests/ is
// collision-free.
export default defineConfig({
  testDir: './tests/e2e',
  // One shared dev server + API: run serially so parallel cold-transform loads do not
  // race past the data-fetch timeout. The feed loads asynchronously, so assertions get a
  // generous timeout for the first batch to arrive.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  // Each test resets the shared e2e DB to the seed first (helpers/e2eReset), a migrate:fresh
  // + seed that adds a few seconds before the test body — so the per-test budget is generous.
  timeout: 60_000,
  expect: { timeout: 15000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
