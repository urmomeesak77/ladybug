import { expect, test } from '@playwright/test';

// End-to-end coverage of the auth feature (007) against the live stack: register logs the
// user in, the nav reflects auth state, guards enforce the redirect matrix, login + logout
// work, a non-disclosing error is shown for bad credentials, and the session survives a
// reload (refresh-persistence). Each test uses a unique email since the dev DB is shared.

function uniqueEmail(): string {
  return `e2e+${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

async function register(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Name').fill('E2E User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Password1');
  await page.getByLabel('Confirm password').fill('Password1');
  await page.getByRole('button', { name: 'Register' }).click();
}

test.describe('Auth', () => {
  test('register logs the user in and logout returns to anonymous', async ({ page }) => {
    await register(page, uniqueEmail());

    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: 'Account' })).toBeVisible();

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('link', { name: 'Login' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Account' })).toHaveCount(0);
  });

  test('an authenticated user is redirected away from /login and /register', async ({ page }) => {
    await register(page, uniqueEmail());
    await expect(page).toHaveURL('/');

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
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('link', { name: 'Login' })).toBeVisible();

    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('Password1');
    await page.getByRole('button', { name: 'Log in' }).click();
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
    await page.getByLabel('Email').fill(uniqueEmail());
    await page.getByLabel('Password', { exact: true }).fill('WrongPass1');
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
    await expect(page).toHaveURL('/login');
  });
});
