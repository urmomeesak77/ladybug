import { test as base } from '@playwright/test';

// The e2e specs run serially against ONE shared, once-seeded stack (docker-compose.e2e.yml).
// Every spec's assertions assume the pristine baseline corpus (20 posts, the newest carrying
// 3 comments), but destructive specs (deactivating a meme, adding a comment) mutate that shared
// state and would leak it into later specs. This fixture resets the disposable e2e database to
// the seed before each test via the backend's test-only route, so every test starts identical
// and order-independent. Specs import `test`/`expect` from here instead of '@playwright/test'.

// The isolated e2e backend (docker-compose.e2e.yml maps it to 8001); the SPA baseURL is 5174.
const BACKEND_URL = process.env.E2E_BACKEND_URL ?? 'http://localhost:8001';

export const test = base.extend<{ resetDb: void }>({
  // `auto` so every test resets without opting in. Uses the isolated `request` context (no SPA
  // Origin/session cookie), so Sanctum treats the call as stateless and skips CSRF.
  resetDb: [
    async ({ request }, use) => {
      const response = await request.post(`${BACKEND_URL}/api/testing/reset`);
      if (!response.ok()) {
        throw new Error(`e2e DB reset failed: ${response.status()} ${response.statusText()}`);
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
