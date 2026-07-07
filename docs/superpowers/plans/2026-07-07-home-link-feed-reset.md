# Home Link / Logo Feed Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking any link to the home feed (left-menu Home, logo) resets the feed to a fresh top-of-page load, while Back/Forward/refresh keep restoring the saved posts + scroll position.

**Architecture:** The feed caches posts and a scroll anchor in `sessionStorage` (`FeedCache`) and restores them on every mount. We add a `fresh` flag derived from React Router's navigation type — `PUSH`/`REPLACE` (link click) means fresh, `POP` (Back/Forward/refresh/initial load) means restore — and remount `Feed` on every navigation via `key={location.key}` so clicking Home while already on `/` takes effect.

**Tech Stack:** React 18, react-router-dom v7 (`useNavigationType`), Vitest + @testing-library/react (jsdom).

**Spec:** `docs/superpowers/specs/2026-07-07-home-link-feed-reset-design.md`

## Global Constraints

- All work is in `frontend/` — no backend changes, no new dependencies (Constitution Principle I).
- `docs/CODING_CONVENTIONS.md` is binding: 2-space indent, semicolons, comments explain *why*, no loose exported helper functions (lib logic lives in classes; React components/hooks stay functions).
- Coverage gate: `npx vitest run --coverage --coverage.thresholds.lines=90` must pass (CI runs exactly this).
- Lint gate: `npm run lint` must pass.
- All commands below run from `C:\projects\ladybug\frontend`.
- Commit on the current branch (`master`); do not create branches.
- Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Ordering subtlety (why `fresh` must skip hydration, not rely on clearing)

When `Feed`'s `key` changes, React renders the NEW instance (running its `useReducer` initializer, which reads the snapshot) BEFORE the OLD instance's layout-effect cleanup writes its final scroll anchor, and before any mount effect can clear storage. So the `fresh` flag must make the initializer ignore the snapshot outright; the mount effect then also clears the stored snapshot so the stale anchor cannot be resurrected (`FeedCache.updateSnapshot` no-ops when no snapshot exists).

## Existing behavior that must NOT change

- `POP` restore: the e2e spec `frontend/e2e/feed.spec.ts` ("restores scroll position after returning from a post") uses `page.goBack()` — a POP — and must stay green.
- All current Vitest suites assert the restore path; they keep passing by passing `fresh: false` explicitly.

---

### Task 1: `useScrollRestoration` gets a `fresh` parameter

**Files:**
- Modify: `frontend/src/hooks/useScrollRestoration.ts`
- Modify: `frontend/src/components/Feed.tsx:36` (call site — pass literal `false`, behavior unchanged until Task 3)
- Test: `frontend/tests/hooks/useScrollRestoration.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `useScrollRestoration(cacheKey: string, fresh: boolean): void` — when `fresh` is `true` the hook ignores any saved anchor and scrolls to `(0, 0)`; capture-on-scroll/unmount/pagehide behavior is unchanged. Task 3 passes the real `fresh` value.

- [ ] **Step 1: Write the failing test**

In `frontend/tests/hooks/useScrollRestoration.test.tsx`, add inside `describe('useScrollRestoration', …)`:

```tsx
it('ignores the saved anchor and scrolls to the top when fresh', () => {
  mountFeedList(['aaa0000001', 'bbb0000002']);
  FeedCache.writeSnapshot(sessionStorage, CACHE_KEY, snapshot({
    anchorHash: 'bbb0000002',
    anchorOffset: 40,
  }));

  renderHook(() => useScrollRestoration(CACHE_KEY, true));

  expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
});
```

Also update every existing `useScrollRestoration(CACHE_KEY)` call in this file to `useScrollRestoration(CACHE_KEY, false)` (5 occurrences).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/useScrollRestoration.test.tsx`
Expected: the new test FAILS — `window.scrollTo` called with `(0, 140)` instead of `(0, 0)` (the anchor is restored because the hook has no `fresh` handling yet; the extra argument is ignored at runtime).

- [ ] **Step 3: Implement**

In `frontend/src/hooks/useScrollRestoration.ts`, change the signature and the restore layout effect (the other two effects are untouched):

