import { expect, test } from '@playwright/test';

import { AdminSetup } from './helpers/adminSetup';

// End-to-end coverage of the admin user console (012) against the ISOLATED e2e stack (run via
// scripts\e2e.ps1): the role gate refuses a member (no link, redirected away) and admits an
// admin, who browses the roster on a bookmarkable page, disables a member in place, sees that
// member refused at sign-in with the distinct disabled message, then re-enables them and
// confirms the member can sign in again with the SAME credentials. Accounts are written to the
// throwaway ladybug_e2e DB.

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
  // Logout navigates home and the menu drops to the anonymous entry.
  await expect(page.getByRole('link', { name: 'Login/register' })).toBeVisible();
}

async function login(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Password1');
  await page.getByRole('button', { name: 'Login' }).click();
}

test.describe('Admin user console', () => {
  test('a member cannot see the Users nav link or reach the console', async ({ page }) => {
    await register(page, 'E2E User Member', uniqueEmail());

    // The Users entry is admin-only (FR-003), so a member never sees it.
    await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);

    // The SPA route guard mirrors the server boundary: a member is bounced home (FR-002).
    await page.goto('/admin/users');
    await expect(page).toHaveURL('/');
  });

  test('an admin disables a member, who is refused at sign-in, then re-enables them', async ({ page }) => {
    // Registers two accounts, an out-of-band role promotion, several login/logout cycles and
    // action round-trips — well beyond the default 30s budget.
    test.setTimeout(120_000);
    const memberEmail = uniqueEmail();
    const adminEmail = uniqueEmail();

    // The member to be disabled; log out so the admin can be registered (RequireAnon guards
    // /register against an authenticated visitor).
    await register(page, 'E2E Target', memberEmail);
    await logout(page);

    // The acting admin, promoted to superuser (outranks the member) via the operator command;
    // reload so the SPA re-derives the elevated role from /api/user.
    await register(page, 'E2E Actor', adminEmail);
    AdminSetup.promoteToSuperuser(adminEmail);
    await page.goto('/');
    await page.reload();

    // Browse the console; page 1 is bookmarkable and marks itself current.
    await page.getByRole('link', { name: 'Users' }).click();
    await expect(page).toHaveURL('/admin/users');
    await expect(
      page.getByRole('navigation', { name: 'Account pages' }).getByRole('link', { name: '1', exact: true }),
    ).toHaveAttribute('aria-current', 'page');

    // Disable the member's row in place: the control flips Disable → Enable without a
    // confirmation step and without leaving the page (FR-016).
    const memberRow = page.locator('tr.user-row', { hasText: memberEmail });
    await expect(memberRow.getByRole('button', { name: 'Disable', exact: true })).toBeVisible();
    await memberRow.getByRole('button', { name: 'Disable', exact: true }).click();
    await expect(memberRow.getByRole('button', { name: 'Enable', exact: true })).toBeVisible();
    await expect(page).toHaveURL('/admin/users');

    // The disabled member is refused at sign-in with the distinct message (FR-013), not the
    // generic wrong-credentials one.
    await logout(page);
    await login(page, memberEmail);
    await expect(page.getByText('This account is disabled.')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    // The admin re-enables the member (login already carries the stored superuser role).
    await login(page, adminEmail);
    await page.getByRole('link', { name: 'Users' }).click();
    const rowAgain = page.locator('tr.user-row', { hasText: memberEmail });
    await rowAgain.getByRole('button', { name: 'Enable', exact: true }).click();
    await expect(rowAgain.getByRole('button', { name: 'Disable', exact: true })).toBeVisible();

    // The member signs in again with the SAME password — no re-registration, no re-verification.
    await logout(page);
    await login(page, memberEmail);
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  });
});
