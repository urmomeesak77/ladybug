# Feed Scroll Restoration — Design

**Date:** 2026-06-09
**Feature area:** `frontend/` Home feed (builds on 005-frontend-mainpage)
**Status:** Approved design, pending implementation plan

## Problem

The Home feed is an infinite-scroll list: `useFeed` starts empty and appends
10-post batches as the user scrolls. When the user scrolls down, clicks a post
link (`/posts/{hash}`), and presses Back, React Router remounts `HomePage`, so
`useFeed` resets to just the first batch. The browser's native scroll
restoration cannot help: the tall content that the user had scrolled through no
longer exists, so there is nothing to scroll back to.

**Goal:** After scrolling the feed and navigating into a post, pressing Back
(or Forward) returns the user to the same posts and the same scroll position.
A full page refresh (F5) on the feed URL restores the same way.

## Scope

- **In scope:** Restore the loaded posts, the keyset cursor, the feed status,
  and the scroll position for the Home feed on SPA Back/Forward navigation and
  on full refresh, within the same tab session.
- **Out of scope:** Cross-tab restoration; restoration that survives closing the
  tab; refreshing the feed to surface newly-arrived posts on restore; the
  single-post page's own scroll.

## Decisions

- **Restore scope:** Back/Forward **and** refresh. State persists to
  `sessionStorage` (tab-scoped). On restore the cached posts are rendered
  **as-is, without refetching**, so the newest-first feed does not shift under
  the user.
- **Restoration strategy:** **Anchor-based**, not pixel-based. Feed images use
  `loading="lazy"` with `width:100%; height:auto` and no reserved height, so an
  image post collapses to ~0px until its image loads. Saving a raw pixel offset
  would therefore land in the wrong place. Instead we save the **hash of the
  post at the top of the viewport** plus how far it is scrolled above the
  viewport top, and on restore we scroll that element back to the same offset.
  This is robust to lazy images: the anchor element's live position is whatever
  it currently is, and we scroll to place *it* correctly regardless of whether
  items above it have loaded their images yet.

### Rejected alternatives

- **Pixel offset + per-item height reservation:** save `scrollY` plus a measured
  height per item and render `<li>` placeholders with `min-height` so the
  document reflows to the same total height. Rejected: more persisted data, more
  DOM/measurement coupling, brittle when a responsive image loads a slightly
  different size.
- **Pixel offset + eager-load all + re-apply on load:** rejected as janky
  (visible settling) and slower on large lists.

## Architecture

### 1. Persistence — `src/lib/feedCache.ts` (pure, unit-tested)

Reads/writes a per-page feed snapshot to `sessionStorage`, with an injectable
storage object so it is testable and stays within the `src/lib/**` coverage
scope.

```ts
type FeedSnapshot = {
  posts: FeedPost[];
  cursor?: string;            // keyset cursor for the next batch
  status: FeedStatus;         // so a finished ('end') feed is not refetched
  anchorHash: string | null;  // post at top of viewport when we left
  anchorOffset: number;       // px the anchor is scrolled above the viewport top
};

feedKey(pathname: string, search: string): string  // "/" or "/?after=xyz"
readSnapshot(storage: Storage, key: string): FeedSnapshot | null
writeSnapshot(storage: Storage, key: string, snap: FeedSnapshot): void
clearSnapshot(storage: Storage, key: string): void
```

Keyed by feed URL, so the newest page and each `?after=` page break each get
their own snapshot. `readSnapshot` returns `null` for a missing key or
unparseable JSON (corrupt entry degrades to a fresh feed, never throws).

### 2. Hydration — `useFeed`

`useFeed(after)` initializes its reducer from `readSnapshot(feedKey)` when a
snapshot exists for the current feed URL, instead of `initialFeedState`. The
cursor ref seeds from `snapshot.cursor`. The initial auto-load `useEffect` is
skipped when posts were hydrated (they already exist). On every `loadSuccess`
the snapshot is rewritten so it stays current as more batches load.

### 3. Anchor capture + restore — `useScrollRestoration` hook (thin)

- **Capture:** a throttled `scroll` listener computes the topmost feed `<li>`
  intersecting the viewport top and writes `{ anchorHash, anchorOffset }` into
  the snapshot. Also flushed on `pagehide` (covers refresh and tab close).
- **Restore:** on mount, if the snapshot has an `anchorHash`, a `useLayoutEffect`
  finds the `[data-hash="…"]` element and calls
  `window.scrollTo(0, el.offsetTop - anchorOffset)`. `history.scrollRestoration`
  is set to `'manual'` so the browser's own guess does not fight the restore.
  The restore is re-applied once after the anchor's image `load` event in case
  the image changed the element height.
- The anchor-selection math (given a list of `{ hash, top, bottom }` rects and
  the scroll position, pick the top anchor and offset) is extracted as a pure
  helper in `src/lib` and unit-tested.

### 4. `FeedItem`

Each item's `<li>` (or the `FeedItem` root) gains a `data-hash` attribute so the
anchor element is findable on restore. No other changes.

### 5. Lifecycle / invalidation

- Snapshots live in `sessionStorage`: tab-scoped, gone when the tab closes.
- While in the `error` state nothing is persisted (the retry path keeps current
  behavior).
- No expiry logic (YAGNI): within a tab session, restoring the exact posts you
  had — even after refresh — is the desired behavior.

## Testing

- **Vitest unit tests** (mirrored under `frontend/tests/lib/`):
  - `feedCache`: read/write round-trip, `feedKey` derivation, missing key and
    corrupt-JSON both return `null`, `clearSnapshot`.
  - anchor-selection pure helper: picks the correct top anchor and offset for
    representative scroll positions and rect lists, including empty list and
    scroll-at-top edge cases.
- **Playwright e2e** (existing home-feed spec): add a case — scroll the feed,
  open a post, press Back, assert the scroll position (and post set) is restored.

## Constitution alignment

- **Principle I (minimal deps):** no new dependencies — `sessionStorage`,
  `IntersectionObserver`/`scroll`, and `history.scrollRestoration` are native.
- **Principle III (browser-native navigation):** strengthens Back/Forward/Refresh
  state restoration, which the principle requires.
- **Principle VII (coverage):** testable logic stays in pure `src/lib` modules
  with ≥90% coverage; components/hooks remain thin glue outside the scope.
