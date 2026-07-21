import { expect, test } from '@playwright/test';

import { AdminSetup } from './helpers/adminSetup';

// End-to-end coverage of the shared per-row action menu on the admin user console (013)
// against the ISOLATED e2e stack (run via scripts\e2e.ps1): a superuser opens a strictly-lower
// member's kebab menu and permanently deletes the account through the naming confirm — the row
// drops in place and the page never changes (SC-002) — while the actor's own row offers no menu
// at all and no fallback text, the cell is simply empty (FR-006). Accounts are written to the throwaway
// ladybug_e2e DB. Keyboard/dismissal behaviour (US3) is covered separately in T024.

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

async function logout(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('link', { name: 'Login/register' })).toBeVisible();
}

test.describe('Admin action menus — permanent account deletion', () => {
  test('a superuser deletes an outranked member in place; its own row offers no menu', async ({ page }) => {
    // Two registrations, an out-of-band role promotion, a reload, and a menu round-trip — well
    // beyond the default 30s budget.
    test.setTimeout(120_000);
    const memberEmail = uniqueEmail();
    const actorEmail = uniqueEmail();

    // The member to be deleted; log out so the actor can be registered (RequireAnon guards
    // /register against an authenticated visitor).
    await register(page, 'E2E Delete Target', memberEmail);
    await logout(page);

    // The acting account, promoted to superuser so it strictly outranks the member; reload so
    // the SPA re-derives the elevated role from /api/user.
    await register(page, 'E2E Actor', actorEmail);
    AdminSetup.promoteToSuperuser(actorEmail);
    await page.goto('/');
    await page.reload();

    await page.getByRole('link', { name: 'Users' }).click();
    await expect(page).toHaveURL('/admin/users');

    // Refusal state (FR-006): the actor's own row (a superuser, so not strictly outranked)
    // renders no kebab trigger — and no fallback text either, the cell is simply empty.
    const ownRow = page.locator('tr.user-row', { hasText: actorEmail });
    await expect(ownRow.getByText('No permission')).toHaveCount(0);
    await expect(ownRow.locator('.action-menu__trigger')).toHaveCount(0);

    // Happy path (SC-002): open the member's menu, choose Delete permanently, confirm.
    const memberRow = page.locator('tr.user-row', { hasText: memberEmail });
    await memberRow.locator('.action-menu__trigger').click();
    await page.getByRole('menuitem', { name: 'Delete permanently' }).click();

    // The confirm dialog names the account and is answered before anything is sent (FR-008).
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('E2E Delete Target');
    await dialog.getByRole('button', { name: 'Delete permanently' }).click();

    // The row drops in place and the admin stays on the same page (FR-013 / SC-002).
    await expect(page.locator('tr.user-row', { hasText: memberEmail })).toHaveCount(0);
    await expect(page).toHaveURL('/admin/users');
  });

  test('the account menu is keyboard-operable and dismissible, never changing the URL (US3)', async ({ page }) => {
    test.setTimeout(120_000);
    const memberEmail = uniqueEmail();
    const actorEmail = uniqueEmail();

    await register(page, 'E2E US3 Target', memberEmail);
    await logout(page);
    await register(page, 'E2E US3 Actor', actorEmail);
    AdminSetup.promoteToSuperuser(actorEmail);
    await page.goto('/');
    await page.reload();

    await page.getByRole('link', { name: 'Users' }).click();
    await expect(page).toHaveURL('/admin/users');

    const memberRow = page.locator('tr.user-row', { hasText: memberEmail });
    const trigger = memberRow.locator('.action-menu__trigger');
    const menu = memberRow.getByRole('menu');

    // Keyboard-only: focus the trigger, open onto the first item, traverse the items, and
    // dismiss with Escape — focus returns to the trigger and no action was taken (FR-003/FR-004).
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await page.keyboard.press('ArrowDown'); // → Delete permanently
    await page.keyboard.press('ArrowUp');   // → back to Disable
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Dismiss by clicking outside the menu.
    await trigger.click();
    await expect(menu).toBeVisible();
    await page.getByRole('heading', { name: 'Users' }).click();
    await expect(menu).toHaveCount(0);

    // Dismiss by moving focus away (Tab).
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(menu).toHaveCount(0);

    // None of that opening/closing changed the page's location (FR-019 / SC-006).
    await expect(page).toHaveURL('/admin/users');

    // Keyboard-activate a reversible action: ArrowDown opens onto the first item (Disable),
    // Enter activates it, and the row flips in place to offer Enable.
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await trigger.click();
    await expect(memberRow.getByRole('menuitem', { name: 'Enable', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    // Refresh restores the same page — the transient menu never disturbed navigation (SC-006).
    await page.reload();
    await expect(page).toHaveURL('/admin/users');
    await expect(page.locator('tr.user-row', { hasText: memberEmail })).toHaveCount(1);
  });
});
