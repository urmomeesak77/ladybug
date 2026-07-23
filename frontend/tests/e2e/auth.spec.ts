import { expect, test } from './helpers/e2eReset';

// End-to-end coverage of the auth feature (007) against the ISOLATED e2e stack (run via
// scripts\e2e.ps1): register logs the user in, the nav reflects auth state, guards enforce
// the redirect matrix, login + logout work, a non-disclosing error is shown for bad
// credentials, and the session survives a reload (refresh-persistence). Users are written
// to the throwaway ladybug_e2e DB, never the live dev trashdb; unique emails keep specs
// independent within a run.

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

test.describe('Auth', () => {
  test('register logs the user in and logout returns to anonymous', async ({ page }) => {
    await register(page, uniqueEmail());

    // Registration now lands on the verification notice (008, FR-007).
    await expect(page).toHaveURL('/verify-email');
    await expect(page.getByRole('link', { name: 'Account' })).toBeVisible();

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('link', { name: 'Login' })).toBeVisible();
    // Exact: logging out on the guarded notice page lands on /login, whose
    // "No account? Register here...." link would match a substring lookup.
    await expect(page.getByRole('link', { name: 'Account', exact: true })).toHaveCount(0);
  });

  test('an authenticated user is redirected away from /login and /register', async ({ page }) => {
    await register(page, uniqueEmail());
    await expect(page).toHaveURL('/verify-email');

    await page.goto('/login');
    await expect(page).toHaveURL('/');

    await page.goto('/register');
    await expect(page).toHaveURL('/');
  });

  test('an anonymous visitor to /account is redirected to /login', async ({ page }) => {
    await page.goto('/account');

    await expect(page).toHaveURL('/login');
  });

  test('login authenticates, shows the account, and survives a reload', async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);
    // Log out from home: logging out on a guarded page (the post-register
    // /verify-email notice) makes login return THERE via the D9 return-to state,
    // and this test is about the plain login → home path.
    await page.goto('/');
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('link', { name: 'Login' })).toBeVisible();

    await page.goto('/login');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('Password1');
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: 'Account' })).toBeVisible();

    await page.goto('/account');
    await expect(page.getByText(email)).toBeVisible();

    // Refresh-persistence: a reload re-derives auth state from the backend (FR-013).
    await page.reload();
    await expect(page.getByText(email)).toBeVisible();
  });

  test('login with wrong credentials shows a single non-disclosing error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(uniqueEmail());
    await page.getByLabel('Password', { exact: true }).fill('WrongPass1');
    await page.getByRole('button', { name: 'Login' }).click();

    await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
    await expect(page).toHaveURL('/login');
  });
});
