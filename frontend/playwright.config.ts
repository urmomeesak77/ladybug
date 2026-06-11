import { defineConfig, devices } from '@playwright/test';

// Browser e2e for the Home feed. Runs against the already-running dev stack (Vite on
// 5173, the feature 004 API on 8000 via Docker), so there is no managed webServer here —
// start the stack first (see README / quickstart). Vitest unit specs live under tests/
// and are excluded by scoping Playwright to e2e/.
export default defineConfig({
  testDir: './e2e',
  // One shared dev server + API: run serially so parallel cold-transform loads do not
  // race past the data-fetch timeout. The feed loads asynchronously, so assertions get a
  // generous timeout for the first batch to arrive.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  expect: { timeout: 15000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
