# Tasks: Trashpost Page (Single Meme View)

**Input**: Design documents from `/specs/006-trashpost-page/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — the plan mandates unit tests for all new pure `src/lib` logic
(Constitution Principle VII, ≥90% coverage on `src/lib/**`). Tests are written FIRST
and must fail before the implementation lands. Hooks/components are thin glue outside
the coverage scope, verified manually per the constitution's manual-verification gate
(quickstart.md scenarios).

**Organization**: Tasks are grouped by user story. The pure lib layer (API client
extension + page state machine) encodes behavior for US1 *and* US2 in one discriminated
union and one reducer, so it lands in the Foundational phase; each story phase then
wires and validates its slice of that behavior.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- All paths are relative to the repository root; this feature touches only `frontend/`

## Path Conventions

Web app, decoupled two-app layout. All changes land in `frontend/`:
source in `frontend/src/`, mirrored tests in `frontend/tests/` (Principle VII).
No backend changes — the feature-004 API is consumed as-is.

Run tests/lint through Docker (no local Node toolchain assumed):
`docker compose exec frontend npm test -- --coverage` and
`docker compose exec frontend npm run lint`.

---

## Phase 1: Setup

**Purpose**: Confirm a green baseline before changing anything — the existing 005
suites and lint must pass so new failures are attributable to this feature.

- [x] T001 Start the stack (`docker compose up -d`) and confirm the baseline is green: `docker compose exec frontend npm test -- --coverage` passes with `src/lib/**` coverage ≥90%, and `docker compose exec frontend npm run lint` is clean (no file changes; see specs/006-trashpost-page/quickstart.md)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The pure, coverage-gated lib layer every story builds on — the single-post
API client (`fetchPost` with the 404/http/network taxonomy) and the post-page state
machine (`postPageReducer` + `formatDocumentTitle`). Written test-first.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T002 [P] Extend frontend/tests/lib/api.test.ts with failing tests for `buildPostUrl(hash)` (base URL from `apiBase()`, path-encoding of the raw hash) and `fetchPost(hash)`: 200 `{ data: <Post> }` maps through `mapPost` to `{ ok: true, post }`; 404 → `{ ok: false, error: { kind: 'notFound', status: 404 } }`; other non-2xx → `{ kind: 'http', status }`; fetch rejection → `{ kind: 'network' }`; malformed/unparseable body handled (per specs/006-trashpost-page/contracts/post-api-consumption.md)
- [x] T003 [P] Create frontend/tests/lib/postModel.test.ts with failing tests covering every state×action transition in the data-model table (idle/loading/loaded/notFound/error × loadStart/loadSuccess/loadNotFound/loadError), the invariants (notFound reachable only from a completed response; loadStart from error clears stale error; loadStart from loaded drops the previous post), and `formatDocumentTitle` (non-blank title → `"{title} - online-trash"`; null/empty/blank-only → `"online-trash"`) per specs/006-trashpost-page/data-model.md
- [x] T004 [P] Extend frontend/src/lib/api.ts with `buildPostUrl(hash: string): string`, `PostError`/`PostResult` types, and `fetchPost(hash: string): Promise<PostResult>` per specs/006-trashpost-page/contracts/components.md — reuse the existing `apiBase()` and `Accept: application/json` convention; map success bodies through the existing `feedModel.mapPost`; leave all existing feed exports untouched
- [x] T005 [P] Create frontend/src/lib/postModel.ts with `PostPageState`, `PostPageAction`, `initialPostPageState` (`{ status: 'idle' }`), the pure `postPageReducer(state, action)` implementing the data-model transition table, and `formatDocumentTitle(title: string | null): string`
- [x] T006 Run `docker compose exec frontend npm test -- --coverage` — the T002/T003 suites now pass and `src/lib/**` coverage stays ≥90%

**Checkpoint**: Pure logic complete and fully tested — user story wiring can begin.

---

## Phase 3: User Story 1 - View a single meme via its permalink (Priority: P1) 🎯 MVP

**Goal**: A meme's permalink (`/posts/{hash}`) renders that meme — title + media
(responsive image or embedded YouTube player) — inside the standard site layout,
replacing the 005 placeholder.

**Independent Test**: Against the populated backend, open a known image post's and a
known YouTube post's permalinks directly in fresh tabs and confirm title and media
render correctly inside the header/menu layout; click a feed entry and land on the
correct meme (quickstart US1).

### Implementation for User Story 1

- [x] T007 [US1] Create frontend/src/hooks/usePost.ts: thin hook owning the `postModel` reducer — on mount and on every `hash` change dispatch `loadStart` then await `fetchPost(hash)` and dispatch the matching result action; guard against stale responses (ignore results for a hash that is no longer current); return `{ state, retry }` where `retry()` re-runs the fetch for the current hash (per specs/006-trashpost-page/contracts/components.md)
- [x] T008 [US1] Create frontend/src/pages/PostPage.tsx: read `:hash` via `useParams`, call `usePost(hash)`, and for the `loaded` state render the heading (post title, or "Untitled meme" fallback) plus `MemeMedia` (display-only image / sanitized YouTube iframe) inside the shared `PageLayout`; render nothing fancy for other states yet (placeholder branches — completed in US2)
- [x] T009 [US1] Edit frontend/src/App.tsx: point `<Route path="/posts/:hash">` at `PostPage`, and delete frontend/src/pages/PostPlaceholderPage.tsx (all other routes unchanged per specs/006-trashpost-page/contracts/routes.md)
- [x] T010 [P] [US1] Extend frontend/src/styles/theme.css with the post-page rules, reusing the existing feed-item/meme-media classes and the same fluid column geometry (no horizontal scroll 320px→desktop; media scales in-container preserving aspect ratio)
- [x] T011 [US1] Manual validation per quickstart US1: open `/posts/{imageHash}` and `/posts/{youtubeHash}` in fresh tabs (title + media render in layout; image scales, keeps aspect ratio, is NOT clickable; YouTube embed plays), and click a home-feed entry to land on the same meme — no placeholder, no not-found. Also exercise the FR-013 media fallback: block the post's image request via DevTools (request blocking) and reload — the title still renders with a graceful fallback in place of the media, never a broken image element

**Checkpoint**: Permalinks render real memes — the feature's MVP is demonstrable.

---

## Phase 4: User Story 2 - Not-found and failure handling (Priority: P2)

**Goal**: Dead/mistyped links show a clear not-found view with a way back to the feed;
transient failures show a distinct error state with a working in-place Retry; loading
shows an indication and the not-found view never flashes prematurely.

**Independent Test**: Open `/posts/AAAAAAAAAA` → not-found view with a working home
link; stop the backend and open a valid hash → error state with Retry, distinct from
not-found; restart the backend and Retry → meme loads in place with no stale error
text (quickstart US2).

### Implementation for User Story 2

- [x] T012 [US2] Complete the state branches in frontend/src/pages/PostPage.tsx: `idle`/`loading` → existing `LoadingState`; `notFound` → existing `NotFoundPage` content (heading, explanation, "Back to the feed" link) inside the layout; `error` → existing `ErrorState` with `onRetry={retry}` (in-place refetch, no full reload); wrap the swappable region in a polite live region mirroring the feed's pattern (FR-006, FR-007, Principle IV)
- [x] T013 [US2] Manual validation per quickstart US2: unknown code shows the not-found view with a working home link (no blank page/raw error); with the backend stopped, a valid hash shows the error+Retry state distinct from not-found; after `docker compose start backend`, Retry loads the meme in place with no stale error text; with DevTools throttling, the loading indication shows and not-found never flashes first

**Checkpoint**: All three non-loaded states are reachable, distinct, and graceful.

---

## Phase 5: User Story 3 - Browser-native navigation between feed and meme (Priority: P2)

**Goal**: Back/Forward/Refresh behave natively: the meme page opens scrolled to the
top, Back restores the feed's scroll position (005 contract intact), Forward restores
the meme, Refresh re-renders from the URL alone, and the tab title identifies the meme.

**Independent Test**: From a scrolled feed, open a meme (page starts at top), press
Back (feed returns at the prior scroll position), press Forward (meme returns),
refresh (same meme re-renders); tab title reads `{title} - online-trash` (quickstart US3).

### Implementation for User Story 3

- [x] T014 [US3] Add to frontend/src/pages/PostPage.tsx a `useLayoutEffect` keyed by `hash` that calls `window.scrollTo(0, 0)` before paint — required because 005 set `history.scrollRestoration = 'manual'` globally, so the post page would otherwise inherit the feed's scroll offset (FR-008, research D6); applies on every post-page open including Forward and meme→meme
- [x] T015 [US3] Add document-title handling to frontend/src/pages/PostPage.tsx: when a meme loads, set `document.title` via `formatDocumentTitle(post.title)`; on loading/not-found/error leave the plain site name (`HomePage` already resets the title on Back — research D5, FR-009)
- [x] T016 [US3] Manual validation per quickstart US3: scroll the feed several batches → open a meme (starts at top) → Back (feed at prior scroll position) → Forward (meme page returns) → Refresh (same meme from the URL alone); tab title is `{meme title} - online-trash` (untitled → `online-trash`); "Home" in the menu navigates to the feed; Back/Forward between two memes never shows the previous meme's content for the new hash

**Checkpoint**: Navigation is fully browser-native; the 005 feed contract is untouched.

---

## Phase 6: User Story 4 - Accessible, themed, responsive presentation (Priority: P3)

**Goal**: The page reflows fluidly 320px→desktop with no horizontal scroll, follows
`prefers-color-scheme`, and is operable by keyboard/AT with non-empty descriptive alt
text everywhere.

**Independent Test**: View a meme page at ~320px, ~768px, and wide desktop with no
horizontal scrolling/clipping/overlap; toggle OS light/dark and confirm the theme
follows; verify alt text and keyboard reachability of all controls (quickstart US4).

### Implementation for User Story 4

- [x] T017 [US4] Review and adjust frontend/src/styles/theme.css for the post page at ~320px, ~768px, and wide desktop: no horizontal scrolling, clipping, or overlap; image and YouTube embed scale within the column preserving aspect ratio; both light and dark `prefers-color-scheme` palettes render correctly, including toggling the OS (or DevTools emulated) preference while the page is open — the theme updates live without reload (FR-010, FR-011, SC-006)
- [x] T018 [US4] Manual a11y validation per quickstart US4: the meme image has non-empty `alt` (title, or "Meme image" when untitled); keyboard traversal reaches the nav links, the Retry button, and the not-found home link, all labeled; at ~320px (device-emulation/touch) the same controls have adequate target size and spacing and are operable by tap; loading/error/not-found states are conveyed by text, never color alone (FR-012, SC-007, Principle VIII)

**Checkpoint**: All four user stories are functional, validated, and constitutional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final gates — full automated suite, conventions, and the end-to-end
quickstart pass.

- [x] T019 Run the full automated gate: `docker compose exec frontend npm test -- --coverage` (all suites incl. extended api.test.ts and new postModel.test.ts pass; `src/lib/**` ≥90%) and `docker compose exec frontend npm run lint` (clean)
- [x] T020 Run the lint-reviewer conventions check over the changed frontend files against docs/CODING_CONVENTIONS.md (2-space, semicolons, `is/has/should` booleans, functions <50 lines, comments explain *why*) and fix any findings
- [x] T021 Full quickstart pass: execute every scenario in specs/006-trashpost-page/quickstart.md end-to-end and spot-check the success criteria (SC-001 ≤2s render, SC-002/004 dead codes and feed-entry targeting, SC-003 navigation sequences, SC-008 distinct states with clean retry)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **BLOCKS all user stories.**
  Within it: T002/T003 (tests, parallel) → T004/T005 (implementation, parallel) → T006 (gate).
- **US1 (Phase 3)**: Depends on Foundational. T007 → T008 → T009 → T011; T010 parallel to T008/T009.
- **US2 (Phase 4)**: Depends on Foundational + T008 (PostPage exists). T012 → T013.
- **US3 (Phase 5)**: Depends on Foundational + T008. T014 and T015 both edit PostPage.tsx (sequential) → T016.
- **US4 (Phase 6)**: Depends on US1 (rendered page to style/inspect); best after US2 (states to traverse). T017 → T018.
- **Polish (Phase 7)**: Depends on all story phases. T019 → T020 → T021.

### User Story Dependencies

- **US1 (P1)**: Only Foundational. Independently testable — the MVP.
- **US2 (P2)**: Builds on US1's `PostPage` (the spec itself notes US2 "depends on US1 existing first"); the underlying error taxonomy is already tested in Foundational.
- **US3 (P2)**: Builds on US1's `PostPage`; independent of US2.
- **US4 (P3)**: Cross-cutting presentation pass over the page US1–US3 produce.

### Within Each User Story

- Tests for the lib layer were written first (Foundational, T002/T003) and must fail before T004/T005.
- Hook before page (T007 → T008), page before route swap (T008 → T009), wiring before manual validation.
- Each story phase ends with its quickstart validation — stop there to demo.

### Parallel Opportunities

- T002 ∥ T003 (different test files).
- T004 ∥ T005 (different source files; postModel.ts does not import api.ts).
- T010 (CSS) ∥ T008/T009 (different files).
- After Foundational, US2 (T012) and US3 (T014/T015) both edit PostPage.tsx — run those phases sequentially, not in parallel, unless split across branches.

---

## Parallel Example: Foundational Phase

```text
# Write both failing test suites together:
Task: "Extend frontend/tests/lib/api.test.ts with buildPostUrl/fetchPost cases (T002)"
Task: "Create frontend/tests/lib/postModel.test.ts reducer + title tests (T003)"

# Then implement both lib modules together:
Task: "Extend frontend/src/lib/api.ts with buildPostUrl/PostResult/fetchPost (T004)"
Task: "Create frontend/src/lib/postModel.ts reducer + formatDocumentTitle (T005)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup (baseline green).
2. Phase 2: Foundational — tested lib layer (CRITICAL, blocks everything).
3. Phase 3: US1 — permalinks render real memes.
4. **STOP and VALIDATE**: quickstart US1 against the populated backend.
5. Demo: the share/permalink story is complete end-to-end.

### Incremental Delivery

1. Setup + Foundational → pure logic tested and gated.
2. US1 → validate → MVP (permalinks work).
3. US2 → validate → dead links and failures handled gracefully.
4. US3 → validate → navigation fully browser-native.
5. US4 → validate → responsive/themed/accessible polish.
6. Polish phase → full automated + manual gates → ready to merge.

---

## Notes

- 13 implementation/validation tasks + 4 test/gate tasks + 4 manual-validation tasks = 21 total; small surface by design (plan: "~1 new lib module + a small extension, 1 hook, 1 page").
- No new dependencies — runtime or dev (Constitution Principle I; plan gate PASS).
- Components/hooks are intentionally outside the coverage scope; their behavior is pinned by the contracts and the quickstart manual gates.
- Commit after each task or logical group (the repo's git extension handles Spec Kit commits).
- PHP/backend untouched; no `docker compose restart backend` needed — but restart `frontend` after merges/checkouts if Vite serves stale modules.
