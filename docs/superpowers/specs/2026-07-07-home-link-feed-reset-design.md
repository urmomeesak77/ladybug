# Home Link / Logo Feed Reset — Design

**Date:** 2026-07-07
**Status:** Approved
**Scope:** Frontend only (`frontend/src`)

## Problem

Clicking the Home entry in the left menu or the site logo while browsing the feed
appears to do nothing. The feed's loaded posts and scroll anchor are cached in
`sessionStorage` (`FeedCache`, keyed by feed URL), and `useFeed` +
`useScrollRestoration` restore that snapshot on every mount. Navigating to `/`
therefore re-renders the same posts pinned to the same scroll position — and when
the user is already on `/`, the `Feed` component does not even remount.

## Desired behavior

Clicking any link to the home feed (left-menu Home, logo, or any future link)
resets the view to the initial state — top of the page, newest posts refetched
from the API — exactly as if the user had just entered the site.

Back/Forward and Refresh keep restoring the previous posts and scroll position
(Constitution: Back/Forward/Refresh must restore state).

## Decision rule

**How the user arrived decides fresh vs. restore.** React Router's navigation
type distinguishes the two:

- `PUSH` / `REPLACE` (a link click) → fresh feed: skip the snapshot, clear it,
  fetch page 1, scroll to top.
- `POP` (Back/Forward, refresh, initial load) → restore the snapshot as today.

## Changes

- **`HomePage`** — render `<Feed key={location.key} …/>` so a link navigation to
  `/` while already on `/` remounts the feed (each navigation gets a new
  `location.key`).
- **`Feed`** — read `useNavigationType()`; derive `fresh = navigationType !== 'POP'`
  and pass it to `useFeed` and `useScrollRestoration`.
- **`useFeed`** — when `fresh`: skip snapshot hydration and clear the stored
  snapshot on mount, then fetch the first batch from the API as normal. Clearing
  on mount means the previous page's unmount anchor-capture cannot resurrect the
  old snapshot (`FeedCache.updateSnapshot` no-ops when no snapshot exists).
- **`useScrollRestoration`** — when `fresh`: ignore the saved anchor and take the
  existing `'top'` path (`window.scrollTo(0, 0)`).

Unchanged: `POP` navigations restore posts + scroll from the snapshot. "Load
more" page-break URLs (`/?after=…`) are `PUSH` navigations, so they now also
load fresh; previously a revisited page-break URL with a leftover snapshot from
earlier in the session would restore it. That delta is intended — the decision
rule applies uniformly. Likewise, `REPLACE` redirects to `/` (e.g. post-login)
reset the feed.

## Accepted consequence

Clicking Home writes a new snapshot for `/`, so pressing Back from a later page
returns to the fresh feed's state, not the pre-click one — the same as after a
refresh. Inherent to caching by URL rather than by history entry.

## Testing

Extend the existing Vitest suites for `Feed`, `useFeed`, and
`useScrollRestoration` with the PUSH-vs-POP cases (fresh load on PUSH, snapshot
restore on POP, remount via `location.key`), using the router test helpers those
suites already have. Coverage stays ≥90% (CI gate).
