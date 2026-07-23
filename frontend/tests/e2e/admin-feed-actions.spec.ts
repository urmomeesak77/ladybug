import { expect, test } from './helpers/e2eReset';

import { AdminSetup } from './helpers/adminSetup';

// End-to-end coverage of the in-place admin moderation menu on the public surfaces (the Home
// feed and the single-post page) against the ISOLATED e2e stack (run via scripts\e2e.ps1). An
// admin (a promoted superuser) sees the shared kebab in each feed item's top-right and on the
// post page; deactivating a feed item drops it from the feed, and deactivating on the post
// page flips it to the "pending review" banner. Guests never see the trigger. Accounts are
// written to the throwaway ladybug_e2e DB; the seeded feed provides the memes to act on.

function uniqueEmail(): string {
  return `e2e+${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

async function registerAdmin(page: import('@playwright/test').Page): Promise<void> {
  const email = uniqueEmail();
  await page.goto('/register');
  await page.getByLabel('Display name').fill('E2E Feed Admin');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Password1');
  await page.getByLabel('Re-type password').fill('Password1');
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByText('Welcome, E2E Feed Admin! Check your inbox to verify your e-mail.'))
    .toBeVisible({ timeout: 25000 });
  await page.getByRole('button', { name: 'Ok' }).click();

  // Promote out-of-band so the account satisfies the role:admin gate on the moderation API,
  // then reload so the SPA re-derives the elevated role from /api/user.
  AdminSetup.promoteToSuperuser(email);
  await page.goto('/');
  await page.reload();
}

test.describe('Admin in-place post actions', () => {
  test('a guest sees no moderation kebab on the feed', async ({ page }) => {
    await page.goto('/');
    const items = page.locator('.feed__list > li');
    await expect(items.first()).toBeVisible();
    await expect(page.locator('.feed__list .action-menu__trigger')).toHaveCount(0);
  });

  test('an admin deactivates a feed item and it drops from the feed', async ({ page }) => {
    test.setTimeout(120_000);
    await registerAdmin(page);

    const items = page.locator('.feed__list > li');
    await expect(items.first()).toBeVisible();

    // Target the newest entry by its permalink so we can assert it is gone afterwards.
    const firstItem = items.first();
    const href = await firstItem.locator('h2 a').getAttribute('href');
    expect(href).toMatch(/^\/posts\/[A-Za-z0-9_-]+$/);

    await firstItem.locator('.action-menu__trigger').click();
    await page.getByRole('menuitem', { name: 'Deactivate', exact: true }).click();

    // The deactivated meme is no longer public, so its card leaves the feed in place; the URL
    // is untouched (the transient menu never navigates).
    await expect(page.locator(`.feed__list > li h2 a[href="${href}"]`)).toHaveCount(0);
    await expect(page).toHaveURL('/');
  });

  test('an admin deactivates on the post page and the pending banner appears', async ({ page }) => {
    test.setTimeout(120_000);
    await registerAdmin(page);

    // Open the newest meme's permalink from the feed.
    const firstLink = page.locator('.feed__list > li h2 a').first();
    await expect(firstLink).toBeVisible();
    const href = (await firstLink.getAttribute('href')) ?? '';
    await firstLink.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));

    // No banner while the meme is still public.
    await expect(page.getByRole('status')).toHaveCount(0);

    await page.locator('.post-item .action-menu__trigger').click();
    await page.getByRole('menuitem', { name: 'Deactivate', exact: true }).click();

    // Deactivation flips the loaded post to pending in place — the hidden banner announces it.
    await expect(page.getByRole('status')).toContainText(/pending review/i);
    await expect(page).toHaveURL(new RegExp(`${href}$`));
  });
});