```ts
// Restores the feed scroll position on Back/Forward/refresh and keeps the saved anchor
// current as the user scrolls. Anchor-based so lazy images (no reserved height) cannot
// throw off the restore: we pin a specific post to the viewport top, not a raw pixel.
// `fresh` (a link navigation, not history traversal) skips the saved anchor entirely:
// the user asked for the page anew, so they start at the top.
export function useScrollRestoration(cacheKey: string, fresh: boolean): void {
  // Restore before paint so the user never sees a flash at the top.
  useLayoutEffect(() => {
    const snapshot = fresh ? null : FeedCache.readSnapshot(sessionStorage, cacheKey);
    const target = ScrollAnchor.pickRestoreTarget(snapshot);
    if (target.kind === 'top') {
      // A fresh page (e.g. reached via "Load more") starts at the top; with manual
      // scrollRestoration it would otherwise keep the previous page's clamped position.
      window.scrollTo(0, 0);
      return;
    }
    const { hash, offset } = target;
    const el = scrollToAnchor(hash, offset);
    // The anchor's lazy image may still grow the element; re-pin once it loads.
    const img = el?.querySelector('img');
    if (img && !img.complete) {
      const reapply = () => scrollToAnchor(hash, offset);
      img.addEventListener('load', reapply, { once: true });
      return () => img.removeEventListener('load', reapply);
    }
  }, [cacheKey, fresh]);
```

(Only the first `useLayoutEffect` changes: `snapshot` is forced to `null` when `fresh`, and `fresh` joins the dependency array. Keep the unmount-capture and scroll/pagehide effects exactly as they are.)

In `frontend/src/components/Feed.tsx`, update the call site so TypeScript compiles (real value arrives in Task 3):

```ts
  useScrollRestoration(cacheKey, false);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/useScrollRestoration.test.tsx tests/components/Feed.test.tsx`
Expected: PASS (all tests, both files).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useScrollRestoration.ts src/components/Feed.tsx tests/hooks/useScrollRestoration.test.tsx
git commit -m "feat(feed): teach useScrollRestoration a fresh mode that starts at the top"
```

---

### Task 2: `useFeed` gets a `fresh` parameter

**Files:**
- Modify: `frontend/src/hooks/useFeed.ts`
- Modify: `frontend/src/components/Feed.tsx:35` (call site — pass literal `false`, behavior unchanged until Task 3)
- Test: `frontend/tests/hooks/useFeed.test.tsx`

**Interfaces:**
- Consumes: `FeedCache.clearSnapshot(storage, key)` (exists in `src/lib/feedCache.ts`).
- Produces: `useFeed(after: string | undefined, cacheKey: string, fresh: boolean)` — when `fresh` is `true` the hook ignores the stored snapshot (initializer), clears it on mount, and fetches the first batch from the API. Task 3 passes the real `fresh` value.

- [ ] **Step 1: Write the failing test**

In `frontend/tests/hooks/useFeed.test.tsx`, add inside `describe('useFeed', …)`:

```tsx
it('skips the snapshot and refetches from the top when fresh', async () => {
  FeedCache.writeSnapshot(sessionStorage, CACHE_KEY, {
    posts: posts(3, 'a'),
    cursor: 'a0000002',
    status: 'end',
    anchorHash: 'a0000001',
    anchorOffset: 40,
  });
  const fetchFeed = vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: posts(10, 'b') });

  const { result } = renderHook(() => useFeed(undefined, CACHE_KEY, true));

  await waitFor(() => expect(result.current.state.status).toBe('loaded'));
  // The snapshot's cursor must not leak into the fresh request: page 1 starts unset.
  expect(fetchFeed).toHaveBeenCalledWith({ limit: 10, start: undefined });
  expect(result.current.state.posts[0].hash).toBe('b0000000');
  // The old snapshot (posts + anchor) was cleared; the fresh load wrote a new one
  // anchored at the top.
  const saved = FeedCache.readSnapshot(sessionStorage, CACHE_KEY);
  expect(saved?.posts).toHaveLength(10);
  expect(saved?.anchorHash).toBeNull();
});
```

Also update every existing two-argument `useFeed(...)` call in this file to pass a third `false` argument (6 occurrences), e.g. `useFeed(undefined, CACHE_KEY, false)` and `useFeed('cursor0001', CACHE_KEY, false)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/useFeed.test.tsx`
Expected: the new test FAILS — status becomes `'end'` (hydrated from the snapshot) and `fetchFeed` is never called, so the `waitFor` on `'loaded'` times out.

- [ ] **Step 3: Implement**

In `frontend/src/hooks/useFeed.ts`, replace the `hydrate` function and the hook's first lines/mount effect:

```ts
type HydrateInit = { cacheKey: string; fresh: boolean };

