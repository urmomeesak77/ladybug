---
description: "Task list for User Rating & Auto-Activation"
---

# Tasks: User Rating & Auto-Activation

**Input**: Design documents from `/specs/011-user-rating-auto-activation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/rating-api.md, quickstart.md

**Tests**: REQUIRED. Constitution Principle VII mandates ≥90% line coverage on both stacks,
enforced in CI. Test tasks are therefore first-class, not optional, and are written **before**
the implementation they cover (TDD, per `superpowers:test-driven-development`).

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and
demoed independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: `[US1]`, `[US2]`, `[US3]` — maps to the spec's user stories
- Every task names its exact file path

## Path Conventions

Decoupled web app per plan.md: `backend/` (Laravel 12) + `frontend/` (React 18 + Vite), with
Playwright e2e at `frontend/tests/e2e/`. Backend PHP runs **only** through Docker
(`docker compose exec backend …`) — there is no local PHP.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the working stack before touching code. No new dependencies are added by
this feature (Principle I no-op).

- [X] T001 Bring the stack up and confirm the four CI gates pass on a clean branch: `docker compose up -d`, then `docker compose exec backend vendor/bin/pint --test`, `docker compose exec backend php artisan test`, `docker compose exec frontend npm run lint`, `docker compose exec frontend npm run test` — record the baseline coverage numbers before any edit
- [X] T002 Read `backend/app/Services/ModerationService.php`, `backend/app/Services/TrashpostService.php`, and `backend/app/Services/MediaVisibilityService.php` end-to-end and confirm research D0/D4 still hold on this branch (createPost activates unconditionally at `TrashpostService.php` `reserve()`/`attachImage()`; image variants land on the `public` disk)

**Checkpoint**: Green baseline, findings confirmed against live source.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The three additive columns and their model guards. Every user story reads or writes
them.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 [P] Create migration `backend/database/migrations/2026_07_20_000000_add_rating_to_users_table.php` — up: `$table->smallInteger('rating')->default(0)->after('role');`, down: `$table->dropColumn('rating');` (signed per FR-011; `default(0)` backfills existing accounts per FR-002)
- [X] T004 [P] Create migration `backend/database/migrations/2026_07_20_000001_add_rating_flags_to_trashposts_table.php` — up: `boolean('rating_credited')->default(false)->after('activated_at')` and `boolean('rating_penalized')->default(false)->after('rating_credited')`, down: `dropColumn(['rating_credited','rating_penalized'])`
- [X] T005 Run the migrations and confirm reversibility: `docker compose exec backend php artisan migrate` then confirm `backend/tests/Feature/Database/` `MigrationReversibilityTest` still passes
- [X] T006 [P] Update `backend/app/Models/User.php` — add a `why` comment beside the existing `role` guard stating that `rating` is deliberately absent from `$fillable` so no request body can reach it via `fill()` (FR-003); do **not** add a cast (smallint hydrates as `int`)
- [X] T007 [P] Update `backend/app/Models/Trashpost.php` — cast `rating_credited` and `rating_penalized` to `'boolean'` in `$casts`, keep both out of `$fillable` (written only by `RatingService`)
- [X] T008 [P] Extend `backend/tests/Unit/Models/UserTest.php` — assert a freshly created user has `rating === 0` (FR-001) and that `User::fill(['rating' => 999])` leaves the rating at 0 (FR-003)
- [X] T009 [P] Extend `backend/tests/Unit/Models/TrashpostTest.php` — assert both rating flags default to `false`, hydrate as PHP booleans, and are not mass-assignable

**Checkpoint**: Columns exist, are guarded, and are proven un-mass-assignable. User stories may begin.

---

## Phase 3: User Story 1 - An account carries a rating that reflects its record (Priority: P1) 🎯 MVP

**Goal**: `RatingService` owns every rating adjustment; the five moderation transitions apply
them atomically and idempotently; the moderation table shows each meme's owner rating.

**Independent Test**: Register an account (rating 0), then activate / deactivate / delete /
restore / purge its memes as an admin and confirm the rating lands on exactly the number in
`data-model.md`'s adjustment table at each step. No upload path involved.

### Tests for User Story 1 ⚠️ Write first, confirm they FAIL

- [ ] T010 [US1] Create `backend/tests/Unit/Services/RatingServiceTest.php` covering the full adjustment table in `data-model.md`: `credit` on `!rating_credited` → +1 and flag set; `credit` when already credited → 0 (FR-006, FR-014); `releaseCredit` when credited → −1; `releaseCredit` when not credited → 0; `penalize` when unpenalized → −1 (FR-007); `penalize` when already penalized → 0 (FR-008); `refund` when penalized → +1 and re-penalizable afterwards (FR-010); `settlePurge` on a live activated meme → **−2** in one call (FR-009, US1 §9)
- [ ] T011 [P] [US1] Add to `backend/tests/Unit/Services/RatingServiceTest.php` the edge cases from plan.md "Test emphasis": every method on a `user_id === null` meme succeeds and adjusts nothing while still updating flags (FR-012); saturation at `rating = 32767` on credit and `rating = -32768` on penalize leaves the rating unchanged and the call succeeds (FR-011a); a legacy meme (`activated_at` set, `rating_credited = false`) passed to `releaseCredit` moves −1 (FR-002, SC-005)
- [ ] T012 [P] [US1] Extend `backend/tests/Unit/Services/ModerationServiceTest.php` — assert each of activate / deactivate / delete / restore / purge applies its adjustment from the contract table, that the rating write is inside the same transaction as the state change (FR-013 — provable by forcing the rating write to throw and asserting the state change rolled back too), and that `purge()` settles the rating **before** `forceDelete()` destroys the row
- [ ] T013 [P] [US1] Extend `backend/tests/Unit/Services/ModerationServiceTest.php` with the path-independence sequences from `data-model.md` "Worked sequences": activate→purge, activate→deactivate→purge, activate→soft delete→purge each net **−1**; activate→deactivate→activate nets **+1** not +2; soft delete→restore nets **0** (SC-003, SC-004)
- [ ] T014 [P] [US1] Extend `backend/tests/Feature/Http/Controllers/Admin/ModerationControllerTest.php` — assert `GET /api/admin/posts` rows carry `rating` as the owner's current rating, `null` for an unowned meme, never omitted; assert two rows owned by the same account show the same number; assert calling `activate` twice over HTTP moves the rating +1 total (FR-014, **sequential only** — see the concurrency note below)
- [ ] T015 [P] [US1] Extend `backend/tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php` and `backend/tests/Feature/Http/Controllers/AuthControllerTest.php` with the contract §4 negative assertions: no `rating` key on `GET /api/posts`, `GET /api/posts/{hash}`, or `GET /api/user` (FR-022), and `POST /api/register` ignores a submitted `rating` (FR-003)
- [ ] T016 [P] [US1] Extend `frontend/tests/lib/moderationModel.test.ts` — `ModerationModel` parses `rating` from the raw row onto `ModerationRow` and its label helper returns the numeric string for an int and the literal `"no account"` for `null` (FR-021)
- [ ] T017 [P] [US1] Extend `frontend/tests/components/moderation/ModerationRow.test.tsx` and `frontend/tests/components/moderation/ModerationTable.test.tsx` — the table renders a rating header and each row a rating cell; an unowned row renders the text `"no account"`, never `0` and never an empty cell

### Implementation for User Story 1

- [ ] T018 [US1] Create `backend/app/Services/RatingService.php` with `declare(strict_types=1)`, `const TRUST_THRESHOLD = 15`, `const MIN = -32768`, `const MAX = 32767` (add a `why` comment naming `2026_07_20_000000_add_rating_to_users_table.php` as the source of these bounds — nothing ties the constants to the column type, so a type change would silently break FR-011a), and the methods `credit`, `releaseCredit`, `penalize`, `refund`, `settlePurge` — each opens a `DB::transaction()`, takes `lockForUpdate()` on the **post row first then the user row** (fixed order, no deadlock), returns early unless the flag actually changes, and writes `max(MIN, min(MAX, current + delta))` (research D2). `user_id === null` short-circuits to a flag-only update (FR-012). Keep every method under 30 lines (Principle II). **Nesting is intended**: these methods are called from inside the caller's transaction (T019, T031), and Laravel resolves a nested `DB::transaction()` to a savepoint — so each method is safe both standalone and enclosed. `settlePurge` composing `releaseCredit` + `penalize` nests two levels deep by design; add a `why` comment saying so
- [ ] T019 [US1] Wire `RatingService` into `backend/app/Services/ModerationService.php` via the existing constructor-default injection pattern. **`ModerationService` has no transactions today** (verified: zero `DB::` references in the file) — each of the five transitions must be wrapped in a **new** `DB::transaction()` that encloses both the state change and the matching rating adjustment (FR-013). Keep the non-transactional `$this->media->sync($post)` filesystem call **outside** the transaction, after commit, so a rollback never leaves files moved for a state change that did not stick. Note `purge()` must settle the rating **before** `forceDelete()`, alongside where it already computes `ownedPaths()`
- [ ] T020 [P] [US1] Add `'rating' => $this->user?->rating` to `backend/app/Http/Resources/AdminTrashpostResource.php` (null for an unowned meme, never omitted); leave `id`/`user_id` absent per Principle V and leave `backend/app/Http/Resources/UserResource.php` untouched per FR-022
- [ ] T021 [P] [US1] Add `rating: number | null` to the raw and parsed row types in `frontend/src/lib/moderationModel.ts` and add a `ModerationModel` static that maps `null` to the literal `"no account"` (static method on the class, not a loose function — CODING_CONVENTIONS v1.3)
- [ ] T022 [US1] Add the rating column header to `frontend/src/components/moderation/ModerationTable.tsx` and the rating cell to `frontend/src/components/moderation/ModerationRow.tsx`, rendering through the T021 helper — text only, never colour as the sole signal (Principle IV)
- [ ] T023 [US1] Smoke-check the widened table at ~320px: it scrolls inside its own `overflow-x` container with no horizontal page scroll (Principle VIII). The full responsive/theme/a11y/navigation gate is T040 — this is just the in-story check that the new column did not break the layout

**Checkpoint**: The rating exists, moves correctly under every moderation route, and is visible to moderators. This is the MVP and is shippable alone.

---

## Phase 4: User Story 2 - Trusted contributors publish without waiting (Priority: P1)

**Goal**: `createPost()` decides activation from the uploader's rating; sub-threshold uploads are
created pending **and their media is not publicly fetchable**.

**Independent Test**: Set one account's rating to 15 and another's to 14, upload as each, and
confirm the first meme is in the public feed immediately while the second 404s until a moderator
activates it.

**Depends on**: Phase 3's `RatingService::credit` (FR-019 reuses the normal activate path).

### Tests for User Story 2 ⚠️ Write first, confirm they FAIL

- [ ] T024 [US2] Add `shouldAutoActivate` boundary tests to `backend/tests/Unit/Services/RatingServiceTest.php` — a member at rating **14** returns `false` and at **15** returns `true` (FR-016, FR-020); the comparison reads the rating as it stands before any new credit
- [ ] T025 [P] [US2] Extend `backend/tests/Unit/Services/TrashpostServiceTest.php` — a below-threshold member's upload is created with `activated_at === null` and `rating_credited === false` (FR-018); an at-or-above-threshold member's upload is created activated and the uploader's rating rises by exactly 1 (FR-019); both YouTube and image branches are covered, since activation is set in `reserve()` and `attachImage()` respectively; assert atomicity per FR-013 by forcing `credit()` to throw and confirming no activated-but-uncredited post survives (T031)
- [ ] T026 [P] [US2] Add the research-D4 security test to `backend/tests/Feature/Http/Controllers/CreatePostTest.php` — after a pending (sub-threshold) upload, assert none of the image size variants nor the YouTube thumbnail exist on the `public` disk, and that `GET /api/posts/{hash}` 404s and the feed omits the row; assert `POST /api/posts` still returns **201** on the pending branch
- [ ] T027 [P] [US2] Extend `backend/tests/Feature/Http/Controllers/Admin/ModerationControllerTest.php` — a moderator activating a pending upload makes it appear in the public feed, restores its media to the public disk, and raises its owner's rating by 1 (US2 §3)
- [ ] T028 [P] [US2] Extend `frontend/tests/e2e/upload.spec.ts` — a below-threshold member uploads and the meme does **not** appear in the feed; after an admin activates it from `/admin/posts` it does

### Implementation for User Story 2

- [ ] T029 [US2] Add `shouldAutoActivate(User $user): bool` to `backend/app/Services/RatingService.php` returning true when `$user->rating >= self::TRUST_THRESHOLD` (the role half lands in T033)
- [ ] T030 [US2] Inject `RatingService` into `backend/app/Services/TrashpostService.php` via the constructor-default pattern and call `shouldAutoActivate($user)` in `createPost()` **before** `reserve()`, threading the boolean through to replace the unconditional `activated_at = now()` in both `reserve()` and `attachImage()` (FR-015, FR-020)
- [ ] T031 [US2] On the activated branch of `createPost()`, call `RatingService::credit($post)` so an auto-activation earns its +1 on the same terms as a moderator activation (FR-019). The row's activation and its credit must commit **together** (FR-013) — `createPost()` has no transaction today, so wrap the activation + credit so a failed credit cannot leave an activated-but-uncredited post
- [ ] T032 [US2] On the pending branch of `createPost()`, call `MediaVisibilityService::sync($post)` to move a pending meme's bytes off the `public` disk — covers image variants and the YouTube thumbnail alike (research D4, contract §2). **Call site is exact**: at the end of `createPost()`, after *both* the `attachImage()` and the `thumbnails->ensure()` branches and before `return $post`. Placing it earlier misses the YouTube thumbnail, which `ensure()` writes to the public disk last — that is precisely the leak D4 identified. Add a `why` comment naming the moderation-bypass this closes

**Checkpoint**: Rating-based auto-activation works end to end and pending media is not URL-addressable.

---

## Phase 5: User Story 3 - Moderators publish immediately regardless of rating (Priority: P2)

**Goal**: Admins and superusers skip the queue whatever their rating, including a negative one.

**Independent Test**: Set an admin's rating to −5, upload, and confirm the meme is live
immediately and the admin's rating becomes −4.

### Tests for User Story 3 ⚠️ Write first, confirm they FAIL

- [ ] T033 [US3] Add role tests to `backend/tests/Unit/Services/RatingServiceTest.php` — `shouldAutoActivate` returns `true` for an admin at rating 0 and for a superuser at a negative rating, and `false` for a member below the threshold (FR-017)
- [ ] T034 [P] [US3] Extend `backend/tests/Feature/Http/Controllers/CreatePostTest.php` — an admin with rating −5 uploads and the meme is activated on creation and appears in the feed; the admin's rating rises to −4 (US3 §1, §3)

### Implementation for User Story 3

- [ ] T035 [US3] Extend `shouldAutoActivate` in `backend/app/Services/RatingService.php` with the role branch, reusing the shipped comparison `!Role::Admin->outranks($user->role)` (true for admin and superuser, false for member) rather than introducing a new role check (research D5)

**Checkpoint**: All three user stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T036 Run the backend gates and fix anything they surface: `docker compose exec backend vendor/bin/pint --test`, `docker compose exec backend php artisan test --coverage-clover=coverage.xml`, `python .github/scripts/check_coverage.py coverage.xml` (≥90%). Remember `docker compose restart backend` after PHP edits (opcache `validate_timestamps=0`)
- [ ] T037 [P] Run the frontend gates and fix anything they surface: `docker compose exec frontend npm run lint` and `docker compose exec frontend npm run test -- --coverage` (≥90% across **all** of `src/`)
- [ ] T038 [P] Run the Playwright e2e suite against the isolated stack and confirm `frontend/tests/e2e/moderation.spec.ts` and `frontend/tests/e2e/upload.spec.ts` both pass with the new column and the pending-upload flow
- [ ] T039 Walk `specs/011-user-rating-auto-activation/quickstart.md` scenarios 1–5 against the running stack and confirm each lands on the stated number exactly — especially scenario 3's "pending upload media must 404 on the public disk" and scenario 5's "two simultaneous activates" row, which is the **only** place FR-014's true-concurrency guarantee is verified (see the concurrency note below)
- [ ] T040 Complete the quickstart manual verification gate: responsive at ~320px / tablet / desktop with no horizontal page scroll, both themes legible, rating not conveyed by colour alone, and Back/Forward/Refresh on `/admin/posts?page=N` restores the page (Principles III, IV, VIII)
- [ ] T041 [P] Update `CLAUDE.md`'s "Current State" section to list 011 among the implemented features, noting the rating column, the `RatingService`, and that uploads are now conditionally activated
- [ ] T042 Dispatch the `commit-quality-verifier` subagent on the staged diff and commit only on PASS

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: depends on Phase 1 — **blocks every user story** (no rating columns, no rating logic)
- **US1 (Phase 3)**: depends on Phase 2 only
- **US2 (Phase 4)**: depends on Phase 2, and on T018 from US1 (`RatingService::credit` for FR-019)
- **US3 (Phase 5)**: depends on Phase 2 and on T029 from US2 (extends the same predicate)
- **Polish (Phase 6)**: depends on all desired stories

### User Story Dependencies

- **US1 (P1)**: fully independent once Phase 2 lands. Shippable alone as the MVP.
- **US2 (P1)**: shares `RatingService` with US1 but is independently *testable* — its assertions are about `createPost()` behaviour, not moderation transitions.
- **US3 (P2)**: a one-line extension of US2's predicate plus its own tests. Cannot precede US2.

### Within Each User Story

- Tests are written and **confirmed failing** before the implementation they cover
- Migrations before models before services before resources before UI
- `RatingService` (T018) before every call site that uses it

### Parallel Opportunities

- **Phase 2**: T003, T004 in parallel; then T006, T007, T008, T009 all in parallel (four different files)
- **Phase 3 tests**: T011–T017 in parallel — seven different test files
- **Phase 3 implementation**: T020 (backend resource) and T021 (frontend model) in parallel — different stacks
- **Phase 4 tests**: T025, T026, T027, T028 in parallel
- **Phase 6**: T036, T037, T038 are three independent gate runs; T041 parallel with all of them
- **Cross-story**: US1's frontend tasks (T021–T023) are independent of US2/US3 entirely and can be worked by a second person while the backend auto-activation lands

---

## Parallel Example: User Story 1

```bash
# Launch all US1 test tasks together (seven different files):
Task: "RatingService edge cases in backend/tests/Unit/Services/RatingServiceTest.php"
Task: "Moderation transitions in backend/tests/Unit/Services/ModerationServiceTest.php"
Task: "Path independence sequences in backend/tests/Unit/Services/ModerationServiceTest.php"
Task: "Admin rows carry rating in backend/tests/Feature/Http/Controllers/Admin/ModerationControllerTest.php"
Task: "Rating absent from public payloads in backend/tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php"
Task: "Rating parsing in frontend/tests/lib/moderationModel.test.ts"
Task: "Rating cell rendering in frontend/tests/components/moderation/ModerationRow.test.tsx"

