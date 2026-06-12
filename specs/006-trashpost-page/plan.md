# Implementation Plan: Trashpost Page (Single Meme View)

**Branch**: `006-trashpost-page` | **Date**: 2026-06-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-trashpost-page/spec.md`

## Summary

Build the single-meme page at the existing `/posts/{hash}` permalink, replacing the
placeholder that feature 005 left there. The page fetches one post from the existing
single-post read API (`GET /api/posts/{hash}`, feature 004) and renders its title and
media (responsive image **or** embedded YouTube player) inside the same site layout
(header, anonymous nav menu) as the mainpage. It presents distinct loading, not-found,
and failure-with-retry states, sets a meme-identifying document title, starts scrolled
to the top, and preserves the feed's Back/Forward scroll restoration delivered by 005.

Technical approach: maximal reuse of the 005 codebase. The post is rendered through the
**same view model** (`mapPost` → `FeedPost`) and the **same media component**
(`MemeMedia`), inside the same `PageLayout`. New code is small and follows the
established split: pure, fully unit-tested logic in `frontend/src/lib` (a
`fetchPost`/`buildPostUrl` API extension distinguishing 404 from transient failures, and
a `postModel.ts` page-state reducer + document-title helper), composed by a thin
`usePost` hook and a thin `PostPage` component. **No new dependencies** — runtime or
test — are introduced.

## Technical Context

**Language/Version**: TypeScript ~6.0 (strict), React 18.3, built with Vite 8.

**Primary Dependencies**: React 18 + ReactDOM and `react-router-dom` — all already
present (005). **No new runtime or dev dependencies**: HTTP via native `fetch`, YouTube
via the existing in-house parser + `<iframe>`, theming via the existing
`prefers-color-scheme` CSS.

**Storage**: N/A on the frontend. Data comes from `GET /api/posts/{hash}` (feature 004);
image/YouTube URLs are absolute URLs the API already returns.

**Testing**: Vitest (present). New pure logic in `src/lib` (post API client, post-page
state reducer, title helper) is unit-tested under `frontend/tests/lib/**`, mirroring
source; coverage stays scoped to `src/lib/**` at ≥90% (existing `vite.config.ts`).
Components/hooks remain thin glue outside the coverage scope, verified manually per the
constitution's manual-verification gate.

**Target Platform**: Modern evergreen browsers, mobile through desktop (≈320px → wide
desktop). SPA served by Vite, talking to the Laravel API over JSON.

**Project Type**: Web application — `frontend/` React SPA against the `backend/` Laravel
API (decoupled two-app layout). This feature touches only `frontend/`.

**Performance Goals**: A meme permalink opened in a fresh tab renders title + media
within ~2s on broadband (SC-001). Navigating feed → post → Back stays instant (post data
is one small JSON fetch; the feed restores from its 005 session snapshot).

**Constraints**: Minimal dependencies (Principle I); real shareable URL with native
Back/Forward/Refresh and scroll-to-top on open (Principle III, FR-008);
`prefers-color-scheme` theming and non-empty alt text (Principle IV, FR-011/FR-012);
opaque 10-char `hash` in the URL, treated as opaque client-side (Principle V); only
API-provided media URLs, parsed YouTube embeds, hidden posts indistinguishable from
unknown (Principle VI, FR-004/FR-006); ≥90% coverage on tested logic (Principle VII);
responsive 320px→desktop with media scaling in-container (Principle VIII, FR-010).

**Scale/Scope**: One page. ~1 new lib module + a small extension to `src/lib/api.ts`,
1 new hook, 1 new page component (placeholder page deleted), a few CSS rules, ~2 new
test files. No backend changes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|-----------|------|--------|
| I. Minimal Dependencies | New deps need approval + rationale | **PASS** — zero new dependencies; everything reuses the 005 stack (router, fetch, in-house YouTube parser). |
| II. Coding Conventions | 2-space, semicolons, camelCase/PascalCase, `is/has/should` booleans, JS fns <50 lines, comments explain *why* | **PASS** (planned) — same patterns as the existing `src/lib` + thin-component code; ESLint + lint-reviewer enforce. |
| III. Browser-Native Navigation | Real URLs, Back/Forward/Refresh restore view + scroll, per-meme URL | **PASS** — `/posts/{hash}` is a real route; Refresh re-fetches by hash from the URL alone; Back restores the feed snapshot + anchor (005); the post page explicitly scrolls to top on open (required because `history.scrollRestoration` is `manual`). |
| IV. Theme & Accessibility | `prefers-color-scheme`; color not sole signal; alt/labels/aria | **PASS** — existing CSS theming applies via shared layout; image alt = title with non-empty generic fallback (FR-012); states are text + controls, not color; landmarks come from `PageLayout`. |
| V. Stable Meme Identifiers | 10-char `[A-Za-z0-9-_]` `hash` in URLs, not DB id | **PASS** — the route consumes the opaque `hash`; no client-side format gate (API is the authority); DB `id` never used. |
| VI. Security & Input Validation | Parse YouTube; escape output; never URL to absent media; no hidden-content leaks | **PASS** — reuses the in-house YouTube parser → known-good embed URL only; React escapes output; image URLs only from the API's existing-only `sizes`/`default`; 404 for hidden/unknown renders one identical not-found view. |
| VII. Test Coverage & Organization | ≥90%; tests mirror source under `tests/` | **PASS** — new pure logic lands in `src/lib` and is fully unit-tested in `frontend/tests/lib/**` (mirrored paths); existing ≥90% threshold on `src/lib/**` stays enforced. |
| VIII. Responsive Layout | Mobile→desktop, no horizontal scroll, fluid units, scaled media | **PASS** — same fluid column + `MemeMedia` scaling (img `srcset`/`sizes`, aspect-ratio video box) as the feed; verified at 320px→desktop per the manual gate. |

**Initial gate: PASS.** No new dependencies; no violations to record in Complexity
Tracking.

**Post-Phase-1 re-check: PASS** — the design (reused view model/media component, one new
pure lib module + API extension, thin hook/page) introduces no dependencies and upholds
every gate above.

## Project Structure

### Documentation (this feature)

```text
specs/006-trashpost-page/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (post view model + page-state machine)
├── quickstart.md        # Phase 1 output (run + validation guide)
├── contracts/           # Phase 1 output
│   ├── routes.md                  # /posts/{hash} route behavior contract
│   ├── post-api-consumption.md    # how the page consumes GET /api/posts/{hash}
│   └── components.md              # lib/hook/component contracts
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
frontend/
├── src/
│   ├── lib/                       # PURE, fully unit-tested logic (coverage-scoped)
│   │   ├── api.ts                 # EXTEND: buildPostUrl(hash), fetchPost(hash) → PostResult
│   │   │                          #   (404 → notFound; other HTTP/network → retryable error)
│   │   ├── postModel.ts           # NEW: post-page state machine (idle/loading/loaded/
│   │   │                          #   notFound/error) + formatDocumentTitle(title)
│   │   ├── feedModel.ts           # REUSED as-is: RawPost, mapPost, FeedPost, media derivation
│   │   └── youtube.ts             # REUSED as-is: safe embed URL
│   ├── hooks/
│   │   └── usePost.ts             # NEW: thin glue — fetch keyed by hash, retry, state
│   ├── components/
│   │   ├── PageLayout.tsx         # REUSED: header + nav + <main>
│   │   ├── MemeMedia.tsx          # REUSED: display-only <img> (srcset) | sanitized <iframe>
│   │   └── states/                # REUSED: LoadingState, ErrorState(retry)
│   ├── pages/
│   │   ├── PostPage.tsx           # NEW: title + MemeMedia + loading/notFound/error states,
│   │   │                          #   document title, scroll-to-top on open
│   │   ├── PostPlaceholderPage.tsx# DELETED (replaced by PostPage)
│   │   └── NotFoundPage.tsx       # REUSED: rendered by PostPage for the 404 state
│   ├── styles/theme.css           # EXTEND: post-page rules (reuse feed-item/meme-media classes)
│   └── App.tsx                    # EDIT: /posts/:hash → PostPage
└── tests/
    └── lib/                       # mirrors src/lib (Principle VII)
        ├── api.test.ts            # EXTEND: buildPostUrl/fetchPost (200/404/5xx/network)
        └── postModel.test.ts      # NEW: reducer transitions + title fallback
```

**Structure Decision**: All changes land in the existing `frontend/` app, following the
005 split: pure coverage-gated logic in `frontend/src/lib` (tests mirrored under
`frontend/tests/lib`), thin presentational glue in components/hooks/pages. No backend
changes; the 004 API is consumed as-is.

## Complexity Tracking

> No constitution violations — table intentionally empty.
