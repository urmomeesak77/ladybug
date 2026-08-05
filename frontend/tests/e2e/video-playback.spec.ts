import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from './helpers/e2eReset';

import { AdminSetup } from './helpers/adminSetup';
import { MailLog } from './helpers/mailLog';

// End-to-end coverage of autoplay-on-scroll (019 US3, FR-008, quickstart Scenario 3): a
// video post starts muted playback once visible — on the feed and on its own permalink —
// and pauses when scrolled out of view, against the ISOLATED e2e stack (run via
// scripts\e2e.ps1). Reuses the same small, real fixture the backend's own video tests use
// (backend/tests/fixtures/sample.mp4), so the upload is genuinely decodable.

const SAMPLE_MP4 = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../backend/tests/fixtures/sample.mp4',
);

function uniqueEmail(): string {
  return `e2e+${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

async function register(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Display name').fill('E2E Viewer');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Password1');
  await page.getByLabel('Re-type password').fill('Password1');
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByText('Welcome, E2E Viewer! Check your inbox to verify your e-mail.'))
    .toBeVisible({ timeout: 25000 });
  await page.getByRole('button', { name: 'Ok' }).click();
}

async function verify(page: import('@playwright/test').Page, email: string): Promise<void> {
  await expect(page).toHaveURL('/verify-email');
  const link = MailLog.latestVerificationLink(email);
  expect(link).not.toBeNull();
  await page.goto(link ?? '');
  await expect(page.getByText('Your e-mail is verified.')).toBeVisible();
}

async function uploadVideo(page: import('@playwright/test').Page, title: string): Promise<void> {
  await page.goto('/upload');
  await page.getByRole('tab', { name: 'Video' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Video file').setInputFiles(SAMPLE_MP4);
  await page.getByRole('button', { name: 'Post' }).click();
}

// A fresh account starts below the trust threshold (011), so the upload is created pending
// and must be activated through the admin console before it is publicly visible — the same
// promotion + activation round-trip upload.spec.ts uses for a pending image.
function activate(
  page: import('@playwright/test').Page,
  email: string,
  title: string,
): Promise<void> {
  AdminSetup.promoteToSuperuser(email);
  return (async () => {
    await page.goto('/admin/trashposts');
    await page.reload();
    const row = page.locator('tbody tr.moderation-row').filter({ hasText: title });
    await expect(row).toHaveCount(1);
    const trigger = row.locator('.action-menu__trigger');
    await trigger.click();
    await row.getByRole('menuitem', { name: 'Activate', exact: true }).click();
    // The click only dispatches the DOM event — the activation request is still in flight
    // when it resolves. Reopening the menu and waiting for it to now offer "Deactivate"
    // (like upload.spec.ts's equivalent image flow) blocks until the row's state actually
    // updated, so the caller never navigates away mid-request.
    await trigger.click();
    await expect(row.getByRole('menuitem', { name: 'Deactivate', exact: true })).toBeVisible();
  })();
}

test.describe('Video playback', () => {
  test('autoplays muted on the permalink and in the feed, pausing out of view', async ({ page }) => {
    test.setTimeout(90_000);
    const email = uniqueEmail();
    const title = `Video ${Date.now() % 1_000_000}`;
    await register(page, email);
    await verify(page, email);
    await uploadVideo(page, title);
    await expect(page).toHaveURL(/\/posts\/[A-Za-z0-9_-]{10}$/);
    const hash = new URL(page.url()).pathname.split('/').pop() ?? '';

    await activate(page, email, title);

    // Permalink (Scenario 3 §4): a fresh load autoplays muted, poster visible until then.
    await page.goto(`/posts/${hash}`);
    const permalinkVideo = page.locator('video.meme-media__video');
    await expect(permalinkVideo).toHaveAttribute('poster', /.+/);
    await expect.poll(() => permalinkVideo.evaluate((el: HTMLVideoElement) => el.paused)).toBe(false);
    await expect.poll(() => permalinkVideo.evaluate((el: HTMLVideoElement) => el.muted)).toBe(true);
    await expect(page.getByRole('button', { name: 'Unmute' })).toBeVisible();

    // Feed (Scenario 3 §1-3): the just-activated post is newest, so it loads already in view
    // and autoplays the same way; scrolling it away pauses it, scrolling back resumes it.
    await page.goto('/');
    const feedVideo = page.locator(`li[data-hash="${hash}"] video.meme-media__video`);
    await expect(feedVideo).toBeVisible();
    await expect.poll(() => feedVideo.evaluate((el: HTMLVideoElement) => el.paused)).toBe(false);

    await page.mouse.wheel(0, 5000);
    await expect.poll(() => feedVideo.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);

    await page.mouse.wheel(0, -5000);
    await expect.poll(() => feedVideo.evaluate((el: HTMLVideoElement) => el.paused)).toBe(false);
  });
});