# Then the two independent implementation tasks:
Task: "Add rating to backend/app/Http/Resources/AdminTrashpostResource.php"
Task: "Add rating to frontend/src/lib/moderationModel.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → green baseline
2. Phase 2 Foundational → three columns, guarded
3. Phase 3 US1 → the rating exists, moves correctly, and is visible to moderators
4. **STOP and VALIDATE**: quickstart scenarios 1, 2, 4 and 5 all pass without any upload involvement
5. Shippable — moderators gain a trust signal even before auto-activation exists

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. + US1 → rating tracks moderation, visible in the admin table → **MVP**
3. + US2 → trusted contributors publish instantly; pending media secured
4. + US3 → moderators skip their own queue
5. Polish → gates, quickstart, manual checks

### Risk Notes

- **T032 is the security-critical task.** Without it, FR-018 ships a moderation bypass: the JSON hides a pending row while its bytes stay fetchable (research D4). T026 is the test that proves it.
- **T019's purge ordering** is easy to get wrong — the rating must settle before `forceDelete()`, in the same transaction, or the −2 is lost with the row.
- **T030 changes shipped behaviour** (feature 008 activates every upload today). Existing `CreatePostTest` expectations will need updating, not just extending.

---

## Notes

- `[P]` = different files, no dependency on an incomplete task
- Backend PHP runs only through Docker; `docker compose restart backend` after PHP edits
- Tests run on sqlite `:memory:` only — `Tests\TestCase` hard-aborts otherwise
- **Concurrency note (FR-014).** The design leans on `lockForUpdate()`, which is a **no-op on
  sqlite**, and the test suite runs on a single in-memory connection — so the automated tests
  can only prove *flag-based sequential* idempotency (a repeated activate is +1 total). The
  true-simultaneous guarantee the contract states is verified **manually** against MySQL via
  quickstart scenario 5 (T039). Do not read a green T010/T014 as proof of concurrency safety
- No new npm/Composer dependency is introduced anywhere in this list (Principle I)
- Commit after each logical group; dispatch `commit-quality-verifier` before each phase commit
