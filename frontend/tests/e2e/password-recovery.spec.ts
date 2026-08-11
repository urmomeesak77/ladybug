import { expect, test } from './helpers/e2eReset';

import { MailLog } from './helpers/mailLog';

// End-to-end coverage of password recovery and change (022) against the ISOLATED e2e stack
// (run via scripts\e2e.ps1). The e2e backend's MAIL_MAILER=log writes each recovery message to
// backend/storage/logs/laravel.log; MailLog.latestResetLink extracts the link exactly as a
// user would from their inbox — same helper shape verify-email.spec.ts already uses (research
// D7, contracts/recovery-link.md "Test hook"). Unique emails keep specs independent within a
// run.

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
  await expect(page.getByText('Welcome, E2E User! Check your inbox to verify your e-mail.'))
    .toBeVisible({ timeout: 25000 });
  await page.getByRole('button', { name: 'Ok' }).click();
}

test.describe('Password recovery', () => {
  test('a link recovers access: old password refused, new one signs in, link is spent', async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('link', { name: 'Login' })).toBeVisible();

    // FR-001: the entry point is the login form's own link.
    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL('/forgot-password');
    // Unlike every other page transition in this file, this one is a client-side Link
    // navigation, not a hard page.goto(). toHaveURL only proves the browser's location
    // changed, not that ForgotPasswordPage has actually mounted — under CI's slower,
    // more contended runners the two can land a tick apart, and filling into that gap
    // hits whatever the previous page's own "E-mail" field was (or an unmounted one),
    // so the value never reaches this form (root-caused from CI's compose logs: two
    // straight failures never even sent a POST /api/password/forgot). Waiting for this
    // page's own heading closes that gap.
    await expect(page.getByRole('heading', { name: 'Reset password' })).toBeVisible();

    // FR-004: submitting a real address produces the confirmation.
    await page.getByLabel('E-mail').fill(email);
    await page.getByRole('button', { name: 'Send recovery link' }).click();
    await expect(page.getByText('If an account exists for that address, a password recovery link is on its way.'))
      .toBeVisible();

    // Polled rather than read once. The mail is written before the 200 that the assertion
    // above waits on, so a single read is ORDERED correctly — but it is still a synchronous
    // filesystem read racing a container's log flush, and it is the last unguarded timing
    // assumption in this spec. Two of the recent fixes here were timing fixes; this removes
    // the remaining one instead of waiting to be bitten by it.
    await expect.poll(() => MailLog.latestResetLink(email), { timeout: 15000 }).not.toBeNull();
    const link = MailLog.latestResetLink(email);

    // FR-011: the form asks for a new password twice and prints no account detail.
    await page.goto(link ?? '');
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    await expect(page.getByText(email)).toHaveCount(0);
    await page.getByLabel('New password', { exact: true }).fill('NewPassw0rd');
    await page.getByLabel('Confirm new password').fill('NewPassw0rd');
    await page.getByRole('button', { name: 'Set password' }).click();

    // FR-021: the confirmation names no session — still signed out.
    await expect(page.getByText('Your password has been changed. Please log in.')).toBeVisible();

    // The old password no longer works; the new one does.
    await page.getByRole('link', { name: 'Go to login' }).click();
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('Password1');
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByText('Email or password is incorrect.')).toBeVisible();

    await page.getByLabel('Password', { exact: true }).fill('NewPassw0rd');
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: 'Account' })).toBeVisible();

    // FR-014: re-opening the spent link is refused, with a path back to request a new one.
    await page.goto(link ?? '');
    await expect(page.getByText('This password recovery link is no longer valid.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Request a new link' })).toBeVisible();
  });

  /**
   * US3 in a real browser. The unit tests reach FR-028 only by replaying a captured cookie;
   * this is the one place the actual claim gets tested as a user experiences it — the client
   * that made the change is still signed in afterwards, with no re-login and no bounce to
   * /login, and the new password is the one that now works.
   */
  test('changing the password from the account page keeps that client signed in', async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);

    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'Password' })).toBeVisible();
    await page.getByLabel('Current password').fill('Password1');
    await page.getByLabel('New password', { exact: true }).fill('SecondPassw0rd');
    await page.getByLabel('Confirm new password').fill('SecondPassw0rd');
    await page.getByRole('button', { name: 'Save password' }).click();

    // FR-028: the acting client survives its own change — still on /account, still signed in.
    await expect(page.getByText('Password updated.')).toBeVisible();
    await expect(page).toHaveURL('/account');
    await expect(page.getByRole('link', { name: 'Account' })).toBeVisible();

    // And the change was real: only the new password signs in afterwards.
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('link', { name: 'Login' })).toBeVisible();
    // Home first, so the /login entry this signs in from carries no redirect target. Logging
    // out of /account leaves RequireAuth's `state.from` on the history entry the browser is
    // sitting on, and a goto to the URL already showing is a reload, which PRESERVES that
    // state — the sign-in would then return to /account, which is correct behaviour but says
    // nothing about the default landing this asserts.
    await page.goto('/');
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('Password1');
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByText('Email or password is incorrect.')).toBeVisible();

    await page.getByLabel('Password', { exact: true }).fill('SecondPassw0rd');
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: 'Account' })).toBeVisible();
  });
});
