import { expect, test } from '@playwright/test';

// End-to-end coverage of the upload feature (008) against the ISOLATED e2e stack (run via
// scripts\e2e.ps1): a registered, logged-in user uploads an image and lands on the new
// meme's permalink with the image rendered. Users + posts are written to the throwaway
// ladybug_e2e DB and its disposable media tree, never the live dev stack.

function uniqueEmail(): string {
  return `e2e+${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

async function register(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Name').fill('E2E Uploader');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Password1');
  await page.getByLabel('Confirm password').fill('Password1');
  await page.getByRole('button', { name: 'Register' }).click();
}

// A minimal valid 1x1 PNG — enough for the backend's getimagesize well-formedness check.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('Upload', () => {
  test('a logged-in user uploads an image and sees its permalink', async ({ page }) => {
    await register(page, uniqueEmail());
    await expect(page).toHaveURL('/');

    await page.goto('/upload');
    await page.getByLabel('Image', { exact: true }).check();
    await page.getByLabel('Title (optional)').fill('My e2e meme');
    await page.getByLabel('Image file').setInputFiles({
      name: 'meme.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    });
    await page.getByRole('button', { name: 'Post' }).click();

    await expect(page).toHaveURL(/\/posts\/[A-Za-z0-9_-]{10}$/);
    await expect(page.locator('img.meme-media__image')).toBeVisible();
  });
});
