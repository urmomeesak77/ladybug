# Implementation Plan: Frontend Mainpage (Home Feed)

**Branch**: `005-frontend-mainpage` | **Date**: 2026-06-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-frontend-mainpage/spec.md`

## Summary

Build the home/landing view of the site: a centered site wordmark header, a fixed
anonymous navigation menu ("Home", "Login/register"), and an endless, newest-first feed
of memes consuming the existing read-side feed API (`GET /api/posts`, feature 004). Each
entry shows its title and media (a responsive image **or** an embedded YouTube player),
and links to its `/posts/{hash}` permalink. The feed loads 10 at a time via infinite
scroll and, after 200 entries on a page, offers an explicit "Load more" page break whose
position is reflected in the URL so it is bookmarkable and refresh-safe. Theme follows
`prefers-color-scheme`; layout is responsive mobile→desktop and accessible.

Technical approach: keep all testable logic as **pure functions in `frontend/src/lib`**
(API response mapping, keyset-cursor/pagination state, image-size selection, YouTube URL
parsing) with full Vitest unit tests, and keep React components thin presentational glue
(matching the existing `vite.config.ts` coverage scope of `src/lib/**`). Routing uses
`react-router-dom` (constitution baseline). Infinite scroll uses the native
`IntersectionObserver`; YouTube uses a plain sanitized `<iframe>` built from an in-house
parser — **no** `react-infinite-scroll-component`, `react-player`, or `react-youtube`.

## Technical Context

**Language/Version**: TypeScript ~6.0 (strict), React 18.3, built with Vite 8.

**Primary Dependencies**: React 18 + ReactDOM (present); **`react-router-dom`** (NEW
runtime dep — constitution-baseline router, approved). No other new runtime deps:
infinite scroll via native `IntersectionObserver`, YouTube via in-house URL parse +
`<iframe>`, HTTP via native `fetch`, theming via CSS `prefers-color-scheme` media query.

**Storage**: N/A on the frontend. Data comes from the backend feed API; images/YouTube
load from absolute URLs the API already returns.

**Testing**: Vitest (present). Pure logic in `src/lib` is unit-tested; coverage stays
scoped to `src/lib/**` at ≥90% (existing `vite.config.ts`). No new test dependencies
(jsdom / testing-library) — components stay thin and outside the coverage scope.

**Target Platform**: Modern evergreen browsers, mobile through desktop (≈320px → wide
desktop). SPA served by Vite/static host, talking to the Laravel API over JSON.

**Project Type**: Web application — `frontend/` React SPA against the `backend/` Laravel
API (decoupled, per the repo's two-app layout).

**Performance Goals**: First feed batch (titles + media) visible within ~2s on broadband
(SC-001); no duplicate batch requests under rapid scroll (FR-015); scroll stays smooth
while appending batches.

**Constraints**: Minimal dependencies (Principle I); real shareable URLs + Back/Forward/
Refresh (Principle III); `prefers-color-scheme` theming (Principle IV); opaque `hash`
identifiers in URLs (Principle V); validate/parse YouTube links, escape output, never
build URLs to absent media (Principle VI); responsive, no horizontal scroll (Principle
VIII); ≥90% coverage on tested logic (Principle VII).

**Scale/Scope**: One page (Home feed) plus shared layout (header + nav). ~4–6 thin
components, ~4–5 pure `src/lib` modules, one feed page route + a placeholder
`/posts/{hash}` route. Feed batch size 10; page break at 200 entries.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|-----------|------|--------|
| I. Minimal Dependencies | New deps need approval + rationale | **PASS** — only `react-router-dom` (constitution-named baseline, explicitly approved). Infinite scroll, YouTube embed, HTTP, theming all in-house/native. No test-tooling deps. |
| II. Coding Conventions | 2-space, semicolons, camelCase/PascalCase, `is/has/should` booleans, JS fns <50 lines, comments explain *why* | **PASS** (planned) — enforced by ESLint + the lint-reviewer; thin functions, pure `src/lib` helpers. |
| III. Browser-Native Navigation | Real URLs, Back/Forward/Refresh restore, paginated feed in URL, per-meme URL | **PASS** — `react-router-dom`; feed page-break cursor encoded in the URL; entries link to `/posts/{hash}`. |
| IV. Theme & Accessibility | `prefers-color-scheme`; color not sole signal; alt/labels/aria | **PASS** — CSS media-query theming; alt text on images; labeled nav/links; semantic landmarks. |
| V. Stable Meme Identifiers | 10-char `[A-Za-z0-9-_]` `hash` in URLs, not DB id | **PASS** — `hash` from the API used opaquely in `/posts/{hash}`; no DB id in URLs. |
| VI. Security & Input Validation | Parse YouTube (don't embed blindly); escape output; never URL to absent media | **PASS** — in-house YouTube parser yields only a known-good embed URL; React escapes by default; image URLs come only from the API's existing-only `sizes`/`default`. |
| VII. Test Coverage & Organization | ≥90%; tests mirror source under `tests/` | **PASS** — pure `src/lib` logic fully unit-tested under `frontend/tests/lib/**`, mirroring source; coverage gate ≥90% on `src/lib`. |
| VIII. Responsive Layout | Mobile→desktop, no horizontal scroll, fluid units, scaled media | **PASS** — mobile-first CSS, fluid units + media queries, images/iframes scale within container preserving aspect ratio. |

**Initial gate: PASS.** Single approved dependency (`react-router-dom`); no violations to
record in Complexity Tracking.

**Post-Phase-1 re-check: PASS** — the design (pure-lib logic + thin components, native
IntersectionObserver, iframe YouTube, URL-encoded cursor) introduces no further
dependencies and upholds every gate above.

## Project Structure

### Documentation (this feature)

```text
specs/005-frontend-mainpage/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (frontend view model + API mapping)
├── quickstart.md        # Phase 1 output (run + validation guide)
├── contracts/           # Phase 1 output (routes, API consumption, component/lib contracts)
│   ├── routes.md
│   ├── feed-api-consumption.md
│   └── components.md
├── checklists/
│   └── requirements.md  # spec quality checklist (already present)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
frontend/
├── src/
│   ├── lib/                       # PURE, fully unit-tested logic (coverage-scoped)
│   │   ├── publicCode.ts          # (exists) opaque-code validation helper
│   │   ├── api.ts                 # buildFeedUrl(limit,start), fetchFeed -> typed result
│   │   ├── feedModel.ts           # Post type, mapPost(raw), pickImageSize(post,width)
│   │   ├── pagination.ts          # cursor/page-break state: nextCursor, 200-entry break
│   │   ├── youtube.ts             # parse a YouTube ref -> safe embed URL (or null)
│   │   └── theme.ts               # prefers-color-scheme detection helper (pure)
│   ├── components/                # THIN presentational/glue (outside coverage scope)
│   │   ├── PageLayout.tsx         # header (wordmark) + nav menu + <main> outlet
│   │   ├── NavMenu.tsx            # fixed anonymous menu: Home, Login/register
│   │   ├── Feed.tsx               # list + IntersectionObserver + Load-more page break
│   │   ├── FeedItem.tsx           # one meme: title + media (image | youtube) + permalink
│   │   ├── MemeMedia.tsx          # picks responsive <img> (srcset) or <iframe>
│   │   └── states/                # Loading / Empty / EndOfFeed / Error(retry) views
│   ├── pages/
│   │   ├── HomePage.tsx           # mounts Feed; reads/writes feed-page URL param
│   │   └── PostPlaceholderPage.tsx# /posts/{hash} placeholder until the real page ships
│   ├── hooks/
│   │   ├── useFeed.ts             # data-loading state machine over src/lib/api+pagination
│   │   └── useTheme.ts            # applies prefers-color-scheme (wraps src/lib/theme)
│   ├── App.tsx                    # Router + routes (replaces placeholder shell)
│   └── main.tsx                   # entry (unchanged)
├── tests/
│   └── lib/                       # mirrors src/lib (Principle VII)
│       ├── publicCode.test.ts     # (exists)
│       ├── api.test.ts
│       ├── feedModel.test.ts
│       ├── pagination.test.ts
│       ├── youtube.test.ts
│       └── theme.test.ts
├── .env.example                   # VITE_API_BASE_URL=… (NEW)
├── vite.config.ts                 # coverage include stays src/lib/** (may add new lib globs)
└── package.json                   # + react-router-dom
```

**Structure Decision**: Web-app two-app layout. All new feature code lands under
`frontend/`. Testable logic concentrates in `frontend/src/lib` (pure, coverage-gated,
tests mirror source under `frontend/tests/lib`); React components and hooks are thin glue
that compose those helpers, consistent with the existing scaffold's coverage scoping.

## Complexity Tracking

> No constitution violations — table intentionally empty.
