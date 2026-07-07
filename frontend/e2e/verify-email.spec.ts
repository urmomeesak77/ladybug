import { expect, test } from '@playwright/test';

import { MailLog } from './helpers/mailLog';

// End-to-end coverage of registration email verification (008) against the ISOLATED
// e2e stack (run via scripts\e2e.ps1). The e2e backend's MAIL_MAILER=log writes each
// verification message to backend/storage/logs/laravel.log; MailLog extracts the
// link exactly as a user would from their inbox (research D7). Unique emails keep
// specs independent within a run.

function uniqueEmail(): string {
  return `e2e+${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

async function register(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Display name').fill('E2E User');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Password1');
  await page.getByLabel('Re-type password').fill('Password1');
  await page.getByRole('button', { name: 'Register' }).click();
  // Registering renders a mail inside the request; scripts/e2e.ps1 pre-warms that
  // path, but give the dialog headroom within the 30s test budget regardless.
  await expect(page.getByText('Welcome, E2E User! Check your inbox to verify your e-mail.'))
    .toBeVisible({ timeout: 25000 });
  await page.getByRole('button', { name: 'Ok' }).click();
}

test.describe('Email verification', () => {
  test('registering sends a link that verifies the account, idempotently', async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);

    // FR-007: registration lands on the notice page naming the address.
    await expect(page).toHaveURL('/verify-email');
    await expect(page.getByText(email)).toBeVisible();

    const link = MailLog.latestVerificationLink(email);
    expect(link).not.toBeNull();

    // Opening the emailed link marks the account verified (quickstart Scenario 1).
    await page.goto(link ?? '');
    await expect(page.getByText('Your e-mail is verified.')).toBeVisible();

    // Re-using the link is a friendly no-op, never an error (FR-005, Scenario 2).
    await page.goto(link ?? '');
    await expect(page.getByText('Your e-mail was already verified.')).toBeVisible();
  });

  test('a link opened while signed out survives the login round-trip', async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);
    await expect(page).toHaveURL('/verify-email');
    const link = MailLog.latestVerificationLink(email) ?? '';
    expect(link).not.toBe('');

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('link', { name: 'Login' })).toBeVisible();

    // Anonymous visit bounces to login; signing in returns to the link, which
    // then verifies the account (spec scenario 4, research D9).
    await page.goto(link);
    await expect(page).toHaveURL('/login');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('Password1');
    await page.getByRole('button', { name: 'Login' }).click();

    await expect(page.getByText('Your e-mail is verified.')).toBeVisible();
    await expect(page).toHaveURL(link);
  });
});
