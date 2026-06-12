# Research: Trashpost Page (Single Meme View)

**Feature**: 006-trashpost-page | **Date**: 2026-06-12

The Technical Context contains no NEEDS CLARIFICATION items — the stack, API, and layout
are all inherited from features 004/005, and the spec's open questions were resolved in
its Clarifications session. This document records the design decisions that shape the
implementation, with rationale and the alternatives considered.

## D1 — Data source: extend `src/lib/api.ts` with a single-post client

**Decision**: Add `buildPostUrl(hash): string` and `fetchPost(hash): Promise<PostResult>`
to the existing `src/lib/api.ts`. `PostResult` is a discriminated union:
`{ ok: true, post: FeedPost }` or `{ ok: false, error: { kind: 'notFound' | 'http' |
'network'; status?: number } }`. A `404` maps to `notFound`; any other non-2xx maps to
`http`; a rejected `fetch` maps to `network`. The raw body (`{ data: <Post> }`) is mapped
through the existing `mapPost`.

**Rationale**: FR-007 requires not-found and transient failure to be *distinct* states —
the error taxonomy must be decided at the API boundary, where the status code is known.
`api.ts` already owns `apiBase()`, the `Accept` header convention, and the
feed-side error taxonomy (`http`/`network`); a second module would duplicate all three.

**Alternatives considered**: A separate `postApi.ts` module — rejected: it would need the
same `apiBase()` helper and error mapping, splitting one small concern across two files.
Throwing exceptions for failures — rejected: the codebase's established pattern (005) is
result unions, which keep the reducer pure and testable.

## D2 — View model: reuse `RawPost`/`mapPost`/`FeedPost` unchanged

**Decision**: The single post is rendered from the exact same view model the feed uses:
`mapPost(raw)` → `FeedPost` (`hash`, `title`, `permalink`, derived `media`). No new
mapping code; `FeedMedia` ('image' | 'youtube' | 'none') already encodes the supported
media kinds, the alt-text fallback ("Meme image", FR-012), srcset built only from
API-declared sizes (FR-004), and intrinsic dimensions from `metadata`.

**Rationale**: The 004 API returns the identical `<Post>` object from both endpoints, and
the spec's media scope ("single image or YouTube embed") deliberately matches the
mainpage's. One mapping = one place where Principle VI media rules live.

**Alternatives considered**: A dedicated `PostModel` type — rejected: it would be a field
-for-field copy today; if the post page ever needs more fields (comments, votes are out
of scope), `RawPost`/`mapPost` can grow then.

## D3 — Image `sizes` hint: the feed's hint is correct for this page too

**Decision**: Keep `MemeMedia`'s existing responsive behavior, including the
`(min-width: 48rem) 48rem, 100vw` sizes hint, for the post page.

**Rationale**: The post renders in the same `PageLayout` column with the same max width
as a feed entry, so the browser's effective image-width calculation is identical — the
viewport-appropriate size is chosen via `srcset`/`sizes` (FR-004) and only sizes the API
declared are ever requested. No size-selection logic is duplicated.

**Alternatives considered**: A page-specific sizes hint or explicit `pickImageSize(post,
width)` selection — rejected: the layouts share the column geometry, so a second hint
adds a divergence risk with no rendering difference.

## D4 — Page state machine: new pure `src/lib/postModel.ts`

**Decision**: A pure reducer over `PostPageState` with states `idle | loading | loaded |
notFound | error` and actions `loadStart | loadSuccess(post) | loadNotFound | loadError`.
`loaded` carries the `FeedPost`. The reducer is unit-tested exhaustively (every
state×action transition) in `tests/lib/postModel.test.ts`.

**Rationale**: FR-007 demands three visibly distinct non-loaded presentations, and the
edge cases (no not-found flash before the result is known; retry clears stale error;
navigating between memes never shows the previous meme) are all transition rules — pure
reducer territory, matching the 005 `pagination.ts` pattern and the coverage scope.

**Alternatives considered**: Ad-hoc `useState` flags in the page component — rejected:
boolean-flag combinations are exactly how "not-found flashes before loading finishes"
bugs happen, and component code sits outside the coverage gate.

## D5 — Document title: pure helper in `postModel.ts`

**Decision**: `formatDocumentTitle(title: string | null): string` returns
`"{title} - online-trash"` when the meme has a non-blank title and `"online-trash"`
otherwise. `PostPage` applies it when a meme loads (and on not-found/error leaves the
plain site name). `HomePage` already resets the title on mount, so Back cleans up.

**Rationale**: FR-009 with the untitled-meme edge case is a string-fallback rule —
trivially unit-testable as a pure function. The site name matches the wordmark/alt
("online-trash") already used by `PageLayout` and `HomePage`.

**Alternatives considered**: Setting `document.title` inline in the component — rejected
only as the *home* of the fallback logic (the component still performs the DOM write; the
decision of *what* to write is pure and tested).

