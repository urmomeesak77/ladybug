import { expect, test } from './helpers/e2eReset';

// End-to-end coverage of the Home feed (US1/US2) against the live stack: the shell renders,
// the newest memes load with titles + media, scrolling appends the next batch with no
// duplicates, and an entry's title links to its /posts/{hash} permalink.

test.describe('Home feed', () => {
  test('renders the shell and the newest memes', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('link', { name: 'online-trash' })).toBeVisible();
    await expect(page.getByRole('navigation')).toBeVisible();

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

    // The post page renders the same title as its feed entry, as the page's h1 (006).
    const title = ((await firstLink.textContent()) ?? '').trim();
    await firstLink.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  });

  test('restores scroll position after returning from a post', async ({ page }) => {
    await page.goto('/');
    const items = page.locator('.feed__list > li');
    await expect(items).toHaveCount(10);

    // Load a second batch so there is a non-trivial scroll position to restore.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(items).toHaveCount(20);

    // Bring a post well down the list into view, then record the resulting scroll
    // position. Capturing AFTER scrollIntoView matters: clicking auto-scrolls an
    // off-screen target into view, so reading scrollY beforehand would measure a
    // position the page never navigated away from.
    const link = items.nth(12).locator('h2 a');
    const href = await link.getAttribute('href');
    await link.scrollIntoViewIfNeeded();
    // Let the throttled scroll capture (150ms) persist the anchor at this position.
    await page.waitForTimeout(300);

    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(0);

    // Open the (now in-view) post and navigate back.
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await page.goBack();

    // The previously loaded posts are restored and the scroll lands where we left off.
    await expect(items).toHaveCount(20);
    await expect
      .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - before))
      .toBeLessThan(150);
  });

  test('clicking Home or the logo resets to a fresh top-of-feed', async ({ page }) => {
    await page.goto('/');
    const items = page.locator('.feed__list > li');
    await expect(items).toHaveCount(10);
    const newestHref = (await items.first().locator('h2 a').getAttribute('href')) ?? '';

    // Scroll a second batch in so there is a non-trivial position to reset from, and
    // let the throttled scroll capture (150ms) persist the anchor — the reset must win
    // over a saved position, not just over a blank one.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(items).toHaveCount(20);
    await page.waitForTimeout(300);

    // Unlike Back (previous test), a link navigation starts over: page 1 only, newest
    // entry first, viewport at the top.
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(items).toHaveCount(10);
    await expect(items.first().locator('h2 a')).toHaveAttribute('href', newestHref);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

    // The logo is the same affordance; it must reset too.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(items).toHaveCount(20);
    await page.waitForTimeout(300);

    await page.getByRole('link', { name: 'online-trash home' }).click();
    await expect(items).toHaveCount(10);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });
});
