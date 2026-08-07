import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from './helpers/e2eReset';

import { AdminSetup } from './helpers/adminSetup';
import { MailLog } from './helpers/mailLog';

// End-to-end coverage of animated-image viewport autoplay (021 US1/US2, FR-001/002/003/006,
// SC-006) against the ISOLATED e2e stack (run via scripts\e2e.ps1). An animated GIF and an
// animated WebP are uploaded for real, so the whole chain is exercised: the upload pipeline's
// animation-preserving variants, the API's media URLs, the ImageDecoder probe over the wire,
// and the <img> -> <canvas> takeover. Both formats run the identical assertion set — that
// sameness IS the FR-006 claim, so the two are deliberately not asserted differently.
//
// Chromium-only by construction: playwright.config.ts declares a single chromium project, and
// ImageDecoder is exactly what Safari lacks (FR-012's fallback path, unobservable here).

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../backend/tests/fixtures',
);

function uniqueEmail(): string {
  return `e2e+${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

async function register(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Display name').fill('E2E Animator');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Password1');
  await page.getByLabel('Re-type password').fill('Password1');
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByText('Welcome, E2E Animator! Check your inbox to verify your e-mail.'))
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

// Returns the new meme's hash. The account is promoted to superuser BEFORE uploading, so
// TrashpostService::createPost auto-activates on the admin+ branch (011) and the post is
// publicly visible immediately — no moderation round-trip needed, unlike video-playback.spec,
// which uploads first. Nothing here depends on the pending state.
async function upload(
  page: import('@playwright/test').Page,
  title: string,
  file: string,
): Promise<string> {
  await page.goto('/upload');
  await page.getByRole('tab', { name: 'Image' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Image file').setInputFiles(path.join(FIXTURES, file));
  await page.getByRole('button', { name: 'Post' }).click();
  await expect(page).toHaveURL(/\/posts\/[A-Za-z0-9_-]{10}$/);

  return new URL(page.url()).pathname.split('/').pop() ?? '';
}

// Centre the post in the viewport. Centring (rather than Playwright's minimal
// scrollIntoViewIfNeeded) is what makes the visibility rule's outcome unambiguous: a post
// shorter than the window ends up fully on screen, a taller one fills it, and either way it
// clears both halves of the FR-011 test.
function scrollTo(canvas: import('@playwright/test').Locator): Promise<void> {
  return canvas.evaluate((el) => el.scrollIntoView({ block: 'center' }));
}

// The FR-001/002/003 cycle: playing while the post is on screen, frozen once it is not, and
// playing again on the way back. data-playing is the one externally observable signal for
// this (MemeImage renders it off the player's own isPlaying), which is why it exists.
//
// Nothing here assumes where the post sits at load time — the caller's page may have several
// posts and only the first is above the fold, so every phase scrolls deliberately.
async function expectPlayFreezeResume(
  page: import('@playwright/test').Page,
  canvas: import('@playwright/test').Locator,
): Promise<void> {
  await expect(canvas).toBeVisible();
  await scrollTo(canvas);
  await expect(canvas).toHaveAttribute('data-playing', 'true');

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  // Check the GEOMETRY before the behaviour. The freeze rule is "neither half the element nor
  // half the window is covered", so a page too short to scroll the post out of that reach
  // would make the assertion below fail for a reason that has nothing to do with playback.
  // Failing here instead names that cause outright.
  const cover = await canvas.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const visible = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));

    return { ofElement: visible / r.height, ofWindow: visible / (window.innerHeight / 2) };
  });
  expect(cover.ofElement, 'scrolled far enough to fail the ratio test').toBeLessThan(0.5);
  expect(cover.ofWindow, 'scrolled far enough to fail the tall-meme test').toBeLessThan(1);
  await expect(canvas).toHaveAttribute('data-playing', 'false');

  await scrollTo(canvas);
  await expect(canvas).toHaveAttribute('data-playing', 'true');
}

test.describe('Animated image viewport autoplay', () => {
  test('an animated GIF and WebP take over to a canvas that plays, freezes and resumes',
    async ({ page }) => {
      // Register + verify + two real uploads + two page loads, well past the default budget.
      test.setTimeout(120_000);
      const email = uniqueEmail();
      await register(page, email);
      await verify(page, email);
      AdminSetup.promoteToSuperuser(email);

      const stamp = Date.now() % 1_000_000;
      const gifHash = await upload(page, `Gif ${stamp}`, 'animated.gif');
      const webpHash = await upload(page, `Webp ${stamp}`, 'animated.webp');

      // Feed (US1): both posts are newest, so both are in the first batch. Each must have
      // swapped its <img> for a canvas and must run the full play/freeze/resume cycle.
      await page.goto('/');
      for (const hash of [webpHash, gifHash]) {
        const canvas = page.locator(`li[data-hash="${hash}"] canvas.meme-media__canvas`);
        // The <img> is gone, not merely hidden — the swap is a replacement (FR-013).
        await expect(canvas).toBeVisible();
        await expect(page.locator(`li[data-hash="${hash}"] img.meme-media__image`)).toHaveCount(0);
        await expectPlayFreezeResume(page, canvas);
      }

      // Permalink (US2): the same behaviour with no permalink <Link> wrapper. A short viewport
      // guarantees there is room to scroll the media out of the visibility rule's reach, so the
      // freeze half is really exercised rather than silently skipped on a page that never moves.
      await page.setViewportSize({ width: 480, height: 300 });
      for (const hash of [gifHash, webpHash]) {
        await page.goto(`/posts/${hash}`);
        const canvas = page.locator('canvas.meme-media__canvas');
        await expect(canvas).toBeVisible();
        await expect(canvas.locator('xpath=ancestor::a')).toHaveCount(0);
        await expectPlayFreezeResume(page, canvas);
      }
    });
});
