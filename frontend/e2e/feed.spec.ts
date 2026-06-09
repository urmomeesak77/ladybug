import { expect, test } from '@playwright/test';

// End-to-end coverage of the Home feed (US1/US2) against the live stack: the shell renders,
// the newest memes load with titles + media, scrolling appends the next batch with no
// duplicates, and an entry's title links to its /posts/{hash} permalink.

test.describe('Home feed', () => {
  test('renders the shell and the newest memes', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('link', { name: 'Ladybug' })).toBeVisible();
    await expect(page.getByRole('navigation')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Latest memes' })).toBeVisible();

    // The first batch is 10 newest-first entries, each a list item with a titled heading.
    const items = page.locator('.feed__list > li');
    await expect(items.first()).toBeVisible();
    await expect(items).toHaveCount(10);
    await expect(items.first().getByRole('heading', { level: 2 })).not.toBeEmpty();
  });

  test('appends the next batch on scroll without duplicates', async ({ page }) => {
    await page.goto('/');
    const items = page.locator('.feed__list > li');
    await expect(items).toHaveCount(10);

    // Scroll the sentinel into view to trigger the IntersectionObserver auto-load.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(items).toHaveCount(20);

    // Every loaded entry keys off a unique hash (permalink) — assert no duplicates appeared.
    const hrefs = await items.locator('h2 a').evaluateAll((links) =>
      links.map((link) => (link as HTMLAnchorElement).getAttribute('href')),
    );
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  test('an entry title links to its /posts/{hash} permalink', async ({ page }) => {
    await page.goto('/');
    const firstLink = page.locator('.feed__list > li h2 a').first();
    await expect(firstLink).toBeVisible();

    const href = await firstLink.getAttribute('href');
    expect(href).toMatch(/^\/posts\/[A-Za-z0-9_-]+$/);

    await firstLink.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Single-meme page coming soon' }),
    ).toBeVisible();
  });
});
