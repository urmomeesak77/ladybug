---
description: "Task list for Admin Meme Moderation Table"
---

# Tasks: Admin Meme Moderation Table

**Input**: Design documents from `specs/010-admin-meme-moderation/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/admin-moderation-api.md ✅, quickstart.md ✅

**Tests**: INCLUDED. This repo enforces ≥90% line coverage on both stacks in CI (Constitution
Principle VII); the plan, contracts, and quickstart all treat mirrored tests as the real
gates. Test tasks are written **before** their implementation task (TDD) and must fail first.

**Organization**: Tasks are grouped by user story (US1–US4) so each can be implemented and
tested independently. US1+US2 are both P1 (the MVP: a role-gated browsable table); US3+US4
are P2 (the moderation actions).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1, US2, US3, US4 (Setup/Foundational/Polish carry no story label)

## Path Conventions

Web app, two stacks: `backend/` (Laravel 12) and `frontend/` (React 18 + Vite + TS), each
with a mirrored `tests/` tree. All backend PHP runs through the `php:8.3-cli` Docker
container (no local PHP); tests run on sqlite `:memory:` and never hit the network.

---

## Phase 1: Setup (Shared Schema Groundwork)

**Purpose**: The one additive schema change and model wiring every later phase depends on.

- [X] T001 Create additive migration in `backend/database/migrations/2026_07_09_000000_add_youtube_thumbnail_to_trashposts_table.php` — `up`: `$table->string('youtube_thumbnail')->nullable()->after('youtube');`, `down`: `$table->dropColumn('youtube_thumbnail');` (reversible per data-model.md).
- [X] T002 [P] Add `'youtube_thumbnail'` to `Trashpost::$fillable` in `backend/app/Models/Trashpost.php`.
- [X] T003 [P] Confirm the new migration is covered by the existing reversibility test (`backend/tests/…/MigrationReversibilityTest`); run `docker compose exec backend php artisan migrate` then `migrate:rollback` to verify up/down both succeed.

**Checkpoint**: `trashposts.youtube_thumbnail` exists, is mass-assignable, and rolls back cleanly.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The role-gate middleware and shared media-path helper that every admin route and
every thumbnail cell depend on. **No user story can be completed until this phase is done.**

**⚠️ CRITICAL**: US1's index route mounts behind `role:admin`; US1's thumbnails call the new
`MediaPath` method. Both live here.

- [X] T004 [P] Write `EnsureRole` middleware feature test in `backend/tests/Feature/Http/Middleware/EnsureRoleTest.php` — mount `role:admin` on a throwaway route behind `auth:sanctum`; assert guest → 401, member → 403, admin → 200, superuser → 200 (uses `Role::rank`). Must FAIL first.
- [X] T005 Implement `EnsureRole` middleware in `backend/app/Http/Middleware/EnsureRole.php` — `role:admin` admits any user whose `Role::rank() >= Role::Admin->rank()`, else `abort(403)`; `declare(strict_types=1)`, PSR-12, <30-line handle.
- [X] T006 Alias the gate in `backend/bootstrap/app.php` — `$middleware->alias(['role' => EnsureRole::class]);`.
- [X] T007 [P] Add YouTube-thumbnail path cases to `backend/tests/Unit/Support/MediaPathTest.php` — assert `youtubeThumbnailRelativePath('AbCdEfGhIjK')` → `image/trash/youtube/{shard}/AbCdEfGhIjK.jpg` using the existing `shardFor` rule. Must FAIL first.
- [X] T008 Add `MediaPath::youtubeThumbnailRelativePath(string $videoId): string` in `backend/app/Support/MediaPath.php` (static method, reuses `shardFor`).

**Checkpoint**: `role:admin` gate is registered and unit-proven; the YouTube-thumbnail storage
path resolves. Admin routes can now be mounted and thumbnails stored.

---

## Phase 3: User Story 1 - Browse all memes in a moderation table (Priority: P1) 🎯 MVP

**Goal**: A bookmarkable moderation page listing every meme (all states) newest-first, 100/page
with numbered links, six columns (thumbnail, user, created, activated, deleted, actions), a
graceful placeholder for missing thumbnails, an explicit empty state, and clickable rows that
open `/posts/{hash}`.

**Independent Test**: Sign in as admin, open `/admin/memes` → table lists memes newest-first,
100/page; page links write `?page=N` and survive refresh; a row click opens the meme page; a
meme with no resolvable `user_id` shows its stored uploader name; empty corpus shows "no entries".

### Tests for User Story 1 ⚠️ (write first, must fail)

- [X] T009 [P] [US1] `YoutubeThumbnailService` unit test in `backend/tests/Unit/Services/YoutubeThumbnailServiceTest.php` — `Http::fake()` + `Storage::fake('public')`: success stores the file and returns/persists the relative path; already-set `youtube_thumbnail` reuses it with no HTTP call (SC-004); failed fetch returns `null` and leaves the column unset; id re-validated via `Youtube::extractId`.
- [X] T010 [P] [US1] `AdminTrashpostResource` unit test in `backend/tests/Unit/Http/Resources/AdminTrashpostResourceTest.php` — emits `hash, thumbnail, type, username, created_at, activated, deleted, url`; `username` = `user.name` when `user_id` resolves else row `username` (FR-012); `thumbnail` null for missing `100` variant / non-media; `url` = `/posts/{hash}`; `id`/`user_id`/`file` omitted (Principle V).
- [X] T011 [P] [US1] `ModerationService` index unit test in `backend/tests/Unit/Services/ModerationServiceTest.php` — paginates `withTrashed()`, order `created_at DESC, id DESC`, 100/page; includes soft-deleted + unactivated rows; out-of-range page → empty `data` with valid `meta`; empty corpus → `total: 0`.
- [X] T012 [US1] `ModerationController@index` feature test in `backend/tests/Feature/Http/Controllers/Admin/ModerationControllerTest.php` (as admin) — `GET /api/admin/posts` returns 200 with the documented `data`/`links`/`meta` envelope, newest-first, `per_page:100`; `?page` beyond last → 200 empty `data`. (Access-control cases are added in US2.)
- [X] T013 [P] [US1] `moderationModel` unit test in `frontend/tests/unit/lib/moderationModel.test.ts` — row mapping, numbered page-link derivation from `meta`, and activated/deleted state labels.
- [X] T014 [P] [US1] `moderationApi.fetchPage` unit test in `frontend/tests/unit/lib/moderationApi.test.ts` — calls `GET /api/admin/posts?page=N`, returns parsed `{ data, meta }`.
- [X] T015 [P] [US1] `useModeration` load test in `frontend/tests/unit/hooks/useModeration.test.tsx` — reads `?page` from the URL, fetches that page, exposes rows + meta + loading/empty state.
- [X] T016 [P] [US1] `ModerationThumbnail` test in `frontend/tests/unit/components/moderation/ModerationThumbnail.test.tsx` — renders `<img>` with `alt`; `null` src or `onError` swaps to the placeholder (FR-011); clipped to ≤100×75.
- [X] T017 [P] [US1] `ModerationRow` test in `frontend/tests/unit/components/moderation/ModerationRow.test.tsx` — clicking the row navigates to `/posts/{hash}` (FR-018); shows all six cells; user column resolves per FR-012.
- [X] T018 [P] [US1] `ModerationPagination` test in `frontend/tests/unit/components/moderation/ModerationPagination.test.tsx` — renders numbered links setting `?page=N`; marks the current page.
- [X] T019 [P] [US1] `ModerationTable` + `ModerationPage` tests in `frontend/tests/unit/components/moderation/ModerationTable.test.tsx` and `frontend/tests/unit/pages/ModerationPage.test.tsx` — table caption + scoped headers; empty corpus / out-of-range page renders the explicit "no entries" state (FR-019).

### Implementation for User Story 1

- [X] T020 [P] [US1] Implement `YoutubeThumbnailService` in `backend/app/Services/YoutubeThumbnailService.php` — `ensure(Trashpost): ?string` returns stored URL when `youtube_thumbnail` set; else validate id, `Http::timeout(...)->get('https://img.youtube.com/vi/{id}/mqdefault.jpg')`, store under `MediaPath::youtubeThumbnailRelativePath`, persist column, return URL; best-effort — any failure returns `null` (no throw). Static-method class, `strict_types`.
- [X] T021 [US1] Implement `AdminTrashpostResource` in `backend/app/Http/Resources/AdminTrashpostResource.php` — the compact row projection from data-model.md; resolve image `thumbnail` via the existing `100`-size variant (null when absent) and YouTube via `YoutubeThumbnailService`.
- [X] T022 [US1] Implement `ModerationService::paginate(int $page)` in `backend/app/Services/ModerationService.php` — `Trashpost::withTrashed()->with('user')->orderByDesc('created_at')->orderByDesc('id')->paginate(100)`.
- [X] T023 [US1] Implement `ModerationController@index` in `backend/app/Http/Controllers/Admin/ModerationController.php` — returns `AdminTrashpostResource::collection($service->paginate(...))`.
- [X] T024 [US1] Register the admin route group + index route in `backend/routes/api.php` — `Route::middleware(['auth:sanctum','role:admin'])->prefix('admin')->group(...)` with `GET /posts` → `index` named `api.admin.posts.index`.
- [X] T025 [P] [US1] Implement `moderationModel` in `frontend/src/lib/moderationModel.ts` (`ModerationModel` static-method class — row map, page-link math, state labels).
- [X] T026 [P] [US1] Implement `moderationApi` in `frontend/src/lib/moderationApi.ts` (`ModerationApi.fetchPage`, using the shared `Api`/`Csrf` patterns).
- [X] T027 [US1] Implement `useModeration` in `frontend/src/hooks/useModeration.ts` — load the `?page` page, expose rows/meta/loading/empty.
- [X] T028 [P] [US1] Implement `ModerationThumbnail` in `frontend/src/components/moderation/ModerationThumbnail.tsx` (img + `onError` placeholder, clipped ≤100×75).
- [X] T029 [US1] Implement `ModerationRow` in `frontend/src/components/moderation/ModerationRow.tsx` (six cells; row-click nav to `/posts/{hash}`; action cell placeholder for US3/US4).
- [X] T030 [P] [US1] Implement `ModerationPagination` in `frontend/src/components/moderation/ModerationPagination.tsx` (numbered `?page` links).
- [X] T031 [US1] Implement `ModerationTable` in `frontend/src/components/moderation/ModerationTable.tsx` (caption, scoped headers, `overflow-x:auto` container) and `ModerationPage` in `frontend/src/pages/ModerationPage.tsx` (wires hook + table + pagination + empty state).
- [X] T032 [US1] Add the `/admin/memes` route in `frontend/src/App.tsx` pointing at `ModerationPage` (route guard added in US2).

**Checkpoint**: An admin can browse the full corpus, page through it via bookmarkable URLs,
see thumbnails/placeholders, and open any meme — the MVP table stands on its own.

---

## Phase 4: User Story 2 - Restrict the page to admins and above (Priority: P1)

**Goal**: The page **and its data** are admin-or-higher only — guests refused (401), members
refused (403), admin/superuser allowed — and the nav link appears only for admin+.

**Independent Test**: Hit `GET /api/admin/posts` and `/admin/memes` as guest, member, admin,
superuser → only admin/superuser succeed; the LeftMenu Moderation link shows only for admin+.

### Tests for User Story 2 ⚠️ (write first, must fail)

- [X] T033 [US2] Add access-control cases to `backend/tests/Feature/Http/Controllers/Admin/ModerationControllerTest.php` — `GET /api/admin/posts`: guest → 401, member → 403, admin → 200, superuser → 200 (SC-002). (Action-route cases land with those routes in US3/US4; the shared group middleware gates them identically.)
- [X] T034 [P] [US2] `RequireRole` route-gate test in `frontend/tests/components/RequireRole.test.tsx` — renders children for admin+, redirects home for guest/member, renders nothing while `status === 'unknown'` (no flash), mirroring `RequireAuth`.
- [X] T035 [P] [US2] LeftMenu link-visibility test in `frontend/tests/components/LeftMenu.test.tsx` — Moderation link present for admin/superuser, absent for guest/member (FR-001a).

### Implementation for User Story 2

- [X] T036 [US2] Implement `RequireRole` in `frontend/src/components/RequireRole.tsx` — min-role gate reusing 009 `lib/role.ts` + `useAuth().role`.
- [X] T037 [US2] Wrap the `/admin/memes` route in `frontend/src/App.tsx` with `RequireRole` (admin+).
- [X] T038 [US2] Add the admin-only Moderation link to `frontend/src/components/LeftMenu.tsx` (shown only when `Role.rank(role) >= Role.rank('admin')`).

**Checkpoint**: Unauthorized users cannot reach the data or the page, and cannot see the link;
the security boundary (server) plus its UX mirror (client) are both in place.

---

## Phase 5: User Story 3 - Toggle a meme's activation from the table (Priority: P2)

**Goal**: Per-row Activate (inactive → activated) / Deactivate (activated → inactive), applied
on a single click, updating the row in place without losing the current page.

**Independent Test**: As admin, Activate a not-activated meme → row shows activated; Deactivate
→ row shows not-activated; page position unchanged; each row shows exactly the applicable control.

### Tests for User Story 3 ⚠️ (write first, must fail)

- [ ] T039 [P] [US3] Add activate/deactivate cases to `backend/tests/Unit/Services/ModerationServiceTest.php` — Activate sets `activated_at`, Deactivate clears it; both idempotent against the target state (concurrent/repeated safe).
- [ ] T040 [US3] Add activate/deactivate feature cases to `backend/tests/Feature/Http/Controllers/Admin/ModerationControllerTest.php` — `POST /posts/{hash}/activate` and `/deactivate` return 200 with the updated row (FR-017); unknown hash → 404; repeated calls stay idempotent.
- [ ] T041 [P] [US3] Add activate/deactivate to `frontend/tests/unit/lib/moderationApi.test.ts` and apply-in-place to `frontend/tests/unit/hooks/useModeration.test.tsx` — action posts to the right endpoint and replaces just that row, keeping `?page`.
- [ ] T042 [P] [US3] `ModerationActions` test in `frontend/tests/unit/components/moderation/ModerationActions.test.tsx` — renders Activate when inactive / Deactivate when activated (exactly one); clicking an action does NOT trigger row navigation (FR-018).

### Implementation for User Story 3

- [ ] T043 [US3] Add `activate`/`deactivate` to `backend/app/Services/ModerationService.php` — set-to-target on `activated_at` via `withTrashed()->where('hash', ...)` lookup.
- [ ] T044 [US3] Add `activate`/`deactivate` actions + routes (`POST /posts/{hash}/activate`, `/deactivate`) in `backend/app/Http/Controllers/Admin/ModerationController.php` and `backend/routes/api.php`; return the updated `AdminTrashpostResource`.
- [ ] T045 [P] [US3] Add `activate`/`deactivate` to `frontend/src/lib/moderationApi.ts`.
- [ ] T046 [US3] Add an `applyAction` (replace-row) path to `frontend/src/hooks/useModeration.ts`.
- [ ] T047 [US3] Implement `ModerationActions` in `frontend/src/components/moderation/ModerationActions.tsx` (Activate/Deactivate, single click, `stopPropagation` so the row does not navigate) and wire it into `ModerationRow`.

**Checkpoint**: Admins can flip activation both ways from the table, staying on their page.

---

## Phase 6: User Story 4 - Soft-delete or restore a meme from the table (Priority: P2)

**Goal**: Per-row Delete (with a lightweight in-row confirm) soft-deletes; Restore (single
click) undeletes; row reflects state; soft-deleted memes stay retained but absent from public
views; page position preserved.

**Independent Test**: As admin, Delete a meme → confirm → row shows deleted, meme gone from
the public feed and its `/posts/{hash}` public view but retained; Restore → row shows not
deleted and it reappears; Delete confirms, Restore does not.

### Tests for User Story 4 ⚠️ (write first, must fail)

- [ ] T048 [P] [US4] Add delete/restore cases to `backend/tests/Unit/Services/ModerationServiceTest.php` — Delete soft-deletes (`deleted_at` set, row retained), Restore clears it; both idempotent; `withTrashed` lookup finds a soft-deleted meme to restore.
- [ ] T049 [US4] Add delete/restore feature cases to `backend/tests/Feature/Http/Controllers/Admin/ModerationControllerTest.php` — `DELETE /posts/{hash}` → 200 `deleted:true`, `POST /posts/{hash}/restore` → 200 `deleted:false`; unknown hash → 404; a soft-deleted meme is absent from the public feed/show routes (US4 acceptance #3).
- [ ] T050 [P] [US4] Add delete/restore to `frontend/tests/unit/lib/moderationApi.test.ts` and the apply-in-place cases in `frontend/tests/unit/hooks/useModeration.test.tsx`.
- [ ] T051 [P] [US4] Extend `frontend/tests/unit/components/moderation/ModerationActions.test.tsx` — Delete shows an inline Confirm/Cancel before applying (FR-016); Restore applies on a single click; Delete offered when not deleted, Restore when deleted; action clicks never navigate the row.

### Implementation for User Story 4

- [ ] T052 [US4] Add `delete`/`restore` to `backend/app/Services/ModerationService.php` — `$post->delete()` / `$post->restore()` via `withTrashed()->where('hash', ...)`.
- [ ] T053 [US4] Add `destroy`/`restore` actions + routes (`DELETE /posts/{hash}`, `POST /posts/{hash}/restore`) in `backend/app/Http/Controllers/Admin/ModerationController.php` and `backend/routes/api.php`; return the updated row.
- [ ] T054 [P] [US4] Add `delete`/`restore` to `frontend/src/lib/moderationApi.ts`.
- [ ] T055 [US4] Extend `frontend/src/components/moderation/ModerationActions.tsx` with the Delete inline two-step confirm + single-click Restore, presented per the row's deleted state.

**Checkpoint**: Full reversible moderation — Activate↔Deactivate and Delete↔Restore — works
from the table, and soft-deleted memes are correctly hidden from public views.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end coverage, a11y/theming/responsive verification, and the real CI gates.

- [ ] T056 [P] Playwright e2e in `frontend/tests/e2e/moderation.spec.ts` — role gate (member blocked, admin in), browse + page link, and one action round-trip against the isolated compose stack.
- [ ] T057 Verify theming/a11y/responsive on `ModerationPage`/`ModerationTable` — `prefers-color-scheme`, activated/deleted conveyed by text+icon not color alone (FR-014), `<caption>`/scoped headers/`alt`/labeled action buttons, and the `overflow-x:auto` container so the page never scrolls horizontally on mobile (SC-008, Principles IV/VIII).
- [ ] T058 Run the real gates via Docker and hold ≥90% coverage both stacks: `docker compose exec backend vendor/bin/pint --test`, `docker compose exec backend php artisan test`; `cd frontend; npm run lint; npm run test`.
- [ ] T059 Walk `specs/010-admin-meme-moderation/quickstart.md` manual scenarios (US2 access first, then US1/US3/US4, thumbnails SC-003/SC-004, theming/responsive).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS all user stories** (gate + media path).
- **US1 (Phase 3)**: Depends on Foundational. The MVP; other stories build on its table/hook/components.
- **US2 (Phase 4)**: Depends on Foundational; its access tests target the US1 routes and its `RequireRole` wraps the US1 route — sequence after US1.
- **US3 (Phase 5)** and **US4 (Phase 6)**: Depend on US1 (row/hook/actions cell). Independent of each other in behavior but both edit `ModerationService`, the controller, `moderationApi`, `useModeration`, and `ModerationActions` — run sequentially to avoid file conflicts.
- **Polish (Phase 7)**: Depends on all desired stories being complete.

### Within Each Story

- Tests are written first and must fail before implementation.
- Backend: service → resource → controller → route. Frontend: lib/model → api → hook → components → page/route.

### Parallel Opportunities

- Setup: T002 ∥ T003.
- Foundational: the middleware track (T004→T005→T006) ∥ the media-path track (T007→T008).
- US1 tests T009–T019 are largely independent (distinct files) and can be written in parallel; among impl, the backend chain and the frontend `[P]` items (T025, T026, T028, T030) parallelize across files.
- US3/US4 `[P]` test and `moderationApi` tasks parallelize within their phase.

---

## Parallel Example: User Story 1 tests

```bash
# Backend unit tests (distinct files) together:
Task: "YoutubeThumbnailService test in backend/tests/Unit/Services/YoutubeThumbnailServiceTest.php"
Task: "AdminTrashpostResource test in backend/tests/Unit/Http/Resources/AdminTrashpostResourceTest.php"
Task: "ModerationService test in backend/tests/Unit/Services/ModerationServiceTest.php"

