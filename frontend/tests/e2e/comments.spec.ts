import { expect, test } from '@playwright/test';

// End-to-end coverage of the comment section (015) against the ISOLATED e2e stack
// (run via scripts\e2e.ps1). The read slice (US1): the newest seeded post carries three
// comments that render newest-first with a count, and every other post shows the explicit
// empty state. The E2eSeeder plants exactly three comments ("E2E seed comment 01..03") on
// the newest post and none on the rest. Create/moderation slices layer on in later stories.

test.describe('Comments — read', () => {
  test('a post with comments renders them newest-first with a count', async ({ page }) => {
    await page.goto('/');

    // The newest post is first in the feed; open its permalink.
    await page.locator('.feed__list > li h2 a').first().click();
    await expect(page).toHaveURL(/\/posts\/[A-Za-z0-9_-]+$/);

    const section = page.getByRole('region', { name: 'Comments' });
    await expect(section.getByText('3 comments')).toBeVisible();

    // Newest-first: the last-created seed comment is on top.
    const bodies = section.locator('.comment-list > li .comment__body');
    await expect(bodies).toHaveCount(3);
    await expect(bodies.nth(0)).toHaveText('E2E seed comment 03');
    await expect(bodies.nth(1)).toHaveText('E2E seed comment 02');
    await expect(bodies.nth(2)).toHaveText('E2E seed comment 01');
  });

  test('a post with no comments shows the empty state', async ({ page }) => {
    await page.goto('/');

    // The second feed entry is a comment-free seed post.
    await page.locator('.feed__list > li h2 a').nth(1).click();
    await expect(page).toHaveURL(/\/posts\/[A-Za-z0-9_-]+$/);

    const section = page.getByRole('region', { name: 'Comments' });
    await expect(section.getByText(/no comments yet/i)).toBeVisible();
    await expect(section.locator('.comment-list > li')).toHaveCount(0);
  });
});
