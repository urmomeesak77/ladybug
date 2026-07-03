import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Cross-site parity: the Home header logo must sit in the same position and render at the
// same size as the prototype's logo. Both pages are measured live at the same viewport so
// the comparison is apples-to-apples; the prototype is the source of truth.
//
// The prototype runs only on the dev machine (not in CI, not in the isolated e2e stack),
// so this spec is opt-in: set E2E_PROTOTYPE_URL (e.g. http://trash.dv/) to run it against
// the app at baseURL. Without it the spec is skipped, keeping full-suite runs green.

const prototypeUrl = process.env.E2E_PROTOTYPE_URL;

// Sub-pixel rounding and font metrics differ slightly between the two pages, so allow a
// small tolerance rather than demanding exact equality.
const TOLERANCE_PX = 2;

async function logoBox(page: Page, url: string, selector: string) {
  await page.goto(url);
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible' });
  const box = await el.boundingBox();
  if (!box) throw new Error(`No bounding box for ${selector} at ${url}`);
  return box;
}

test('Home logo matches the prototype logo position and size', async ({ page }) => {
  test.skip(!prototypeUrl, 'set E2E_PROTOTYPE_URL to the local prototype to run this spec');

  const target = await logoBox(page, prototypeUrl as string, '#top-menu a.logo');
  const actual = await logoBox(page, '/', '.site-logo');

  expect(Math.abs(actual.x - target.x)).toBeLessThanOrEqual(TOLERANCE_PX);
  expect(Math.abs(actual.y - target.y)).toBeLessThanOrEqual(TOLERANCE_PX);
  expect(Math.abs(actual.width - target.width)).toBeLessThanOrEqual(TOLERANCE_PX);
  expect(Math.abs(actual.height - target.height)).toBeLessThanOrEqual(TOLERANCE_PX);
});
