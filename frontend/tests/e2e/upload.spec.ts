import { expect, test } from './helpers/e2eReset';

import { AdminSetup } from './helpers/adminSetup';
import { MailLog } from './helpers/mailLog';

// End-to-end coverage of the upload feature (008) against the ISOLATED e2e stack (run via
// scripts\e2e.ps1): a registered, verified, logged-in user uploads an image and lands on
// the new meme's permalink with the image rendered. Users + posts are written to the
// throwaway ladybug_e2e DB and its disposable media tree, never the live dev stack.

function uniqueEmail(): string {
  return `e2e+${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

async function register(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Display name').fill('E2E Uploader');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Password1');
  await page.getByLabel('Re-type password').fill('Password1');
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByText('Welcome, E2E Uploader! Check your inbox to verify your e-mail.'))
    .toBeVisible({ timeout: 25000 });
  await page.getByRole('button', { name: 'Ok' }).click();
}

// A minimal valid 1x1 PNG — enough for the backend's getimagesize well-formedness check.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// A real 400x200 static WebP (same bytes as backend/tests/fixtures/static.webp) — proves the
// WebP path (GD --with-webp + imagemagick) works end-to-end through the isolated stack.
const WEBP_STATIC = Buffer.from(
  'UklGRv4AAABXRUJQVlA4IPIAAAAwFQCdASqQAcgAPpFIoU0lpCMiICgAsBIJaW7hd2EaHAAAE94JyHvtk5D32ych77ZOQ99snIe+2TkP'
  + 'fbJyHvtk5D32ygZeLk5D32ych77ZjLT2ych77ZOQ99uZfp7ZOQ99snIe/AEA99snIe+2TkPgP0u14uTkPfbJyH0L6Xa8XJyHvtk5EQP'
  + 'JyHvtk5D32ycj/nk5D32ych77ZOcRFych77ZOQ99soGXi5OQ99snIe9IAAP7/rxRf/9izlsC8f//7nA/7nA/7nA/jbhYyU2gmw9bAQJ'
  + 'vPmkXzZz5s582c+bOfNnPmznzZz5s582c+YAAAAA==',
  'base64',
);

async function verify(page: import('@playwright/test').Page, email: string): Promise<void> {
  await expect(page).toHaveURL('/verify-email');
  const link = MailLog.latestVerificationLink(email);
  expect(link).not.toBeNull();
  await page.goto(link ?? '');
  await expect(page.getByText('Your e-mail is verified.')).toBeVisible();
}

async function uploadImage(page: import('@playwright/test').Page, title: string): Promise<void> {
  await page.goto('/upload');
  // The media chooser is now a tablist (US2); Image is the default tab. Select it explicitly
  // so the step is robust and exercises the tab.
  await page.getByRole('tab', { name: 'Image' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Image file').setInputFiles({
    name: 'meme.png',
    mimeType: 'image/png',
    buffer: PNG_1X1,
  });
  await page.getByRole('button', { name: 'Post' }).click();
}

test.describe('Upload', () => {
  test('a new members upload is accepted but waits for a moderator', async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);
    // Registration lands on the verification notice (008); uploading is gated on a
    // verified e-mail (verified-upload-gate), so open the e-mailed link first — an
    // unverified user is redirected off /upload back to /verify-email.
    await verify(page, email);

    await uploadImage(page, 'My e2e meme');

    // The upload SUCCEEDS — the form clears and routes to the new meme's permalink.
    // Since 011 a fresh account starts at rating 0, below the trust threshold, so the
    // meme is created pending and is not publicly readable yet (FR-018).
    //
    // KNOWN GAP: the permalink therefore renders "not found" to the very person who
    // just uploaded. 011 specifies only that the meme stays invisible, not what its
    // uploader should see, so the pending-upload confirmation is unspecced follow-up
    // work. This asserts today's behaviour rather than endorsing it.
    await expect(page).toHaveURL(/\/posts\/[A-Za-z0-9_-]{10}$/);
    await expect(page.locator('img.meme-media__image')).toHaveCount(0);
  });

  test('accepts a WebP upload and enforces the required title and media tabs', async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);
    await verify(page, email);
    await page.goto('/upload');

    // Required title (US1): an empty title blocks the post with a field error, no navigation.
    await page.getByLabel('Image file').setInputFiles({ name: 'm.webp', mimeType: 'image/webp', buffer: WEBP_STATIC });
    await page.getByRole('button', { name: 'Post' }).click();
    await expect(page.getByRole('alert')).toContainText(/title/i);
    await expect(page).toHaveURL('/upload');

    // Media tabs (US2): switching to YouTube swaps the input, and back to Image restores it —
    // only the active tab's input is ever in the DOM.
    await page.getByRole('tab', { name: 'YouTube' }).click();
    await expect(page.getByLabel('YouTube link')).toBeVisible();
    await expect(page.getByLabel('Image file')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Image' }).click();
    await expect(page.getByLabel('Image file')).toBeVisible();

    // A valid WebP + title is accepted (US3) and routes to the new meme's permalink. As with a
    // fresh member's PNG upload above, the meme is created pending, so this asserts acceptance
    // (the route), not public visibility.
    await page.getByLabel('Title').fill('My webp meme');
    await page.getByLabel('Image file').setInputFiles({ name: 'm.webp', mimeType: 'image/webp', buffer: WEBP_STATIC });
    await page.getByRole('button', { name: 'Post' }).click();
    await expect(page).toHaveURL(/\/posts\/[A-Za-z0-9_-]{10}$/);
  });

  test('a moderator activates a pending upload and it reaches the feed', async ({ page }) => {
    // Register + verify + upload, an out-of-band role promotion, a reload, then the
    // moderation round-trip — well past the default 30s budget.
    test.setTimeout(90_000);
    const email = uniqueEmail();
    // Must stay within ModerationModel's 20-char title cut, or the moderation row
    // renders an ellipsised title and the hasText filter below cannot find it. The
    // millisecond tail is unique enough for a stack that is torn down per run.
    const title = `Pending ${Date.now() % 1_000_000}`;
    await register(page, email);
    await verify(page, email);
    await uploadImage(page, title);
    await expect(page).toHaveURL(/\/posts\/[A-Za-z0-9_-]{10}$/);
    const hash = new URL(page.url()).pathname.split('/').pop() ?? '';

    // Below the threshold, so it is absent from the public feed (US2 §2).
    await page.goto('/');
    await expect(page.getByRole('link', { name: title })).toHaveCount(0);

    // Promote the same account so it can moderate its own pending upload — the e2e
    // stack has no HTTP path to grant a role, by design.
    AdminSetup.promoteToSuperuser(email);
    await page.goto('/admin/trashposts');
    await page.reload();

    const row = page.locator('tbody tr.moderation-row').filter({ hasText: title });
    await expect(row).toHaveCount(1);
    // Moderation actions live behind the shared kebab menu (013): open it, activate, then
    // reopen to confirm the row flipped to Deactivate in place.
    const trigger = row.locator('.action-menu__trigger');
    await trigger.click();
    await row.getByRole('menuitem', { name: 'Activate', exact: true }).click();
    await trigger.click();
    await expect(row.getByRole('menuitem', { name: 'Deactivate', exact: true })).toBeVisible();

    // Activated: publicly readable, and its media is back on the public disk (US2 §3).
    await page.goto(`/posts/${hash}`);
    await expect(page.locator('img.meme-media__image')).toBeVisible();
  });
});