# Frontend unit tests (distinct files) together:
Task: "moderationModel test in frontend/tests/unit/lib/moderationModel.test.ts"
Task: "moderationApi.fetchPage test in frontend/tests/unit/lib/moderationApi.test.ts"
Task: "useModeration load test in frontend/tests/unit/hooks/useModeration.test.tsx"
```

---

## Implementation Strategy

### MVP First (US1 + US2)

1. Phase 1 Setup → Phase 2 Foundational (gate + media path).
2. Phase 3 US1 — the browsable table. **Validate independently.**
3. Phase 4 US2 — lock the page/data to admin+. **Validate the gate (SC-002).**
4. This is a shippable MVP: a secure, bookmarkable read-only moderation console.

### Incremental Delivery

5. Phase 5 US3 (activation toggle) → validate → demo.
6. Phase 6 US4 (soft delete/restore) → validate → demo.
7. Phase 7 polish: e2e, a11y/responsive, real CI gates, quickstart walkthrough.

---

## Notes

- `[P]` = different files, no dependency on an incomplete task.
- All PHP runs through the `php:8.3-cli`/backend Docker container; tests use sqlite `:memory:`
  and `Http::fake()` — never the real DB or network.
- No new npm/Composer dependency is introduced (Principle I).
- Commit after each phase (dispatch the `commit-quality-verifier` agent first; commit only on PASS).
