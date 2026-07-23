import { expect, test } from './helpers/e2eReset';

import { AdminSetup } from './helpers/adminSetup';

// End-to-end coverage of the admin moderation console (010) against the ISOLATED e2e stack
// (run via scripts\e2e.ps1): the role gate refuses a member (no link, redirected away) and
// admits an admin, who browses the seeded corpus via a bookmarkable page and toggles a meme's
// activation in place. Users are written to the throwaway ladybug_e2e DB; the E2eSeeder plants
// 20 activated posts there, so the table has real rows to page through and act on.

function uniqueEmail(): string {
  return `e2e+${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

async function register(page: import('@playwright/test').Page, name: string, email: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Password1');
  await page.getByLabel('Re-type password').fill('Password1');
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByText(`Welcome, ${name}! Check your inbox to verify your e-mail.`))
    .toBeVisible({ timeout: 25000 });
  await page.getByRole('button', { name: 'Ok' }).click();
}

test.describe('Admin moderation', () => {
  test('a member cannot see the nav link or reach the console', async ({ page }) => {
    await register(page, 'E2E Member', uniqueEmail());

    // The Trashposts entry is admin-only (FR-001a), so a member never sees it.
    await expect(page.getByRole('link', { name: 'Trashposts' })).toHaveCount(0);

    // The SPA route guard mirrors the server boundary: a member is bounced home (FR-002).
    await page.goto('/admin/trashposts');
    await expect(page).toHaveURL('/');
  });

  test('an admin browses the corpus and toggles a meme in place', async ({ page }) => {
    // This flow does more than a typical spec — register, an out-of-band `docker exec`
    // role promotion, a reload, then browse + four action clicks — so it needs headroom
    // beyond the default 30s budget.
    test.setTimeout(90_000);
    const email = uniqueEmail();
    await register(page, 'E2E Admin', email);

    // Promote to superuser (admin+) via the operator command, then reload so the SPA
    // re-derives the now-elevated role from /api/user (the session survives the reload).
    AdminSetup.promoteToSuperuser(email);
    await page.goto('/');
    await page.reload();

    await expect(page.getByRole('link', { name: 'Trashposts' })).toBeVisible();
    await page.getByRole('link', { name: 'Trashposts' }).click();
    await expect(page).toHaveURL('/admin/trashposts');

    // The seeded 20 activated posts fill a single 100-row page.
    const rows = page.locator('tbody tr.moderation-row');
    await expect(rows).toHaveCount(20);
    // The numbered page link is bookmarkable and marks the current page. Scoped to the
    // pagination nav and matched exactly, so it doesn't collide with a row's title link
    // whose accessible name (the post title or hash) happens to contain a "1".
    await expect(
      page.getByRole('navigation', { name: 'Moderation pages' }).getByRole('link', { name: '1', exact: true }),
    ).toHaveAttribute('aria-current', 'page');

    // One action round-trip on the first row: the actions now live behind the shared kebab
    // menu (013). Open it, Deactivate, and the row refreshes in place; reopen to confirm it now
    // offers Activate, activate back, and reopen once more to confirm it flipped to Deactivate.
    const first = rows.first();
    const trigger = first.locator('.action-menu__trigger');
    await trigger.click();
    await first.getByRole('menuitem', { name: 'Deactivate', exact: true }).click();
    await trigger.click();
    await first.getByRole('menuitem', { name: 'Activate', exact: true }).click();
    await trigger.click();
    await expect(first.getByRole('menuitem', { name: 'Deactivate', exact: true })).toBeVisible();

    // Still on the same page after acting (FR-017/FR-019 — the menu never changes the URL).
    await expect(page).toHaveURL('/admin/trashposts');
  });
});
