# Phase 0 Research: Frontend Mainpage

Resolves the open technical choices for the Home feed. No `NEEDS CLARIFICATION` remained
after `/speckit-clarify`; the items below are the dependency/approach decisions.

## D1 — Client-side routing

- **Decision**: Use `react-router-dom` (latest v6/v7) with a `BrowserRouter`.
- **Rationale**: The constitution names React Router as the baseline stack and requires
  real shareable URLs with working Back/Forward/Refresh (Principle III). React Router
  gives history integration, route params (`/posts/:hash`), and search-param handling for
  the feed page break out of the box. Explicitly approved (Principle I).
- **Alternatives considered**: Hand-rolled History API router in `src/lib` (zero deps) —
  rejected: re-implements a solved, constitution-named baseline and adds owned/test
  surface for no benefit.

## D2 — Component / coverage testing strategy

- **Decision**: Concentrate logic in **pure `src/lib` functions** with full Vitest unit
  tests; keep components thin and outside the coverage scope (coverage stays
  `include: ['src/lib/**']`). No new test dependencies.
- **Rationale**: Matches the existing `vite.config.ts` and the scaffold's
  `publicCode.ts` pattern; satisfies Principle VII (≥90% on real logic, tests mirror
  source) and Principle I (no jsdom/testing-library). Pure functions are the most
  reliable units to cover: cursor math, image-size selection, YouTube parsing, response
  mapping.
- **Alternatives considered**: Add `jsdom` + `@testing-library/react` to test components
  directly — rejected for this feature (new deps; the logic worth testing is extractable
  to `src/lib`). Can be revisited later if component-level coverage is required.

## D3 — Infinite scroll

- **Decision**: Native `IntersectionObserver` watching a sentinel element at the end of
  the loaded list; when it intersects and more data is available, load the next batch.
- **Rationale**: Zero dependencies (Principle I); precise, performant, and easy to guard
  against duplicate in-flight requests (FR-015). The prototype's
  `react-infinite-scroll-component` is unnecessary.
- **Alternatives considered**: Scroll-position math on a scroll listener — rejected:
  jankier, more code; `react-infinite-scroll-component` — rejected as an avoidable dep.

## D4 — Pagination, the 200-entry page break, and the URL

- **Decision**: The feed is a keyset walk using the API's `start` cursor (the previous
  batch's last `hash`). Auto-load 10 at a time; after **200** entries are loaded on the
  current page, stop auto-loading and show a "Load more" control. "Load more" advances to
  the next **page**, encoded in the URL as a search param holding the cursor `hash` that
  begins that page (e.g. `/?after=<hash>`). The newest page has no param.
- **Rationale**: Satisfies Principle III (page break reflected in a bookmarkable,
  refresh-safe URL) and the feed-API contract (keyset `start`, no offset). Using the
  cursor `hash` (not a numeric page) is gap/duplicate-free and aligns with the API.
- **Edge**: A stale/unresolvable `after` cursor ⇒ the API ignores it and returns the
  newest page; the UI falls back gracefully (spec edge case "stale deep link").
- **Alternatives considered**: Numeric `?page=N` offset — rejected: the API is keyset,
  not offset; numeric pages would drift as new posts arrive.

## D5 — Restoring scroll on Back/Forward/Refresh

- **Decision**: Treat each "page" (URL with/without `after`) as the restore unit. On load
  for a given `after`, fetch that page's first batch; rely on the browser's native scroll
  restoration for Back/Forward within a page. Do not force-load all previously
  auto-scrolled batches on refresh — refresh restores the page's first batch at top,
  which is acceptable and predictable.
- **Rationale**: Keeps state in the URL (the cursor) rather than fragile in-memory
  history; meets Principle III without persisting unbounded scroll state.
- **Alternatives considered**: Persisting full loaded-batch lists in history state /
  sessionStorage — rejected: complexity and memory cost beyond requirement.

## D6 — YouTube embedding (security)

- **Decision**: Parse the post's `youtube` value with an in-house `src/lib/youtube.ts`
  that extracts a valid 11-char video id and returns a fixed-form
  `https://www.youtube-nocookie.com/embed/<id>` URL, or `null` if it doesn't parse.
  Render via a plain `<iframe>` with that URL only.
- **Rationale**: Principle VI — parse/validate, never embed raw input. No
  `react-youtube`/`react-player` dependency. `null` ⇒ graceful fallback (title only).
- **Alternatives considered**: Embedding the raw value or using a player library —
  rejected (injection risk; avoidable deps).

## D7 — Responsive images

- **Decision**: Build an `<img>` with `srcset`/`sizes` from the API's `sizes` array
  (each `{ url, width }`), `src` = `default`, plus `loading="lazy"` and `alt` from the
  post title. `src/lib/feedModel.ts#pickImageSize` centralizes selection/fallback.
- **Rationale**: Principle VIII (scaled media) + Principle VI (only existing sizes; the
  API never lists absent files). The browser picks the right width per viewport/DPR.
- **Alternatives considered**: Always loading `original` — rejected (FR-009; wastes
  bandwidth on mobile).

## D8 — Theming

- **Decision**: CSS driven by `@media (prefers-color-scheme: dark)` over CSS custom
  properties; a small `useTheme` hook only needs to ensure the document reflects the
  scheme (mostly CSS-only). No manual toggle (deferred per clarification).
- **Rationale**: Principle IV with the least machinery; updates live if the OS preference
  changes.
- **Alternatives considered**: JS-managed theme class with persistence — deferred to the
  future toggle feature.

## D9 — API base URL & CORS

- **Decision**: Read the API origin from `VITE_API_BASE_URL` (documented in
  `frontend/.env.example`); `src/lib/api.ts` builds `\`${base}/api/posts\`` requests via
  `fetch`. The API already returns absolute image URLs and an absolute `url_api`; the
  per-post `url` (`/posts/{hash}`) is a frontend-relative deep link used with the router.
- **Rationale**: Decoupled SPA needs an explicit backend origin; env keeps it out of
  code and per-environment (Principle VI secrets-in-env). Image `<img>`/`<iframe>` loads
  are not CORS-gated; only the `fetch` to `/api/posts` is — Laravel's default API CORS
  permits it (verify the SPA origin is allowed in dev).
- **Alternatives considered**: A Vite dev proxy — viable for local dev but env base URL
  is simpler and works in build/preview too; proxy can be added later if desired.

## D10 — Pre-existing inconsistency noted (out of scope)

- `frontend/src/lib/publicCode.ts` validates an **11-char `[A-Z0-9-]`** code, but the
  current constitution (v1.2.0) and the 004 feed API use a **10-char `[A-Za-z0-9-_]`**
  `hash`. The mainpage treats `hash` as an **opaque** string from the API (no client-side
  format gate), so this does not block the feature. Flagged for a separate fix; not
  changed here.