// Build the reducer's initial state from a saved snapshot so Back/Forward and refresh
// re-render the posts the user already loaded instead of refetching. A fresh (link)
// navigation skips the snapshot here, in the initializer: on a keyed remount this runs
// before the outgoing feed's unmount cleanup, so storage cannot be trusted to be
// cleared yet.
function hydrate(init: HydrateInit): FeedState {
  if (init.fresh) {
    return Pagination.initialState;
  }
  const snapshot = FeedCache.readSnapshot(sessionStorage, init.cacheKey);
  if (snapshot && snapshot.posts.length > 0) {
    return { status: snapshot.status, posts: snapshot.posts };
  }
  return Pagination.initialState;
}

// Feed state machine for one page: initial load, append-on-scroll, end/empty/error +
// retry. Math lives in lib/pagination, IO in lib/api; this hook is the React glue.
// `cacheKey` identifies the feed URL so its posts/cursor/anchor persist to sessionStorage;
// `fresh` (link navigation) discards that persisted state and reloads page 1.
export function useFeed(after: string | undefined, cacheKey: string, fresh: boolean) {
  const [state, dispatch] = useReducer(Pagination.reducer, { cacheKey, fresh }, hydrate);
```

and in the mount effect, clear the snapshot before seeding the cursor:

```ts
  // Seed the cursor (snapshot cursor, else the URL cursor) and auto-load the first
  // batch only when nothing was hydrated from the snapshot. A fresh mount drops the
  // stored snapshot first so the stale anchor/cursor cannot resurface (updateSnapshot
  // no-ops while no snapshot exists).
  useEffect(() => {
    if (fresh) {
      FeedCache.clearSnapshot(sessionStorage, cacheKey);
    }
    cursorRef.current = FeedCache.readSnapshot(sessionStorage, cacheKey)?.cursor ?? after;
    if (state.posts.length === 0) {
      void load();
    }
    // Run once on mount; `load` is stable and `state` is read only for the initial value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

Everything else in the hook (persist effect, `load`, `atPageBreak`, `canAutoLoad`) is unchanged.

In `frontend/src/components/Feed.tsx`, update the call site (real value arrives in Task 3):

```ts
  const { state, load, atPageBreak, canAutoLoad } = useFeed(after, cacheKey, false);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/useFeed.test.tsx tests/components/Feed.test.tsx`
Expected: PASS (all tests, both files).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFeed.ts src/components/Feed.tsx tests/hooks/useFeed.test.tsx
git commit -m "feat(feed): teach useFeed a fresh mode that drops the snapshot and reloads page 1"
```

---

### Task 3: Wire `fresh` to the navigation type and remount on every navigation

**Files:**
- Modify: `frontend/src/components/Feed.tsx`
- Modify: `frontend/src/pages/HomePage.tsx`
- Test: `frontend/tests/pages/HomePage.test.tsx`

**Interfaces:**
- Consumes: `useFeed(after, cacheKey, fresh)` (Task 2), `useScrollRestoration(cacheKey, fresh)` (Task 1), `useNavigationType()` from react-router-dom.
- Produces: end-user behavior — clicking Home/logo resets the feed; Back/Forward/refresh restore.

- [ ] **Step 1: Write the failing integration test**

In `frontend/tests/pages/HomePage.test.tsx`:

Add `fireEvent` to the testing-library import and `Link` to the react-router-dom import:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router-dom';
```

Add the post helpers (same shape as `Feed.test.tsx`) after the imports, plus the `FeedPost` type import:

```tsx
import type { FeedPost } from '../../src/lib/feedModel';

function post(hash: string): FeedPost {
  return { hash, title: `Post ${hash}`, permalink: `/posts/${hash}`, media: { kind: 'none' } };
}

function posts(count: number, prefix: string): FeedPost[] {
  const list: FeedPost[] = [];
  for (let i = 0; i < count; i++) {
    list.push(post(`${prefix}${String(i).padStart(7, '0')}`));
  }
  return list;
}
```

Add the test inside `describe('HomePage', …)`. Both batches are 3 posts (< the batch size of 10) so the feed settles in the `'end'` state and never mounts the IntersectionObserver sentinel, which jsdom does not implement:

```tsx
it('resets to a fresh top-of-feed when a link navigates home again', async () => {
  // A previous visit with 3 posts loaded. anchorHash stays null: a saved anchor would
  // send the initial restore through CSS.escape, which jsdom lacks (anchor-ignoring
  // when fresh is unit-tested in useScrollRestoration.test.tsx).
  sessionStorage.setItem('ladybug.feed:/', JSON.stringify({
    posts: posts(3, 'a'),
    cursor: 'a0000002',
    status: 'end',
    anchorHash: null,
    anchorOffset: 0,
  }));
  const fetchFeed = vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: posts(3, 'b') });

  render(
    <MemoryRouter initialEntries={['/']}>
      <Link to="/">Home</Link>
      <HomePage />
    </MemoryRouter>,
  );

  // The initial mount is a POP navigation: it hydrates the snapshot without fetching.
  expect(await screen.findByText('Post a0000000')).toBeTruthy();
  expect(fetchFeed).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('link', { name: 'Home' }));

  // The link navigation remounts the feed fresh: old posts gone, page 1 refetched,
  // viewport back at the top.
  expect(await screen.findByText('Post b0000000')).toBeTruthy();
  expect(screen.queryByText('Post a0000000')).toBeNull();
  expect(fetchFeed).toHaveBeenCalledWith({ limit: 10, start: undefined });
  expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pages/HomePage.test.tsx`
Expected: the new test FAILS — after the click nothing changes (`Feed` never remounts because its key ignores the navigation), so `Post b0000000` never appears and the `findByText` times out.

- [ ] **Step 3: Implement**

In `frontend/src/components/Feed.tsx`, derive `fresh` from the navigation type. Update the react-router-dom import and the two call sites from Tasks 1–2:

```tsx
import { Link, useLocation, useNavigationType } from 'react-router-dom';
```

```tsx
function Feed({ after }: { after?: string }) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const cacheKey = FeedCache.feedKey(location.pathname, location.search);
  // How the user arrived decides fresh vs. restore: a link click (PUSH/REPLACE) asks
  // for the page anew — top of feed, newest posts; Back/Forward/refresh/initial load
  // (POP) restore the saved snapshot (Constitution: history must restore state).
  const fresh = navigationType !== 'POP';
  const { state, load, atPageBreak, canAutoLoad } = useFeed(after, cacheKey, fresh);
  useScrollRestoration(cacheKey, fresh);
```

In `frontend/src/pages/HomePage.tsx`, key the feed by the navigation entry so clicking Home while already on `/` remounts it:

```tsx
import { useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

import Feed from '../components/Feed';
import { Pagination } from '../lib/pagination';

// The Home/landing view: heading + the newest meme feed. The `?after` page cursor in the
// URL selects which feed page to show, so the view is bookmarkable and refresh-safe (US2).
function HomePage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const after = Pagination.pageStart(searchParams.get('after'));

  useEffect(() => {
    document.title = 'online-trash';
  }, []);

  return (
    <section aria-label="Memes">
      {/* Remount the feed on every navigation (location.key changes even when the URL
          does not) so clicking Home while already on the feed still resets it; the
          feed itself decides fresh-vs-restore from the navigation type. */}
      <Feed key={location.key} after={after} />
    </section>
  );
}

export default HomePage;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/pages/HomePage.test.tsx tests/components/Feed.test.tsx tests/hooks/useFeed.test.tsx tests/hooks/useScrollRestoration.test.tsx`
Expected: PASS (all tests, all four files — the existing suites mount via `MemoryRouter` whose initial navigation is a POP, so their restore-path assertions hold).

- [ ] **Step 5: Commit**

```bash
git add src/components/Feed.tsx src/pages/HomePage.tsx tests/pages/HomePage.test.tsx
git commit -m "feat(feed): reset to a fresh top-of-feed on Home/logo link navigation"
```

---

### Task 4: Full gates + live verification

**Files:** none (verification only; fix anything that fails and amend the relevant task's commit style).

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: exit 0, no output.

- [ ] **Step 2: Full test suite with the CI coverage gate**

Run: `npx vitest run --coverage --coverage.thresholds.lines=90`
Expected: all tests PASS; lines coverage ≥ 90% (this is the exact CI invocation).

- [ ] **Step 3: Verify in the running app**

The dev stack runs via docker compose from the repo root. If the frontend container is up (`docker compose ps`), open `http://localhost` (Vite dev server port per `docker-compose.yml`):

1. Scroll the home feed down a few screens.
2. Click a post, then the browser Back button → position is restored (unchanged behavior).
3. Scroll down again, click the **Home** entry in the left menu → feed jumps to the top and reloads.
4. Scroll down again, click the **logo** → same reset.
5. Press F5 while scrolled → position is restored (unchanged behavior).

Note: after a `git` merge/checkout the Vite container may serve stale code — `docker compose restart frontend` first if the UI does not reflect the change.

- [ ] **Step 4: Push**

```bash
git push
```
