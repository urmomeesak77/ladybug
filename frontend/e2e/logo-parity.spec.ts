import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Cross-site parity: the Home header logo must sit in the same position and render at the
// same size as the prototype's logo at trash.dv. Both pages are measured live at the same
// viewport so the comparison is apples-to-apples; the prototype is the source of truth.

const PROTOTYPE_URL = 'http://trash.dv/';
const APP_URL = 'http://127.0.0.1:5173/';

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
  const target = await logoBox(page, PROTOTYPE_URL, '#top-menu a.logo');
  const actual = await logoBox(page, APP_URL, '.site-logo');

  expect(Math.abs(actual.x - target.x)).toBeLessThanOrEqual(TOLERANCE_PX);
  expect(Math.abs(actual.y - target.y)).toBeLessThanOrEqual(TOLERANCE_PX);
  expect(Math.abs(actual.width - target.width)).toBeLessThanOrEqual(TOLERANCE_PX);
  expect(Math.abs(actual.height - target.height)).toBeLessThanOrEqual(TOLERANCE_PX);
});
