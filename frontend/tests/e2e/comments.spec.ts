import { expect, test } from '@playwright/test';

import { MailLog } from './helpers/mailLog';

// End-to-end coverage of the comment section (015) against the ISOLATED e2e stack
// (run via scripts\e2e.ps1). The read slice (US1): the newest seeded post carries three
// comments that render newest-first with a count, and every other post shows the explicit
// empty state. The add slice (US2): a verified user posts a comment that appears on top with
// no reload; a guest and an unverified user each see their gating prompt. The E2eSeeder plants
// exactly three comments ("E2E seed comment 01..03") on the newest post and none on the rest.

function uniqueEmail(): string {
  return `e2e+${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

async function register(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Display name').fill('E2E Commenter');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Password1');
  await page.getByLabel('Re-type password').fill('Password1');
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByText('Welcome, E2E Commenter! Check your inbox to verify your e-mail.'))
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

async function openNewestPost(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.locator('.feed__list > li h2 a').first().click();
  await expect(page).toHaveURL(/\/posts\/[A-Za-z0-9_-]+$/);
}

test.describe('Comments — read', () => {
  test('a post with comments renders them newest-first with a count', async ({ page }) => {
    await page.goto('/');

    // The newest post is first in the feed; open its permalink.
    await page.locator('.feed__list > li h2 a').first().click();
    await expect(page).toHaveURL(/\/posts\/[A-Za-z0-9_-]+$/);

    const section = page.getByRole('region', { name: 'Comments' });
    await expect(section.getByText('3 comments')).toBeVisible();

    // Newest-first: the last-created seed comment is on top.
    const bodies = section.locator('.comment-list > li .comment__body');
    await expect(bodies).toHaveCount(3);
    await expect(bodies.nth(0)).toHaveText('E2E seed comment 03');
    await expect(bodies.nth(1)).toHaveText('E2E seed comment 02');
    await expect(bodies.nth(2)).toHaveText('E2E seed comment 01');
  });

  test('a post with no comments shows the empty state', async ({ page }) => {
    await page.goto('/');

    // The second feed entry is a comment-free seed post.
    await page.locator('.feed__list > li h2 a').nth(1).click();
    await expect(page).toHaveURL(/\/posts\/[A-Za-z0-9_-]+$/);

    const section = page.getByRole('region', { name: 'Comments' });
    await expect(section.getByText(/no comments yet/i)).toBeVisible();
    await expect(section.locator('.comment-list > li')).toHaveCount(0);
  });
});

test.describe('Comments — add', () => {
  test('a guest sees a sign-in prompt instead of the composer', async ({ page }) => {
    await openNewestPost(page);

    const section = page.getByRole('region', { name: 'Comments' });
    await expect(section.getByRole('link', { name: /sign in/i })).toBeVisible();
    await expect(section.getByLabel('Add a comment')).toHaveCount(0);
  });

  test('an unverified user sees a verify-e-mail prompt', async ({ page }) => {
    await register(page, uniqueEmail());
    await openNewestPost(page);

    const section = page.getByRole('region', { name: 'Comments' });
    await expect(section.getByRole('link', { name: /verify/i })).toBeVisible();
    await expect(section.getByLabel('Add a comment')).toHaveCount(0);
  });

  test('a verified user posts a comment that appears on top with no reload', async ({ page }) => {
    test.setTimeout(90_000);
    const email = uniqueEmail();
    await register(page, email);
    await verify(page, email);
    await openNewestPost(page);
    const url = page.url();

    const section = page.getByRole('region', { name: 'Comments' });
    const body = `E2E fresh comment ${Date.now()}`;
    await section.getByLabel('Add a comment').fill(body);
    await section.getByRole('button', { name: 'Post comment' }).click();

    // Appears at the top in place — the count rises to 4 and the URL is unchanged (no reload).
    await expect(section.locator('.comment-list > li .comment__body').first()).toHaveText(body);
    await expect(section.getByText('4 comments')).toBeVisible();
    expect(page.url()).toBe(url);
  });
});
