# Feed Scroll Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user scrolls the Home feed, opens a post, and presses Back (or refreshes), restore the previously loaded posts and the scroll position.

**Architecture:** Persist a per-feed-URL snapshot (`posts`, keyset `cursor`, `status`, plus an **anchor** = the hash of the post at the top of the viewport and how far it is scrolled past) to `sessionStorage`. `useFeed` hydrates from the snapshot instead of starting empty. A thin `useScrollRestoration` hook captures the anchor on scroll/`pagehide` and, on mount, scrolls the anchor element back into place. Anchor-based (not pixel-based) so it is robust to lazy images that have no reserved height.

**Tech Stack:** TypeScript, React 18, react-router-dom 7, Vitest (unit, coverage-scoped to `src/lib/**`), Playwright (e2e). No new dependencies — `sessionStorage`, `scroll`/`pagehide` events, and `history.scrollRestoration` are all native.

**Design doc:** `docs/superpowers/specs/2026-06-09-feed-scroll-restoration-design.md`

---

## File Structure

- **Create** `frontend/src/lib/feedCache.ts` — pure snapshot persistence (sessionStorage via an injected `Storage`). Coverage-scoped, unit-tested.
- **Create** `frontend/src/lib/scrollAnchor.ts` — pure anchor-selection math. Coverage-scoped, unit-tested.
- **Create** `frontend/src/hooks/useScrollRestoration.ts` — thin glue: capture anchor on scroll/pagehide, restore on mount.
- **Modify** `frontend/src/hooks/useFeed.ts` — hydrate reducer + cursor from a snapshot; persist on every settled load; accept a `cacheKey`.
- **Modify** `frontend/src/components/Feed.tsx` — derive the `cacheKey` from the route, pass it to `useFeed`, mount `useScrollRestoration`, add `data-hash` to each `<li>`.
- **Create** `frontend/tests/lib/feedCache.test.ts` — unit tests (mirrors source).
- **Create** `frontend/tests/lib/scrollAnchor.test.ts` — unit tests (mirrors source).
- **Modify** `frontend/e2e/feed.spec.ts` — add the Back-restores-scroll e2e case.

Conventions: 2-space indent, semicolons, single quotes, `is/has/should` booleans, comments explain *why*. Pure logic lives in `src/lib` (the only coverage-scoped area); hooks/components stay thin glue.

---

## Task 1: `feedCache.ts` — snapshot persistence

**Files:**
- Create: `frontend/src/lib/feedCache.ts`
- Test: `frontend/tests/lib/feedCache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/lib/feedCache.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedSnapshot } from '../../src/lib/feedCache';
import {
  clearSnapshot,
  feedKey,
  readSnapshot,
  updateSnapshot,
  writeSnapshot,
} from '../../src/lib/feedCache';

// Vitest unit specs run in Node (no DOM), so inject an in-memory Storage stub.
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

const sample: FeedSnapshot = {
  posts: [{ hash: 'a', title: null, permalink: '/posts/a', media: { kind: 'none' } }],
  cursor: 'a',
  status: 'loaded',
  anchorHash: null,
  anchorOffset: 0,
};

describe('feedKey', () => {
  it('uses the pathname for the newest page', () => {
    expect(feedKey('/', '')).toBe('ladybug.feed:/');
  });

  it('includes the search so each page break keys separately', () => {
    expect(feedKey('/', '?after=xyz')).toBe('ladybug.feed:/?after=xyz');
  });
});

describe('read/write/clear snapshot', () => {
  let storage: Storage;
  beforeEach(() => {
    storage = memoryStorage();
  });

  it('round-trips a snapshot', () => {
    writeSnapshot(storage, 'k', sample);
    expect(readSnapshot(storage, 'k')).toEqual(sample);
  });

  it('returns null for a missing key', () => {
    expect(readSnapshot(storage, 'missing')).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    storage.setItem('k', '{ not json');
    expect(readSnapshot(storage, 'k')).toBeNull();
  });

  it('swallows a setItem failure (e.g. quota) instead of throwing', () => {
    const throwing = { ...memoryStorage(), setItem: vi.fn(() => { throw new Error('quota'); }) } as Storage;
    expect(() => writeSnapshot(throwing, 'k', sample)).not.toThrow();
  });

  it('removes a snapshot', () => {
    writeSnapshot(storage, 'k', sample);
    clearSnapshot(storage, 'k');
    expect(readSnapshot(storage, 'k')).toBeNull();
  });
});

describe('updateSnapshot', () => {
  it('merges a partial into an existing snapshot', () => {
    const storage = memoryStorage();
    writeSnapshot(storage, 'k', sample);
    updateSnapshot(storage, 'k', { anchorHash: 'a', anchorOffset: 120 });
    expect(readSnapshot(storage, 'k')).toEqual({ ...sample, anchorHash: 'a', anchorOffset: 120 });
  });

  it('is a no-op when no snapshot exists yet', () => {
    const storage = memoryStorage();
    updateSnapshot(storage, 'k', { anchorHash: 'a', anchorOffset: 1 });
    expect(readSnapshot(storage, 'k')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend; npm test -- feedCache`