## D6 — Scroll-to-top on open: explicit, because scroll restoration is manual

**Decision**: `PostPage` scrolls the window to the top in a `useLayoutEffect` keyed by
`hash` (before paint, on every post-page navigation including Forward and meme→meme).

**Rationale**: 005 set `history.scrollRestoration = 'manual'` globally, so the browser no
longer resets scroll on SPA navigation — coming from a scrolled feed, the post page would
otherwise open mid-scroll. The spec's clarification requires "top of the page, like a
native page load" (FR-008). Back to the feed is unaffected: the feed's own
`useScrollRestoration` re-pins its anchor when `HomePage` remounts.

**Alternatives considered**: Flipping `scrollRestoration` back to `auto` for this route —
rejected: 005's anchor-based feed restoration depends on manual mode; toggling it per
route is fragile global state. A router-level "scroll to top on every navigation"
component — rejected: it would fight the feed's Back restoration.

## D7 — Not-found view: reuse `NotFoundPage` for the 404 state

**Decision**: When the state is `notFound`, `PostPage` renders the existing
`NotFoundPage` component (heading, explanation, "Back to the feed" link) inside the
shared layout — the same view the router's `*` catch-all shows.

**Rationale**: FR-006 requires a clear not-found view with a way back home, and that
hidden/unknown/removed memes be indistinguishable; one shared component guarantees a
single indistinguishable presentation and avoids duplicate copy. A dead meme link and a
dead arbitrary URL communicating identically is coherent UX.

**Alternatives considered**: A post-specific "Meme not found" view — rejected: slightly
friendlier copy is not worth a second not-found surface to keep accessible, themed, and
consistent; it can be specialized later without contract changes.

## D8 — Loading & failure states: reuse `LoadingState` / `ErrorState`

**Decision**: Reuse the 005 state components: `LoadingState` while the fetch is in
flight, `ErrorState` (message + Retry button) for `http`/`network` failures. Retry calls
the hook's `load()` again — no full page reload (US2). `PostPage` wraps states in a
polite live region so state changes are announced, mirroring the feed's approach.

**Rationale**: Identical affordances to the feed keep the UX and a11y semantics
consistent (Principle IV) and add zero new code surface.

**Alternatives considered**: Page-specific state components — rejected: nothing differs
but context; the generic copy ("Loading…", "Something went wrong…" + Retry) fits both.

## D9 — Data loading hook: new thin `usePost(hash)`

**Decision**: A `usePost(hash)` hook owning the `postModel` reducer: on mount and
whenever `hash` changes it dispatches `loadStart`, awaits `fetchPost(hash)`, and
dispatches the matching result action; it returns `{ state, retry }`. Changing `hash`
resets state to `loading` first, so a second meme never shows the first's content (spec
edge case). A stale-response guard ignores results for a hash that is no longer current.

**Rationale**: Matches the 005 `useFeed` division of labor — IO orchestration in a thin
hook, all decisions in pure lib code. The hash-keyed reset is the natural place to
satisfy the "navigating between memes" edge case.

**Alternatives considered**: Fetching directly in the page component (the prototype's
approach) — rejected: the prototype's `useEffect(..., [])` ignores hash changes and has
no error taxonomy; it predates the constitution. Remounting via `key={hash}` instead of
an effect — viable, but an in-hook reset keeps the behavior local and testable through
the reducer rather than relying on a parent's render detail.

## D10 — No post-page session cache; refetch per visit

**Decision**: The post page does not persist its data to `sessionStorage` (unlike the
feed's snapshot). Back/Forward to a post simply refetches by hash.

**Rationale**: The feed snapshot exists to preserve *accumulated pages and scroll
position* — expensive, scroll-coupled state. A single post is one cheap request with no
scroll state (it always opens at the top, D6), and Refresh must work from the URL alone
anyway (FR-008), so the fetch path is the canonical path. Less state, fewer staleness
bugs.

**Alternatives considered**: Seeding the post page from the feed's cached entry to skip
the fetch — rejected for now: it saves one small request but adds a second data source
and a freshness question; SC-001's 2s budget is comfortably met by the single fetch.

## D11 — `hash` stays opaque client-side

**Decision**: No client-side format validation of the `hash` route param (carried over
from 005's research D10). Whatever string sits in the URL is sent to the API; any
non-matching value yields the API's 404 → the not-found view.

**Rationale**: Principle V makes the code opaque; the backend is the single authority on
validity. A client-side pre-check could only duplicate (and drift from) the server rule,
and the user-visible outcome would be identical.

**Alternatives considered**: Pre-validating against `[A-Za-z0-9-_]{10}` via the existing
`publicCode.ts` helper to skip a doomed request — rejected: saves nothing observable and
creates a second validity definition.
