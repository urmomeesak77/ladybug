---
description: "Task list for Frontend Mainpage (Home Feed)"
---

# Tasks: Frontend Mainpage (Home Feed)

**Input**: Design documents from `/specs/005-frontend-mainpage/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (routes.md,
feed-api-consumption.md, components.md), quickstart.md

**Tests**: INCLUDED. The plan (D2) and quickstart explicitly require TDD for the pure
`src/lib` modules — write each `tests/lib/*.test.ts` first and watch it fail before
implementing the module. Coverage is gated at ≥90% on `src/lib/**` (existing
`vite.config.ts`). React components/hooks stay thin and are outside the coverage scope, so
they have no unit-test tasks.

**Organization**: Tasks are grouped by user story (P1 → P2 → P3) so each story is
independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1, US2, US3 (Setup/Foundational/Polish carry no story label)
- All paths are relative to the repo root; new feature code lives under `frontend/`

## Path Conventions

Web app, two-app layout. Frontend code under `frontend/src/`, tests under
`frontend/tests/`. Pure logic concentrates in `frontend/src/lib/` (coverage-scoped);
components/hooks are thin glue.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the approved dependency, environment template, and base styling shell.

- [x] T001 Add `react-router-dom` to `dependencies` in `frontend/package.json` and run
      `npm install` in `frontend/` (the one approved new runtime dep — constitution
      baseline; no other runtime deps).
- [x] T002 [P] Create `frontend/.env.example` with `VITE_API_BASE_URL=http://localhost:8000`
      (API origin per research D9; `.env` itself stays uncommitted).
- [x] T003 [P] Create base global stylesheet `frontend/src/styles/theme.css` defining
      light-mode CSS custom properties (colors, spacing, layout tokens) and a CSS reset
      (`box-sizing`, no default margins); import it from `frontend/src/main.tsx`.

**Checkpoint**: Dependency installed, env template present, styling tokens available.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The router + page-layout shell every view mounts inside. No user story can
render without this.

**⚠️ CRITICAL**: Complete before starting any user story.

- [x] T004 [P] Create `frontend/src/components/NavMenu.tsx` — fixed anonymous nav with
      labeled links: Home (`/`) and Login/register (`/login`); semantic `<nav>` landmark
      (per contracts/components.md; aria-current refined in US2/US3).
- [x] T005 Create `frontend/src/components/PageLayout.tsx` — `<header>` site
      wordmark + `<NavMenu />` + `<main>` landmark rendering `{children}` (depends on T004).
- [x] T006 [P] Create `frontend/src/pages/PostPlaceholderPage.tsx` — reads `:hash` route
      param and shows a placeholder ("single-meme page coming soon") for `/posts/:hash`.
- [x] T007 [P] Create `frontend/src/pages/NotFoundPage.tsx` — accessible not-found view for
      the `*` route.
- [x] T008 Rewrite `frontend/src/App.tsx` — `BrowserRouter` with routes `/` → `HomePage`,
      `/posts/:hash` → `PostPlaceholderPage`, `*` → `NotFoundPage`, all wrapped in
      `PageLayout` (depends on T005, T006, T007; `HomePage` is stubbed until T023).
- [x] T009 Update `frontend/src/main.tsx` to render `<App />` (entry wiring; depends on T008).

**Checkpoint**: App boots, shell + nav render, routes resolve (HomePage stub for now).

---

## Phase 3: User Story 1 - Browse the endless meme feed (Priority: P1) 🎯 MVP

**Goal**: Home shows the newest memes (title + image/YouTube media), auto-appends the next
batch of 10 on scroll, and offers a "Load more" control once 200 entries are loaded.

**Independent Test**: Against a populated backend, load `/` and confirm the first 10 newest
memes render with titles and correct media; scroll to the bottom and confirm the next batch
appends newest-first with no duplicates/gaps; confirm loading/empty/end/error states are
reachable.

### Tests for User Story 1 (write first — must FAIL before implementation) ⚠️

- [x] T010 [P] [US1] `frontend/tests/lib/feedModel.test.ts` — media precedence
      (youtube→image→none), srcset assembly widest-first, non-empty `alt`, no fabricated
      URLs, null-image ⇒ `none`/title-only (data-model.md derivation rules).
- [x] T011 [P] [US1] `frontend/tests/lib/youtube.test.ts` — valid id/URL forms →
      `youtube-nocookie.com/embed/<id>`; junk/unparseable → `null` (research D6).
- [x] T012 [P] [US1] `frontend/tests/lib/api.test.ts` — `buildFeedUrl` clamps `limit` to
      `[1,50]` (default 10), omits/URL-encodes `start`; `fetchFeed` maps `data[]` via
      `mapPost` and classifies HTTP/network errors into a typed result
      (contracts/feed-api-consumption.md).
- [x] T013 [P] [US1] `frontend/tests/lib/pagination.test.ts` — `nextStart` = last item's
      `hash`; `isPageBreak` true at exactly 200; `hasMore` false on short/empty batch;
      reducer in-flight guard blocks duplicate loads (FR-015).

### Implementation for User Story 1

- [x] T014 [P] [US1] Create `frontend/src/lib/feedModel.ts` — `ImageSize`, `FeedMediaKind`,
      `FeedPost`, `FeedMedia` types + `mapPost(raw)` and `pickImageSource(post)`; make T010
      pass.
- [x] T015 [P] [US1] Create `frontend/src/lib/youtube.ts` — `toEmbedUrl(raw): string | null`;
      make T011 pass.
- [x] T016 [US1] Create `frontend/src/lib/api.ts` — `buildFeedUrl(params)` and
      `fetchFeed(params): Promise<FeedResult>` reading `VITE_API_BASE_URL`; make T012 pass
      (depends on T014).
- [x] T017 [US1] Create `frontend/src/lib/pagination.ts` — `nextStart(items)`,
      `isPageBreak(count)`, `hasMore(batch, limit)`, and the page-state reducer; make T013
      pass.
- [x] T018 [US1] Create `frontend/src/hooks/useFeed.ts` — feed state machine for the newest
      page: initial load, append-on-scroll, end/empty/error + retry, concurrent-load guard;
      delegates math to `lib/pagination`, IO to `lib/api` (depends on T016, T017).
- [x] T019 [P] [US1] Create `frontend/src/components/states/` views (`LoadingState.tsx`,
      `EmptyState.tsx`, `EndOfFeedState.tsx`, `ErrorState.tsx` with a Retry action) per
      data-model.md "Feed UI states".
- [x] T020 [P] [US1] Create `frontend/src/components/MemeMedia.tsx` — `image` ⇒
      `<img srcset/sizes/loading="lazy" alt>` with an `onError` fallback for a
      runtime-broken image (degrade to title-only, no broken element — spec edge case);
      `youtube` ⇒ `<iframe>` using only `media.embedUrl`; `none` ⇒ title-only fallback
      (depends on T014).
- [x] T021 [US1] Create `frontend/src/components/FeedItem.tsx` — renders the post title +
      `<MemeMedia />` (permalink wrapping added in US2) (depends on T020).
- [x] T022 [US1] Create `frontend/src/components/Feed.tsx` — calls `useFeed`, renders
      `FeedItem`s, an `IntersectionObserver` sentinel for auto-load, the "Load more" control
      at the 200-entry break, and the state views from T019; renders only the posts the API
      returns (FR-014) (depends on T018, T019, T021).
- [x] T023 [US1] Create `frontend/src/pages/HomePage.tsx` — sets `<h1>`/page title and mounts
      `<Feed />` (newest page only; `?after` handling added in US2); wire into `App.tsx`
      route replacing the stub (depends on T022, T008).
- [x] T024 [US1] Run `cd frontend && npm run test` — confirm T010–T013 pass and `src/lib`
      coverage stays ≥90%.

**Checkpoint**: MVP — the feed loads, scrolls, and appends against the live API.

---

## Phase 4: User Story 2 - Shareable, refresh-safe navigation (Priority: P2)

**Goal**: The current feed page is encoded in the URL (`?after=<hash>`), bookmarkable and
refresh-safe; "Load more" advances that URL; each entry is a real link to `/posts/{hash}`;
nav menu destinations work; Back/Forward restore the view.

**Independent Test**: Advance past page 1 via "Load more", copy `/?after=<hash>` into a new
tab and refresh — the same page is restored (not the newest); Back/Forward restore the
correct view; clicking an entry navigates to its `/posts/{hash}` permalink; the nav links
route to Home and Login/register.

- [ ] T025 [US2] Extend `frontend/src/lib/pagination.ts` (+ `tests/lib/pagination.test.ts`)
      so the page cursor (`after`) seeds the page's first `start` and the page-break advance
      computes the next page's `after` hash; write the new assertions first, then implement
      (keeps ≥90% coverage).
- [ ] T026 [US2] Update `frontend/src/pages/HomePage.tsx` to read the `?after` search param
      (react-router `useSearchParams`) and pass it to `useFeed`/`Feed`, restoring that page
      on load/refresh (FR-005, depends on T023, T025).
- [ ] T027 [US2] Update `frontend/src/components/Feed.tsx` so the "Load more" control is a
      router `Link`/`useNavigate` that advances the URL to `/?after=<lastHash>` at the page
      break (FR-004/FR-005, depends on T026).
- [ ] T028 [US2] Update `frontend/src/components/FeedItem.tsx` to wrap the entry in a router
      `Link` to `post.permalink` (`/posts/{hash}`) with meaningful link text (FR-007).
- [ ] T029 [US2] Update `frontend/src/components/NavMenu.tsx` — Home (`/`) and Login/register
      (`/login`) destinations with `aria-current` on the active route (FR-001, US2 scenario 4).

**Checkpoint**: URL reflects feed page; permalinks + nav + Back/Forward/Refresh all work.

---

## Phase 5: User Story 3 - Accessible, themed, responsive presentation (Priority: P3)

**Goal**: The page follows `prefers-color-scheme`, reflows cleanly mobile→desktop with no
horizontal scroll, and is operable/labeled for assistive tech.

**Independent Test**: View at ~320px / tablet / wide desktop — no horizontal scroll,
clipping, or overlap; toggle OS dark/light — appearance follows; every image has non-empty
`alt`; nav/controls reachable and labeled by keyboard; status changes announced; no
color-only signals.

### Tests for User Story 3 (write first — must FAIL before implementation) ⚠️

- [ ] T030 [P] [US3] `frontend/tests/lib/theme.test.ts` — `prefersDark()` and
      `watchScheme(cb)` over a mocked `matchMedia` (research D8).

### Implementation for User Story 3

- [ ] T031 [US3] Create `frontend/src/lib/theme.ts` — `prefersDark(): boolean` and
      `watchScheme(cb)`; make T030 pass.
- [ ] T032 [US3] Create `frontend/src/hooks/useTheme.ts` — applies `prefers-color-scheme` to
      the document and updates on change; wraps `lib/theme` (depends on T031); consume it in
      `App.tsx` or `PageLayout.tsx`.
- [ ] T033 [P] [US3] Extend `frontend/src/styles/theme.css` with a
      `@media (prefers-color-scheme: dark)` block overriding the custom properties; ensure
      color is never the sole signal (FR-011/FR-012).
- [ ] T034 [P] [US3] Add responsive layout CSS (mobile-first, fluid units + media queries)
      for header/nav/feed; images and the YouTube `<iframe>` scale within their container
      preserving aspect ratio; no horizontal scroll 320px→wide desktop (FR-010, Principle
      VIII). Also confirm `frontend/index.html` declares
      `<meta name="viewport" content="width=device-width, initial-scale=1">` (Principle VIII
      MUST) and add it if absent.
- [ ] T035 [US3] Accessibility pass across `NavMenu`, `Feed`, `FeedItem`, `MemeMedia`, and
      `states/*`: non-empty descriptive `alt` and iframe `title`, labeled links/controls,
      an `aria-live` region for loading/end/error status, sane keyboard tab order
      (FR-012/FR-013, SC-007).

**Checkpoint**: All three stories functional, themed, responsive, and accessible.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T036 [P] Add/update `frontend/README.md` with the dev run + `.env` setup (mirrors
      quickstart.md prerequisites).
- [ ] T037 Run `cd frontend && npm run lint` and resolve all findings (Principle II;
      cross-check with the lint-reviewer for naming/comment/length rules).
- [ ] T038 Run `cd frontend && npm run test` — full suite green, `src/lib` coverage ≥90%.
- [ ] T039 Execute `specs/005-frontend-mainpage/quickstart.md` manual verification steps
      1–11 against the live API and record results.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Stories (Phase 3–5)**: All depend on Foundational. US1 is the MVP; US2 builds on
  US1 components (HomePage/Feed/FeedItem); US3 is largely additive (theme + CSS + a11y) and
  can overlap US2.
- **Polish (Phase 6)**: After the desired stories are complete.

### User Story Dependencies

- **US1 (P1)**: Depends only on Foundational. Self-contained MVP.
- **US2 (P2)**: Depends on Foundational; extends US1 files (HomePage, Feed, FeedItem,
  pagination). Best done after US1.
- **US3 (P3)**: Depends on Foundational; touches CSS + a11y of US1/US2 components but is
  independently testable (theme/responsive/a11y) and can run in parallel with US2.

### Within Each User Story

- Tests (lib modules) written first and failing, then implementation.
- `lib` modules before the hook; hook before components; components before the page.
- US1 order: feedModel/youtube → api → pagination → useFeed → states/MemeMedia → FeedItem →
  Feed → HomePage.

### Parallel Opportunities

- Setup: T002, T003 in parallel (after/with T001).
- Foundational: T004, T006, T007 in parallel; then T005 → T008 → T009.
- US1 tests T010–T013 all in parallel; then T014 + T015 in parallel; T019 + T020 in parallel.
- US3: T030 first; T033 + T034 in parallel after tokens exist.
- Polish: T036 parallel with verification tasks.

---

## Parallel Example: User Story 1 tests

```bash
# Write these test files together (all fail first), then implement to green:
Task: "tests/lib/feedModel.test.ts"   # T010
Task: "tests/lib/youtube.test.ts"     # T011
Task: "tests/lib/api.test.ts"         # T012
Task: "tests/lib/pagination.test.ts"  # T013
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → **STOP and validate** the feed
loads, scrolls, and appends against the live API. Deploy/demo if ready.

### Incremental Delivery

1. Setup + Foundational → shell boots.
2. US1 → feed works (MVP).
3. US2 → shareable URLs + permalinks + Back/Forward/Refresh.
4. US3 → theme + responsive + accessibility.
Each story adds value without breaking the previous one.

---

## Notes

- [P] = different files, no incomplete-task dependencies.
- Only `react-router-dom` is added; infinite scroll (IntersectionObserver), YouTube
  (in-house parse + iframe), HTTP (fetch), and theming (CSS media query) stay dependency-free.
- Component/hook files are intentionally untested by Vitest (outside coverage scope); all
  branching logic lives in `src/lib` and is covered there.
- `hash` is treated as opaque from the API (no client-side format gate; research D10).
- Commit after each task or logical group; stop at any checkpoint to validate a story.