Expected: FAIL — cannot resolve `../../src/lib/feedCache`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/feedCache.ts`:

```ts
import type { FeedPost } from './feedModel';
import type { FeedStatus } from './pagination';

// One feed page's restorable state. `posts`/`cursor`/`status` let us re-render the
// loaded feed without refetching (which would shift the newest-first list); the
// anchor pins the scroll position to a specific post rather than a raw pixel offset
// (lazy images have no reserved height, so a pixel offset would land wrong).
export type FeedSnapshot = {
  posts: FeedPost[];
  cursor?: string;
  status: FeedStatus;
  anchorHash: string | null;
  anchorOffset: number;
};

const NAMESPACE = 'ladybug.feed';

// Keyed by feed URL so the newest page and each `?after=` page break persist apart.
export function feedKey(pathname: string, search: string): string {
  return `${NAMESPACE}:${pathname}${search}`;
}

export function readSnapshot(storage: Storage, key: string): FeedSnapshot | null {
  const raw = storage.getItem(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as FeedSnapshot;
  } catch {
    // A corrupt entry must degrade to a fresh feed, never throw on navigation.
    return null;
  }
}

export function writeSnapshot(storage: Storage, key: string, snapshot: FeedSnapshot): void {
  try {
    storage.setItem(key, JSON.stringify(snapshot));
  } catch {
    // Quota or private-mode failures must not break the feed; restoration is best-effort.
  }
}

export function clearSnapshot(storage: Storage, key: string): void {
  storage.removeItem(key);
}

