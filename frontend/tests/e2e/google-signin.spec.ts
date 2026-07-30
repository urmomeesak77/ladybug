import type { Page } from '@playwright/test';

import { expect, test } from './helpers/e2eReset';

// Browser coverage of the Google sign-in CONTROL (017, US6) against the isolated e2e stack
// (run via scripts\e2e.ps1). The round trip itself is deliberately not driven here: it would
// need Google, a real client and a human at a consent screen (research D16). What can be
// driven is everything the visitor sees before and after it — and that is only possible
// because the button renders unconditionally, never on backend configuration (research D12).
//
// The e2e stack's GOOGLE_* values are empty on purpose, so activating the control exercises
// the unconfigured deployment's real answer: a refusal on a real page, not a blank one.

// Each auth page and the submit button of the password form it sits beneath — the
// control the Google door has to be the equal of, at every width.
const PAGES = [
  { path: '/login', submit: 'Login' },
  { path: '/register', submit: 'Register' },
] as const;

const NARROW = { width: 320, height: 640 };
const DESKTOP = { width: 1440, height: 900 };

// The mark's official blue (#4285F4). It is the one thing on the page that must NOT
// follow the colour scheme (contracts/ui-surface.md §4).
const GOOGLE_BLUE = 'rgb(66, 133, 244)';

async function appearance(page: Page): Promise<{ background: string; text: string; mark: string }> {
  return page.evaluate(() => {
    const button = document.querySelector('.google-button') as HTMLElement;
    const mark = document.querySelector('.google-button__mark path') as SVGPathElement;
    const styles = getComputedStyle(button);
    return {
      background: styles.backgroundColor,
      text: styles.color,
      mark: getComputedStyle(mark).fill,
    };
  });
}

// Tab from the top of the document until the control takes focus, so "reachable by
// keyboard" is proved by actually arriving there rather than by calling .focus(). The
// budget covers the whole page — the site header and the left menu come first, and the
// point of the assertion is that nothing in front of the button traps focus.
async function tabToGoogleButton(page: Page): Promise<void> {
  // RequireAnon renders NOTHING until the session probe resolves, so tabbing straight
  // after goto() walks an empty <main> and finds only the site chrome.
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  const trail: string[] = [];
  for (let press = 0; press < 25; press += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        reached: active?.classList.contains('google-button') ?? false,
        what: `${active?.tagName ?? 'none'}[${active?.getAttribute('class') ?? ''}]`,
      };
    });
    if (focused.reached) {
      return;
    }
    trail.push(focused.what);
  }
  // The trail is the whole diagnosis when this fails: a focus trap repeats one element,
  // an unreachable button ends on the document body.
  throw new Error(`the Google button was never reached by Tab; focus went ${trail.join(' → ')}`);
}

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

test.describe('The Google sign-in control', () => {
  for (const { path, submit } of PAGES) {
    test(`${path} offers it, names the action, and separates it with the word "or"`, async ({ page }) => {
      await page.goto(path);

      const button = page.getByRole('button', { name: 'Continue with Google' });
      await expect(button).toBeVisible();
      // FR-026: the separation is a real, visible, screen-reader-reachable word.
      await expect(page.getByText('or', { exact: true })).toBeVisible();
      // FR-027: the mark is decoration; the button's own text carries the name.
      await expect(page.locator('.google-button__mark')).toHaveAttribute('aria-hidden', 'true');
    });

    test(`${path} reaches and activates it by keyboard alone`, async ({ page }) => {
      await page.goto(path);

      await tabToGoogleButton(page);
      await page.keyboard.press('Enter');

      // The e2e backend has no Google client configured, so the start route refuses the
      // way an unconfigured deployment refuses: a retryable sentence on a real page. Both
      // doors return to /login, which is where the message region lives on either path.
      await expect(page).toHaveURL('/login?error=provider');
      await expect(page.getByRole('alert'))
        .toHaveText('Google could not be reached. Please try again, or use e-mail and password.');
    });

    test(`${path} fits 320px and desktop in both colour schemes`, async ({ page }) => {
      const button = page.getByRole('button', { name: 'Continue with Google' });

      for (const size of [NARROW, DESKTOP]) {
        await page.setViewportSize(size);
        await page.emulateMedia({ colorScheme: 'light' });
        await page.goto(path);

        await expect(button).toBeVisible();
        expect(await hasHorizontalScroll(page)).toBe(false);
        // ≥44 CSS px touch target, and exactly as wide as the password form's submit —
        // the two sign-in methods are equals, and at 320px that means both fill the
        // column rather than one of them being a stranded, hard-to-hit control.
        const box = await button.boundingBox();
        const passwordDoor = await page.getByRole('button', { name: submit }).boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        expect(box?.width ?? 0).toBeCloseTo(passwordDoor?.width ?? 0, 1);

        const light = await appearance(page);
        await page.emulateMedia({ colorScheme: 'dark' });
        const dark = await appearance(page);

        await expect(button).toBeVisible();
        expect(await hasHorizontalScroll(page)).toBe(false);
        // Themed through the shared tokens, not hard-coded: both surface and text move
        // with the scheme. The mark does not — that exception is by design.
        expect(dark.background).not.toBe(light.background);
        expect(dark.text).not.toBe(light.text);
        expect(light.mark).toBe(GOOGLE_BLUE);
        expect(dark.mark).toBe(GOOGLE_BLUE);
      }
    });
  }

  test('a refusal message survives a reload and re-runs nothing (FR-030)', async ({ page }) => {
    const flowRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/auth/google/')) {
        flowRequests.push(request.url());
      }
    });

    await page.goto('/login?error=cancelled');
    await expect(page.getByRole('alert')).toHaveText('Google sign-in was cancelled.');

    await page.reload();

    // The code is a display input, so a refresh re-renders the same sentence at the same
    // URL and asks Google for nothing — F5 on a refusal is not a retry.
    await expect(page).toHaveURL('/login?error=cancelled');
    await expect(page.getByRole('alert')).toHaveText('Google sign-in was cancelled.');
    expect(flowRequests).toEqual([]);
  });
});
