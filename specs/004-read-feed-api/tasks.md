---
description: "Task list for Read-Side Feed API (Posts Feed & Single Post)"
---

# Tasks: Read-Side Feed API (Posts Feed & Single Post)

**Input**: Design documents from `/specs/004-read-feed-api/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/feed-api.md, quickstart.md

**Tests**: INCLUDED. The spec mandates TDD (quickstart "write these first") and a ≥ 90%
line-coverage gate (Constitution Principle VII). Test tasks are written before their
implementation tasks within each story.

**Organization**: Tasks are grouped by user story so each story is independently
implementable and testable. This feature touches the Laravel **`backend/`** only.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1, US2, US3 — maps the task to a user story from spec.md
- Exact file paths are included in every task

## Conventions & environment

- No local PHP — run `composer`, `php artisan test`, `pint`, and coverage **inside the
  `php:8.3-cli` Docker container** with `backend/` mounted (project convention).
- PHP: `declare(strict_types=1)`, PSR-12, 4-space, typed signatures, methods < 30 lines,
  braces on single-line bodies; comments explain *why*. **No new dependencies.**
- Tests mirror source paths under `backend/tests/` (Principle VII).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the baseline tooling the feature relies on is in place.

- [X] T001 [P] Verify the Laravel `public` filesystem disk is configured in `backend/config/filesystems.php` (used by `Storage::disk('public')` for image existence/URLs) and that PHPUnit + coverage tooling (`backend/phpunit.xml`, `pcov`/Clover) is present for the ≥ 90% gate. No code change if already correct; this only de-risks the image-URL and coverage tasks.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared test fixture that every user story's tests depend on.

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete.

- [X] T002 Add the `Illuminate\Database\Eloquent\Factories\HasFactory` trait to `App\Models\Trashpost` in `backend/app/Models/Trashpost.php` so tests can call `Trashpost::factory()`. (`activated_at` is set by the factory via Eloquent's force-fill, so it need not be in `$fillable`.)
- [X] T003 [P] Create `Database\Factories\TrashpostFactory` in `backend/database/factories/TrashpostFactory.php` with a base definition generating `hash` via `App\Utils\Str::createUniqueHash()` (canonical 10-char code, not ad-hoc Faker), plus `type`, `file = {code}.{ext}`, `username`, and `activated_at = now()`; states: `visible()` (activated, not deleted), `hidden()` (`activated_at = null`), `deleted()` (soft-deleted / `trashed`), and `linkOnly()` (`file = null`, `youtube` set). Mirror the `UserFactory` pattern.

**Checkpoint**: Factory + model wiring ready — user stories can now proceed.

---

## Phase 3: User Story 1 - Browse the newest posts in a paginated feed (Priority: P1) 🎯 MVP

**Goal**: `GET /api/posts` returns the newest visible posts (default 10, newest-first)
with keyset cursor pagination via `start` and a clamped `limit`.

**Independent Test**: Seed > 10 visible posts; `GET /api/posts` returns the newest 10
(`activated_at DESC, id DESC`); passing the last item's `hash` as `start` returns the
next strictly-older batch with no overlap or gap; `limit` is honored and capped; an
unknown `start` yields the newest page (no error).

### Tests for User Story 1 (write first, ensure they FAIL) ⚠️

- [X] T004 [P] [US1] Write `tests/Unit/Services/TrashpostServiceTest.php` (`backend/tests/Unit/Services/TrashpostServiceTest.php`) covering `feed()`: newest-first ordering (`activated_at DESC, id DESC`); default page size 10; `limit` clamped to `[1, 50]`; invalid `limit` (non-numeric / ≤ 0) ⇒ 10; `start` cursor returns only strictly-older posts; unknown/malformed `start` ⇒ ignored (newest page); non-activated and soft-deleted posts excluded; empty feed ⇒ empty collection. **Include a non-monotonic gap case**: a post whose `activated_at` is older than the cursor but whose `id` is *larger* MUST still appear on the next page (proves the keyset is the OR-form, not `activated_at < cursor AND id < cursor.id`). Use `RefreshDatabase` + `TrashpostFactory`.
- [X] T005 [P] [US1] Write `tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php` (`backend/tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php`) feed cases: `GET /api/posts` returns ≤ 10 visible posts newest-first under the `data` envelope with the documented JSON shape (`id`, `hash`, `username`, `url`, `url_api`, …); cursor paging via `start` walks pages with no overlap/gap (include the non-monotonic-`id` scenario from T004); the endpoint responds **without any auth header** (FR-012 read-only/public); empty feed ⇒ `{ "data": [] }`. Use `RefreshDatabase`.

### Implementation for User Story 1

- [X] T006 [US1] Implement `App\Services\TrashpostService::feed(array $query): Collection` in `backend/app/Services/TrashpostService.php`: a private visibility builder (`whereNotNull('activated_at')`, soft-deletes auto-excluded), order `activated_at DESC, id DESC`, clamp `limit` to `[1, 50]` defaulting to 10, and apply the `start` keyset cursor — resolve `hash`, then restrict to strictly-older posts with the **lexicographic keyset** `where(activated_at < cursor.activated_at) orWhere(activated_at = cursor.activated_at AND id < cursor.id)` (wrap the OR group so it doesn't escape the visibility filter); **not** the flat `activated_at < cursor AND id < cursor.id`, which gaps on non-monotonic activation. Unknown/malformed `start` ⇒ ignored. Eloquent only; `hash`/`start` bound as parameters. Methods < 30 lines.
- [X] T007 [US1] Create `App\Http\Resources\TrashpostResource` in `backend/app/Http/Resources/TrashpostResource.php` serializing the stored fields (`id`, `hash`, `title`, `type`, `file`, `youtube`, `user_id`, `username`, `comment`, `metadata`, `created_at`, `updated_at`, `activated_at`, `deleted_at`) plus `url` (`/posts/{hash}` plain string) and `url_api` (`route('api.posts.show', ['hash' => $this->hash])`). Image keys (`original`/`default`/`sizes`) are added in US3.
- [X] T008 [US1] Create `App\Http\Controllers\TrashpostsApiController` in `backend/app/Http/Controllers/TrashpostsApiController.php` with a constructor-injected `TrashpostService` and a thin `index(Request $request)` returning `TrashpostResource::collection($service->feed($request->query()))`.
- [X] T009 [US1] Register routes in `backend/routes/api.php`: `GET /posts` → `index` named `api.posts.index`, and `GET /posts/{hash}` → `show` named `api.posts.show` (registering the show route now lets `url_api` resolve; its controller method lands in US2). Use Eloquent/route-model binding-free explicit `{hash}` param.

**Checkpoint**: `GET /api/posts` is fully functional and independently testable (MVP).

---

## Phase 4: User Story 2 - Open a single post by its shareable identifier (Priority: P1)

**Goal**: `GET /api/posts/{hash}` returns one visible post, or 404 when no visible post
matches (unknown, not activated, or soft-deleted).

**Independent Test**: Request a known visible post by `hash` → its data; request an
unknown, a hidden (`activated_at` null), and a soft-deleted post → 404 each.

### Tests for User Story 2 (write first, ensure they FAIL) ⚠️

- [X] T010 [P] [US2] Add `findVisibleByHash()` cases to `backend/tests/Unit/Services/TrashpostServiceTest.php`: returns the post for a visible `hash`; returns `null` for hidden, soft-deleted, and unknown `hash`.
- [X] T011 [P] [US2] Add `show` cases to `backend/tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php`: `GET /api/posts/{hash}` returns `200 { "data": {…} }` for a visible post (no auth header — FR-012); returns `404` for unknown, hidden, and soft-deleted `hash`.

### Implementation for User Story 2

- [X] T012 [US2] Implement `App\Services\TrashpostService::findVisibleByHash(string $hash): ?Trashpost` in `backend/app/Services/TrashpostService.php`, reusing the same visibility builder so hidden/deleted/unknown all resolve to `null`.
- [X] T013 [US2] Add `show(string $hash)` to `App\Http\Controllers\TrashpostsApiController` in `backend/app/Http/Controllers/TrashpostsApiController.php`: call `findVisibleByHash`, `abort(404)` (or throw `ModelNotFoundException`) on `null`, else return a single `TrashpostResource`.

**Checkpoint**: Feed (US1) and single-post (US2) endpoints both work independently.

---

## Phase 5: User Story 3 - Render each post with its available image sizes (Priority: P2)

**Goal**: Each returned post includes `original`, `default`, and `sizes` URLs for every
image size that actually exists on disk (widths included), omitting absent sizes, and
returns empty image data for link-only posts — no fabricated or missing-file URLs.

**Independent Test**: For a post whose image exists in only `original`, `300`, `100` on
disk, the response lists exactly those (with widths, widest-first) and omits the rest; a
link-only post (`file = null`) returns `original: null`, `default: null`, `sizes: []`
without error; a post with at least one size exposes a usable `default`.

### Tests for User Story 3 (write first, ensure they FAIL) ⚠️

- [X] T014 [P] [US3] Write `tests/Unit/Services/TrashpostImageServiceTest.php` (`backend/tests/Unit/Services/TrashpostImageServiceTest.php`) using `Storage::fake('public')`: writes fake size files at `MediaPath::imageRelativePath(...)` and asserts only existing sizes are listed; `original`/`default` resolve per the rules (`default` = `800` if present, else widest present numeric, else `original`, else null); numeric `sizes` are `{url, width}` widest-first; a null `file` ⇒ `original: null`, `default: null`, `sizes: []`, no error.
- [X] T015 [P] [US3] Add image-URL assertions to `backend/tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php` (with `Storage::fake('public')`): a post with some sizes on disk returns exactly those `sizes` (URLs + widths) and a non-null `default`; a link-only post returns empty image data.

### Implementation for User Story 3

- [X] T016 [US3] Implement `App\Services\TrashpostImageService::imageData(Trashpost $post): array` in `backend/app/Services/TrashpostImageService.php`: derive `code`/`ext` from `$post->file` via `pathinfo`; for each `MediaPath::imageSizes()` build the relative path with `MediaPath::imageRelativePath($size, $code, $ext)`, keep only sizes where `Storage::disk('public')->exists($rel)`, and map kept sizes to `Storage::disk('public')->url($rel)`. Return `original` (string|null), `default` (per the rules), and `sizes` (numeric sizes only, `{url, width:int}`, widest-first). Null `file` ⇒ `['original' => null, 'default' => null, 'sizes' => []]`. Reuse `MediaPath`; no duplicated path logic. Methods < 30 lines.
- [X] T017 [US3] Wire image data into `App\Http\Resources\TrashpostResource` (`backend/app/Http/Resources/TrashpostResource.php`): resolve `TrashpostImageService`, call `imageData($this->resource)`, and merge `original`, `default`, and `sizes` into the serialized array.

**Checkpoint**: All three user stories are independently functional; full contract met.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Style, coverage gate, and optional manual validation.

- [X] T018 [P] Run `vendor/bin/pint --test` against `backend/` (in the `php:8.3-cli` container) and fix any style violations in the new files.
- [X] T019 Run the full suite with coverage in the container: `php artisan test --coverage-clover=coverage.xml` then `python ../.github/scripts/check_coverage.py coverage.xml`; confirm all suites green and total line coverage ≥ 90%.
- [ ] T020 [P] (Optional) Manual smoke per `specs/004-read-feed-api/quickstart.md` against seeded media (`php artisan serve` + the `curl`/`jq` checks): default page 10, `limit` clamp, cursor pages don't overlap, `sizes` point only at existing files, unknown hash ⇒ 404.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **Blocks all user stories** (the factory
  is the shared test fixture).
- **User Stories (Phase 3–5)**: All depend on Foundational. US1 and US2 are both P1; US1
  is the MVP and US2's `show` method completes the route US1 registered. US3 (P2) layers
  image data onto US1's resource.
- **Polish (Phase 6)**: Depends on the desired stories being complete.

### User Story Dependencies

- **US1 (P1)**: Depends only on Foundational. Delivers the feed (MVP).
- **US2 (P1)**: Depends on Foundational; shares `TrashpostService.php`,
  `TrashpostsApiController.php`, and the `api.posts.show` route US1 registered. Adds the
  `show` method + `findVisibleByHash`. Independently testable.
- **US3 (P2)**: Depends on Foundational; augments `TrashpostResource` (created in US1) and
  the controller test. Independently testable for image-data behavior.

### Within Each User Story

- Tests are written first and must FAIL before implementation.
- Service methods → resource → controller → routes.
- Story complete and green before moving to the next priority.

### File-level sequencing (shared files ⇒ not [P] across stories)

- `TrashpostService.php`: `feed()` (T006, US1) before `findVisibleByHash()` (T012, US2).
- `TrashpostServiceTest.php`: T004 (US1) before T010 (US2) — same file.
- `TrashpostsApiController.php`: `index` (T008, US1) before `show` (T013, US2).
- `TrashpostsApiControllerTest.php`: T005 → T011 → T015 (same file, sequential).
- `TrashpostResource.php`: created in T007 (US1), extended in T017 (US3).

### Parallel Opportunities

- T001 (Setup) and T003 (factory) are each [P] within their phase.
- Within US1: T004 and T005 (different test files) run in parallel before implementation.
- Within US2: T010 and T011 touch different files → parallel.
- Within US3: T014 and T015 touch different files → parallel.
- Polish: T018 and T020 are [P]; T019 (coverage) runs after implementation is green.

---

## Parallel Example: User Story 1

```bash
# Write both US1 test files first (different files, in parallel):
Task: "TrashpostServiceTest feed cases in backend/tests/Unit/Services/TrashpostServiceTest.php"
Task: "Feed controller test in backend/tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php"

# Then implement sequentially (service → resource → controller → routes):
#   T006 → T007 → T008 → T009
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → Phase 2 Foundational (factory + `HasFactory`).
2. Phase 3 US1: write T004/T005 (red), implement T006–T009 (green).
3. **STOP and VALIDATE**: `GET /api/posts` paginates correctly and excludes hidden/deleted.
4. Demo the feed.

### Incremental Delivery

1. Setup + Foundational → fixtures ready.
2. US1 (feed) → test independently → MVP.
3. US2 (single post) → test independently → shareable per-post URLs.
4. US3 (image sizes) → test independently → renderable, existing-only image URLs.
5. Polish: pint clean, coverage ≥ 90%, optional smoke.

---

## Notes

- [P] = different files, no dependency on an incomplete task.
- [Story] label maps each task to its user story for traceability.
- No new dependencies (Constitution Principle I); Eloquent/parameterized queries only.
- Verify each test fails before implementing; commit after each task or logical group.
- Image-size truth is the file on disk — never emit a URL for a missing size.