// Read-modify-write so the scroll hook can update only the anchor without clobbering
// the posts the feed hook wrote (and vice versa). No-op until a snapshot exists.
export function updateSnapshot(storage: Storage, key: string, partial: Partial<FeedSnapshot>): void {
  const existing = readSnapshot(storage, key);
  if (!existing) {
    return;
  }
  writeSnapshot(storage, key, { ...existing, ...partial });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend; npm test -- feedCache`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/feedCache.ts frontend/tests/lib/feedCache.test.ts
git commit -m "feat(005): feed snapshot persistence helper (sessionStorage)"
```

---

## Task 2: `scrollAnchor.ts` — anchor selection math

**Files:**
- Create: `frontend/src/lib/scrollAnchor.ts`
- Test: `frontend/tests/lib/scrollAnchor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/lib/scrollAnchor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { pickAnchor } from '../../src/lib/scrollAnchor';

// Item tops are document-absolute (px from the top of the page).
const items = [
  { hash: 'a', top: 0 },
  { hash: 'b', top: 500 },
  { hash: 'c', top: 1200 },
];

describe('pickAnchor', () => {
  it('returns null for an empty list', () => {
    expect(pickAnchor([], 0)).toBeNull();
  });

  it('anchors to the first item at the top of the page', () => {
    expect(pickAnchor(items, 0)).toEqual({ anchorHash: 'a', anchorOffset: 0 });
  });

  it('anchors to the item straddling the viewport top, with how far it is scrolled past', () => {
    expect(pickAnchor(items, 650)).toEqual({ anchorHash: 'b', anchorOffset: 150 });
  });

  it('treats an exact item top as that item with zero offset', () => {
    expect(pickAnchor(items, 1200)).toEqual({ anchorHash: 'c', anchorOffset: 0 });
  });

  it('anchors to the last item when scrolled beyond it', () => {
    expect(pickAnchor(items, 5000)).toEqual({ anchorHash: 'c', anchorOffset: 3800 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend; npm test -- scrollAnchor`
Expected: FAIL — cannot resolve `../../src/lib/scrollAnchor`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/scrollAnchor.ts`:

```ts
// A feed item's hash and its document-absolute top (px from the top of the page).
export type ItemRect = { hash: string; top: number };

export type Anchor = { anchorHash: string; anchorOffset: number };

// Choose the post at the top of the viewport as the scroll anchor: the last item
// whose top is at or above the current scroll position, plus how far that item is
// scrolled past the viewport top. Falls back to the first item when scrolled above
// all of them. Restoring later means: scrollTo(item.currentTop + anchorOffset).
export function pickAnchor(items: ItemRect[], scrollY: number): Anchor | null {
  if (items.length === 0) {
    return null;
  }
  let anchor = items[0];
  for (const item of items) {
    if (item.top <= scrollY) {
      anchor = item;
    } else {
      break;
    }
  }
  return { anchorHash: anchor.hash, anchorOffset: scrollY - anchor.top };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend; npm test -- scrollAnchor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/scrollAnchor.ts frontend/tests/lib/scrollAnchor.test.ts
git commit -m "feat(005): pure scroll-anchor selection helper"
```

---

## Task 3: Hydrate and persist in `useFeed`

This task wires the snapshot into the feed hook so the loaded posts survive a remount/refresh. `useFeed` is thin glue (outside the coverage scope); it is verified by Task 5's e2e, not a unit test.

**Files:**
- Modify: `frontend/src/hooks/useFeed.ts`

- [ ] **Step 1: Replace the hook body**

Replace the entire contents of `frontend/src/hooks/useFeed.ts` with:

```ts
import { useCallback, useEffect, useReducer, useRef } from 'react';

import { fetchFeed } from '../lib/api';
import { readSnapshot, writeSnapshot } from '../lib/feedCache';
import type { FeedState } from '../lib/pagination';
import { feedReducer, initialFeedState, isPageBreak, nextStart } from '../lib/pagination';

const BATCH_SIZE = 10;

// Build the reducer's initial state from a saved snapshot so Back/Forward and refresh
// re-render the posts the user already loaded instead of refetching the newest page.
function hydrate(cacheKey: string): FeedState {
  const snapshot = readSnapshot(sessionStorage, cacheKey);
  if (snapshot && snapshot.posts.length > 0) {
    return { status: snapshot.status, posts: snapshot.posts };
  }
  return initialFeedState;
}

// Feed state machine for one page: initial load, append-on-scroll, end/empty/error +
// retry. Math lives in lib/pagination, IO in lib/api; this hook is the React glue.
// `cacheKey` identifies the feed URL so its posts/cursor/anchor persist to sessionStorage.
export function useFeed(after: string | undefined, cacheKey: string) {
  const [state, dispatch] = useReducer(feedReducer, cacheKey, hydrate);
  const isLoadingRef = useRef(false);
  const cursorRef = useRef<string | undefined>(
    readSnapshot(sessionStorage, cacheKey)?.cursor ?? after,
  );

  const load = useCallback(async () => {
    if (isLoadingRef.current) {
      return;
    }
    isLoadingRef.current = true;
    dispatch({ type: 'loadStart' });

    const result = await fetchFeed({ limit: BATCH_SIZE, start: cursorRef.current });
    if (result.ok) {
      cursorRef.current = nextStart(result.posts) ?? cursorRef.current;
      dispatch({ type: 'loadSuccess', posts: result.posts, limit: BATCH_SIZE });
    } else {
      dispatch({ type: 'loadError' });
    }
    isLoadingRef.current = false;
  }, []);

  // Auto-load the first batch only when nothing was hydrated from the snapshot.
  useEffect(() => {
    if (state.posts.length === 0) {
      void load();
    }
    // Run once on mount; `load` is stable and `state` is read only for the initial value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the loaded feed on every settled change, preserving the scroll anchor that
  // useScrollRestoration writes separately.
  useEffect(() => {
    if (state.status === 'idle' || state.status === 'loading' || state.status === 'error') {
      return;
    }
    const previous = readSnapshot(sessionStorage, cacheKey);
    writeSnapshot(sessionStorage, cacheKey, {
      posts: state.posts,
      cursor: cursorRef.current,
      status: state.status,
      anchorHash: previous?.anchorHash ?? null,
      anchorOffset: previous?.anchorOffset ?? 0,
    });
  }, [state.posts, state.status, cacheKey]);

  const atPageBreak = isPageBreak(state.posts.length);
  // Auto-load only while the API has more and we have not hit the explicit page break.
  const canAutoLoad = state.status === 'loaded' && !atPageBreak;

  return { state, load, atPageBreak, canAutoLoad };
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend; npm run build`
Expected: PASS (tsc clean). If `FeedState` is reported unused or missing, confirm it is exported from `src/lib/pagination.ts` (it is) and imported as a type.

- [ ] **Step 3: Run the unit suite (no regressions)**

Run: `cd frontend; npm test`
Expected: PASS — existing pagination/api/feedModel tests plus Tasks 1–2 stay green.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useFeed.ts
git commit -m "feat(005): hydrate and persist the feed from a snapshot"
```

---

## Task 4: `useScrollRestoration` hook + wire into `Feed`

**Files:**
- Create: `frontend/src/hooks/useScrollRestoration.ts`
- Modify: `frontend/src/components/Feed.tsx`

- [ ] **Step 1: Create the hook**

Create `frontend/src/hooks/useScrollRestoration.ts`:

```ts
import { useEffect, useLayoutEffect } from 'react';

import { readSnapshot, updateSnapshot } from '../lib/feedCache';
import { pickAnchor } from '../lib/scrollAnchor';
import type { ItemRect } from '../lib/scrollAnchor';

const THROTTLE_MS = 150;

// Document-absolute top of every rendered feed item, paired with its hash.
function collectItemRects(): ItemRect[] {
  const els = document.querySelectorAll<HTMLElement>('.feed__list > li[data-hash]');
  return Array.from(els, (el) => ({
    hash: el.dataset.hash ?? '',
    top: el.getBoundingClientRect().top + window.scrollY,
  }));
}

function scrollToAnchor(hash: string, offset: number): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`.feed__list > li[data-hash="${CSS.escape(hash)}"]`);
  if (!el) {
    return null;
  }
  const top = el.getBoundingClientRect().top + window.scrollY;
  window.scrollTo(0, top + offset);
  return el;
}

// Restores the feed scroll position on Back/Forward/refresh and keeps the saved anchor
// current as the user scrolls. Anchor-based so lazy images (no reserved height) cannot
// throw off the restore: we pin a specific post to the viewport top, not a raw pixel.
export function useScrollRestoration(cacheKey: string): void {
  // Restore before paint so the user never sees a flash at the top.
  useLayoutEffect(() => {
    const snapshot = readSnapshot(sessionStorage, cacheKey);
    if (!snapshot?.anchorHash) {
      return;
    }
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }
    const { anchorHash, anchorOffset } = snapshot;
    const el = scrollToAnchor(anchorHash, anchorOffset);
    // The anchor's lazy image may still grow the element; re-pin once it loads.
    const img = el?.querySelector('img');
    if (img && !img.complete) {
      const reapply = () => scrollToAnchor(anchorHash, anchorOffset);
      img.addEventListener('load', reapply, { once: true });
      return () => img.removeEventListener('load', reapply);
    }
  }, [cacheKey]);

  // Capture the current anchor as the user scrolls (throttled) and on pagehide (refresh
  // / tab close). updateSnapshot no-ops until the feed hook has written the posts.
  useEffect(() => {
    let timer: number | undefined;
    const capture = () => {
      const anchor = pickAnchor(collectItemRects(), window.scrollY);
      if (anchor) {
        updateSnapshot(sessionStorage, cacheKey, anchor);
      }
    };
    const onScroll = () => {
      if (timer !== undefined) {
        return;
      }
      timer = window.setTimeout(() => {
        timer = undefined;
        capture();
      }, THROTTLE_MS);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', capture);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', capture);
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [cacheKey]);
}
```

- [ ] **Step 2: Wire it into `Feed.tsx`**

In `frontend/src/components/Feed.tsx`, update the imports — add `useLocation` to the existing react-router-dom import, and add the new hook + feedKey imports:

```ts
import { Link, useLocation } from 'react-router-dom';

import { useFeed } from '../hooks/useFeed';
import { useScrollRestoration } from '../hooks/useScrollRestoration';
import { feedKey } from '../lib/feedCache';
import { nextStart } from '../lib/pagination';
```

Replace the start of the `Feed` function (the `useFeed` call) with the cache-key derivation, the new `useFeed` signature, and the restoration hook:

```ts
function Feed({ after }: { after?: string }) {
  const location = useLocation();
  const cacheKey = feedKey(location.pathname, location.search);
  const { state, load, atPageBreak, canAutoLoad } = useFeed(after, cacheKey);
  useScrollRestoration(cacheKey);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
```

Add `data-hash` to the list item so the restore can find the anchor element. Change:

```tsx
          <li key={post.hash}>
```

to:

```tsx
          <li key={post.hash} data-hash={post.hash}>
```

- [ ] **Step 3: Type-check and lint**

Run: `cd frontend; npm run build; npm run lint`
Expected: both PASS. (`Link` and `useLocation` both come from the single react-router-dom import; no duplicate-import lint error.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useScrollRestoration.ts frontend/src/components/Feed.tsx
git commit -m "feat(005): restore feed scroll position via anchor hook"
```

---

## Task 5: End-to-end verification

**Files:**
- Modify: `frontend/e2e/feed.spec.ts`

Prerequisite: the dev stack must be running (Vite on 5173 + the 004 API on 8000 via Docker) — see the frontend README / quickstart. Note the opcache rule: PHP edits need `docker compose restart backend`, but this task touches no backend code.

- [ ] **Step 1: Add the e2e case**

In `frontend/e2e/feed.spec.ts`, add this test inside the `test.describe('Home feed', …)` block (after the existing tests, before the closing `});`):

```ts
  test('restores scroll position after returning from a post', async ({ page }) => {
    await page.goto('/');
    const items = page.locator('.feed__list > li');
    await expect(items).toHaveCount(10);

    // Load a second batch, then scroll partway into it so the position is non-trivial.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(items).toHaveCount(20);
    await page.evaluate(() => window.scrollTo(0, Math.round(document.body.scrollHeight / 2)));
    // Let the throttled scroll capture (150ms) persist the anchor.
    await page.waitForTimeout(300);

    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(0);

    // Open a post and navigate back.
    const link = items.nth(12).locator('h2 a');
    const href = await link.getAttribute('href');
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await page.goBack();

    // The previously loaded posts are restored and the scroll lands where we left off.
    await expect(items).toHaveCount(20);
    await expect
      .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - before))
      .toBeLessThan(150);
  });
```

- [ ] **Step 2: Run the e2e suite**

Run: `cd frontend; npm run e2e`
Expected: PASS — all Home-feed tests including the new restoration case. If the new test is flaky on scroll timing, the `expect.poll` tolerance (150px) absorbs minor lazy-image settling; do not loosen it past ~200px without checking the restore is actually firing.

- [ ] **Step 3: Full local gate**

Run: `cd frontend; npm run lint; npm test -- --coverage`
Expected: lint clean; unit suite green; coverage on `src/lib/**` stays ≥90% (new `feedCache.ts` and `scrollAnchor.ts` are fully covered by Tasks 1–2).

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/feed.spec.ts
git commit -m "test(005): e2e for feed scroll restoration on Back"
```

---

## Self-Review Notes

- **Spec coverage:** persistence layer (Task 1) ✓; anchor strategy (Task 2 + Task 4) ✓; hydration without refetch (Task 3) ✓; capture on scroll + pagehide and restore on mount (Task 4) ✓; `data-hash` anchor element (Task 4) ✓; sessionStorage tab-scoping + no expiry (Tasks 1/3, by construction) ✓; don't persist while in `error` (Task 3) ✓; Vitest + Playwright tests (Tasks 1, 2, 5) ✓.
- **Type consistency:** `FeedSnapshot` fields (`posts`, `cursor`, `status`, `anchorHash`, `anchorOffset`) are used identically across `feedCache.ts`, `useFeed.ts`, and `useScrollRestoration.ts`. `feedKey(pathname, search)`, `readSnapshot`/`writeSnapshot`/`updateSnapshot`/`clearSnapshot(storage, key, …)`, and `pickAnchor(items, scrollY)` signatures match every call site. `ItemRect`/`Anchor` from `scrollAnchor.ts` match the hook's usage.
- **Anchor math sign:** `anchorOffset = scrollY - item.top` (Task 2); restore is `scrollTo(currentTop + anchorOffset)` (Task 4) — inverse operations, verified by the Task 2 cases.
- **No placeholders:** every step shows complete code or an exact command with expected output.
