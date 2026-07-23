# Tasks: Trashpost Comments

**Input**: Design documents from `/specs/015-comments-on-trashposts/`

**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓

**Tests**: INCLUDED — the Ladybug Constitution (Principle VII) mandates mirrored tests at
≥90% line coverage on both stacks; test tasks are therefore first-class, not optional.

**Organization**: Tasks are grouped by user story (US1–US4) so each story is an independent,
testable increment. US1 + US2 together are the MVP (read + add); US3 + US4 layer moderation
on top.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 (read) · US2 (add) · US3 (hide/unhide) · US4 (delete)
- Backend paths under `backend/`, frontend paths under `frontend/`

## Path Conventions (from plan.md)

- Backend (Laravel 12): `backend/app/…`, `backend/database/…`, `backend/routes/api.php`,
  tests mirrored under `backend/tests/`.
- Frontend (React 18 + Vite): `frontend/src/…`, tests mirrored under `frontend/tests/`.
- Backend runs through the `php:8.3-cli` Docker container (no local PHP); tests on SQLite
  `:memory:` only.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: One-time config the whole feature relies on. Both apps are already scaffolded.

- [x] T001 [P] Add a `comment_throttle` default (e.g. `env('COMMENT_THROTTLE', 10)`) under a
  `ladybug`/rate-limit config key in `backend/config/app.php`, and document
  `COMMENT_THROTTLE` in `backend/.env.example` (Principle I — app config, not a dependency).
- [x] T002 [P] Create the `frontend/src/components/comments/` folder and the mirrored
  `frontend/tests/components/comments/` folder so later component/test tasks have their home.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The table, model, relations, shared resource, rate limiter, and shared
frontend model that EVERY user story depends on.

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete.

- [x] T003 [P] Create migration
  `backend/database/migrations/2026_07_23_000000_create_comments_table.php`: `id`, unique
  `hash(10)` (`utf8mb4_bin` on MySQL), `trashpost_id` FK `cascadeOnDelete()`, nullable
  `user_id` FK `nullOnDelete()`, nullable `username`, `body` text, nullable `hidden_at`,
  timestamps (`useCurrent()`, `useCurrentOnUpdate()` on MySQL), and composite index
  `(trashpost_id, created_at, id)`. Follow the MySQL/SQLite driver split of
  `2026_06_08_000000_create_trashposts_table.php` (data-model.md).
- [x] T004 [P] Create `backend/app/Models/Comment.php`: `HasFactory`, `$table='comments'`,
  `$fillable=['body']` only; `trashpost()` and `user()` `BelongsTo`; `isHidden(): bool`
  (`hidden_at !== null`); datetime casts on `created_at`/`updated_at`/`hidden_at`
  (data-model.md — hash/trashpost_id/user_id/username/hidden_at stay off `$fillable`).
- [x] T005 [P] Create `backend/database/factories/CommentFactory.php` producing a valid
  comment (generated `hash`, `body`, associated `trashpost_id`/`user_id`/`username`, visible
  by default) with a `hidden()` state helper for hidden rows.
- [x] T006 [P] Add `comments(): HasMany` → `Comment` to `backend/app/Models/Trashpost.php`.
- [x] T007 [P] Add `comments(): HasMany` → `Comment` to `backend/app/Models/User.php`.
- [x] T008 Register a per-user `RateLimiter::for('comments', …)` (keyed by user id, cap from
  `config` T001) in `backend/app/Providers/AppServiceProvider.php` (research D8).
- [x] T009 [P] Create `backend/app/Http/Resources/CommentResource.php`: expose `hash`,
  `body`, `username` (author display = `user?->name ?? username`), viewer-aware `hidden`
  (`isHidden()`), `created_at`; omit `id`/`trashpost_id`/`user_id`/`hidden_at`/`updated_at`
  (contracts + data-model D5/D7).
- [x] T010 [P] Create `frontend/src/lib/commentModel.ts`: a class of statics with the
  `Comment`/`CommentPage`/list-state types, response→model mapping, and the list reducer
  (prepend-new, append-older, replace-row, drop-row, count adjust) shared by all stories
  (plan.md; conventions — single-responsibility `lib/` class of statics).
- [x] T011 [P] Create `frontend/tests/lib/commentModel.test.ts` covering the reducer
  operations (prepend/append/replace/drop and public-count adjustments) and mapping.

**Checkpoint**: Schema, model, relations, resource, limiter, and shared frontend model exist
— user stories can now proceed.

---

## Phase 3: User Story 1 - Read comments on a trashpost (Priority: P1) 🎯 MVP

**Goal**: Any visitor (signed in or not) sees a post's comments newest-first with author +
timestamp, a comment count, an explicit empty state, and a "load more older comments"
control that appends the next 10 (FR-002, FR-003, FR-015, FR-016, FR-019).

**Independent Test**: Open `/posts/{hash}` as a guest and as a signed-in user on a post with
several comments → newest-first, each with author + time, count shown; open a post with none
→ "no comments yet"; click "load more older comments" → next 10 append, URL unchanged.

### Tests for User Story 1 ⚠️ (write first, must FAIL before implementation)

- [x] T012 [P] [US1] `backend/tests/Unit/Services/CommentServiceTest.php` — cover `list`:
  newest-first `created_at DESC, id DESC`, batch of 10, keyset `before` cursor paging,
  `meta.total` = public (non-hidden) count regardless of viewer, guest/member exclude hidden
  rows while admin includes them flagged hidden (D6/D7).
- [x] T013 [P] [US1] `backend/tests/Feature/Http/Controllers/CommentControllerTest.php` —
  `GET /api/posts/{hash}/comments`: 200 newest-first shape, `meta.total`/`next_cursor`/
  `has_more`, empty post → `data:[]`+`total:0`, `before` pagination, unknown/non-public post
  hash → 404, admin sees hidden rows / guest does not (contracts).
- [x] T014 [P] [US1] `frontend/tests/lib/commentApi.test.ts` — `CommentApi.fetchPage(hash,
  before?)` requests the nested URL and maps the page (mock fetch).
- [x] T015 [P] [US1] `frontend/tests/hooks/useComments.test.ts` — initial load and
  append-older sequencing (loading flags, cursor advance, has-more).
- [x] T016 [P] [US1] Three sibling test files (intentionally grouped — one component tree,
  authored together):
  `frontend/tests/components/comments/CommentSection.test.tsx`,
  `CommentList.test.tsx`, and `CommentItem.test.tsx` — renders count, newest-first list,
  author + timestamp per row, empty state, and the "load more older comments" control (hidden
  when `has_more` is false).
- [x] T017 [P] [US1] `frontend/tests/e2e/comments.spec.ts` (read slice) — a post with
  comments renders newest-first; a post with none shows the empty state (Playwright, isolated
  `docker-compose.e2e.yml`).

### Implementation for User Story 1

- [x] T018 [US1] Create `backend/app/Services/CommentService.php` with `list(Trashpost $post,
  ?string $before, ?User $viewer): array` — keyset newest-first batch of 10, viewer-aware
  row visibility, and public `total` count (data-model derived values; research D6/D7).
- [x] T019 [US1] Create `backend/app/Http/Controllers/CommentController.php` with `index` —
  resolve the post by hash viewer-aware (404 when the viewer may not see it, mirroring
  `TrashpostsApiController::show`), call `CommentService::list`, return
  `CommentResource::collection` + `meta` (contracts).
- [x] T020 [US1] Add `GET /api/posts/{hash}/comments` → `CommentController@index` (public) to
  `backend/routes/api.php`.
- [x] T021 [P] [US1] Add `CommentApi.fetchPage` to `frontend/src/lib/commentApi.ts` (new
  file, class of statics over the shared `Api`/HTTP helper).
- [x] T022 [US1] Create `frontend/src/hooks/useComments.ts` — initial load + append-older
  (cursor, has-more, loading state) over `CommentApi` and `CommentModel` reducer.
- [x] T023 [P] [US1] Create `frontend/src/components/comments/CommentItem.tsx` — author name,
  post time, and body rendered as a plain-text child (`{body}`, `white-space: pre-wrap`;
  never `dangerouslySetInnerHTML` — D10).
- [x] T024 [P] [US1] Create `frontend/src/components/comments/CommentList.tsx` — ordered list
  of `CommentItem` + the "load more older comments" control.
- [x] T025 [US1] Create `frontend/src/components/comments/CommentSection.tsx` — comment count,
  `CommentList`, empty "no comments yet" state; themed/responsive/accessible (FR-016, FR-018).
- [x] T026 [US1] Render `<CommentSection hash={hash} />` on
  `frontend/src/pages/PostPage.tsx` (plan.md integration).

**Checkpoint**: Reading comments works end-to-end for guests and signed-in users.

---

## Phase 4: User Story 2 - Add a comment as a verified signed-in user (Priority: P1) 🎯 MVP

**Goal**: A verified signed-in user posts a comment that appears at the top in place (no
reload, place preserved); guests see a sign-in prompt, unverified users a verify-e-mail
prompt; the create gate is enforced at the data layer; body is validated and stored as plain
text (FR-004–FR-009, SC-001/002/007).

**Independent Test**: As a verified account, submit a comment → it appears on top attributed
to you, no reload; sign out and reload → form replaced by sign-in prompt; sign in unverified
→ verify-e-mail prompt; direct `POST` as guest → 401 / unverified → 403; empty or >1000 →
422; `<script>` body renders as literal text.

### Tests for User Story 2 ⚠️ (write first, must FAIL before implementation)

- [ ] T027 [P] [US2] Extend `backend/tests/Unit/Services/CommentServiceTest.php` — `create`:
  sets `hash`, `trashpost_id`, `user_id`, `username` snapshot, `body`; `hidden_at` null
  (immediately public); attributed to the author (data-model).
- [ ] T028 [P] [US2] Extend
  `backend/tests/Feature/Http/Controllers/CommentControllerTest.php` — `POST`: guest → 401,
  unverified → 403, verified → 201 with the created row; empty/whitespace → 422, >1000 → 422;
  unknown post hash → 404; `<script>` body stored verbatim; over-cap → 429 (contracts, D8).
- [ ] T029 [P] [US2] Extend `frontend/tests/lib/commentApi.test.ts` and
  `frontend/tests/hooks/useComments.test.ts` — `CommentApi.create` posts the body; hook
  prepends the new row and increments the count (FR-006).
- [ ] T030 [P] [US2] `frontend/tests/components/comments/CommentForm.test.tsx` — verified user
  sees the labeled textarea + submit with inline validation; guest sees the sign-in prompt;
  unverified sees the verify-e-mail prompt (FR-005).
- [ ] T031 [P] [US2] Extend `frontend/tests/e2e/comments.spec.ts` — verified user posts a
  comment (appears on top, no reload); guest and unverified see their respective prompt.

### Implementation for User Story 2

- [ ] T032 [P] [US2] Create `backend/app/Http/Requests/CreateCommentRequest.php` —
  `prepareForValidation` trims `body`; rules `required|string|max:1000`; `authorize()` returns
  `true` (gate is middleware's job) (data-model validation, D8).
- [ ] T033 [US2] Add `create(Trashpost $post, User $author, string $body): Comment` to
  `backend/app/Services/CommentService.php` — assign hash/trashpost/user/username snapshot/
  body explicitly (never mass-assign), `hidden_at` null.
- [ ] T034 [US2] Add `store` to `backend/app/Http/Controllers/CommentController.php` —
  resolve the post by hash (404 if not viewable), call `create`, return the row as a
  `CommentResource` with 201 (contracts).
- [ ] T035 [US2] Add `POST /api/posts/{hash}/comments` → `CommentController@store` behind
  `['auth:sanctum','verified','throttle:comments']` in `backend/routes/api.php` (D8).
- [ ] T036 [P] [US2] Add `CommentApi.create(hash, body)` (with `Csrf.ensure()` header) to
  `frontend/src/lib/commentApi.ts`.
- [ ] T037 [US2] Extend `frontend/src/hooks/useComments.ts` — `submit` prepends the created
  row in place and increments the count without reload (FR-006, SC-001).
- [ ] T038 [US2] Create `frontend/src/components/comments/CommentForm.tsx` — labeled textarea,
  submit, inline length/empty validation, server-error surfacing; themed/accessible (FR-005,
  FR-007, FR-008, FR-018).
- [ ] T039 [US2] Wire `CommentForm` into `CommentSection.tsx` gated by auth/verified state:
  verified → form; guest → sign-in prompt; signed-in unverified → verify-e-mail prompt
  (reuse existing auth/role hooks) (FR-005).

**Checkpoint**: MVP complete — comments can be read and posted by verified users.

---

## Phase 5: User Story 3 - Admin hides or unhides a comment (Priority: P2)

**Goal**: Admin+ can hide (remove from public view, retain, marked hidden to admins) and
unhide (restore) a comment inline via the shared `ActionMenu`; hidden comments leave the
public count; members see no controls (FR-010, FR-011, FR-012, FR-014, FR-015).

**Independent Test**: As admin, hide a comment → guests no longer see it and the public count
drops, admin still sees it flagged hidden with an Unhide option; as a member, no controls
appear; unhide → visible to all again, count restored.

### Tests for User Story 3 ⚠️ (write first, must FAIL before implementation)

- [ ] T040 [P] [US3] Extend `backend/tests/Unit/Services/CommentServiceTest.php` — `hide`
  sets `hidden_at=now()` (idempotent, keeps original timestamp on repeat), `unhide` sets null;
  `lockForUpdate` state-guard so concurrent actions converge (D2, contracts concurrency).
- [ ] T041 [P] [US3] Create
  `backend/tests/Feature/Http/Controllers/Admin/CommentModerationControllerTest.php` — `hide`
  and `unhide`: guest → 401, member → 403, admin → 200 updated row; unknown hash → 404;
  idempotent repeat (contracts).
- [ ] T042 [P] [US3] Extend `frontend/tests/lib/commentApi.test.ts` and
  `useComments.test.ts` — `CommentApi.hide`/`unhide` hit the admin URLs; hook replaces the row
  and adjusts the public count on an actual transition, and — for an idempotent/concurrent
  repeat that returns the same `hidden` state — leaves the count unchanged (no double
  decrement/increment) (FR-014, FR-015).
- [ ] T043 [P] [US3] Extend `frontend/tests/components/comments/CommentItem.test.tsx` — admin
  viewer sees an `ActionMenu` with Hide (visible) / Unhide (hidden) and a hidden badge (marked
  by more than color); member viewer sees no menu (FR-010, FR-011).
- [ ] T044 [P] [US3] Extend `frontend/tests/e2e/comments.spec.ts` — admin hides a comment; a
  guest view no longer shows it.

### Implementation for User Story 3

- [ ] T045 [US3] Add `hide(Comment $comment)` and `unhide(Comment $comment)` to
  `backend/app/Services/CommentService.php` — each in a transaction with `lockForUpdate` and a
  current-`hidden_at` state guard (set-to-target, idempotent, converges) (D2, contracts).
- [ ] T046 [US3] Create
  `backend/app/Http/Controllers/Admin/CommentModerationController.php` with `hide` + `unhide`
  — resolve comment by hash (404), call the service, return the updated `CommentResource`.
- [ ] T047 [US3] Add `POST /api/admin/comments/{hash}/hide` and `.../unhide` inside the
  existing admin group (`auth:sanctum` + `role:admin`) in `backend/routes/api.php` (contracts).
- [ ] T048 [P] [US3] Add `CommentApi.hide(hash)` / `CommentApi.unhide(hash)` (with
  `Csrf.ensure()`) to `frontend/src/lib/commentApi.ts`.
- [ ] T049 [US3] Extend `frontend/src/hooks/useComments.ts` — moderate sequencing: replace the
  row in place and adjust the public count **only on an actual `hidden` state transition**
  (compare the prior local row state to the server response): visible → hidden decrements,
  hidden → visible increments, a no-op idempotent/concurrent repeat leaves the count unchanged
  — never adjust unconditionally (FR-014, FR-015, edge case "Concurrent moderation"; symmetric
  with T061's conditional delete decrement).
- [ ] T050 [US3] Extend `frontend/src/components/comments/CommentItem.tsx` — for admin viewers
  render the shared `ActionMenu` (013) with Hide/Unhide (state-driven) and a hidden badge
  (text/badge, not color alone); no menu for guests/members (FR-010, FR-011, D9).

**Checkpoint**: Reversible hide/unhide moderation works inline for admins.

---

## Phase 6: User Story 4 - Admin permanently deletes a comment (Priority: P2)

**Goal**: Admin+ can permanently (hard) delete a comment after an explicit confirmation; once
deleted it is gone for everyone including admins and unrecoverable; deletion supersedes
hidden; parent-purge cascade removes comments (FR-013, FR-014, FR-020, SC-006).

**Independent Test**: As admin, choose Delete → confirmation required; cancel leaves it;
confirm → the comment disappears for all viewers, count updates, place preserved; a hidden
comment can still be deleted; purging the parent post cascade-deletes its comments.

### Tests for User Story 4 ⚠️ (write first, must FAIL before implementation)

- [ ] T051 [P] [US4] Extend `backend/tests/Unit/Services/CommentServiceTest.php` — `delete`
  hard-removes the row (no SoftDeletes tombstone); a hidden comment can be deleted (D3).
- [ ] T052 [P] [US4] Extend
  `backend/tests/Feature/Http/Controllers/Admin/CommentModerationControllerTest.php` —
  `DELETE /api/admin/comments/{hash}`: guest → 401, member → 403, admin → 204 and row gone;
  unknown hash → 404 (contracts).
- [ ] T053 [P] [US4] Add a cascade test in a dedicated
  `backend/tests/Feature/CommentCascadeTest.php` — purging a trashpost (`ModerationService::
  purge` → hard delete) removes its comments via the FK; soft-delete/hide does NOT (FR-020, D4).
- [ ] T054 [P] [US4] Extend `frontend/tests/lib/commentApi.test.ts` and
  `useComments.test.ts` — `CommentApi.delete` hits the DELETE URL; hook drops the row and
  decrements the count only if the deleted row was public (contracts).
- [ ] T055 [P] [US4] Extend `frontend/tests/components/comments/CommentItem.test.tsx` — admin
  Delete item triggers the `useNotice` confirm; cancel leaves the row (FR-013).
- [ ] T056 [P] [US4] Extend `frontend/tests/e2e/comments.spec.ts` — admin confirms delete;
  the comment is removed for all viewers.

### Implementation for User Story 4

- [ ] T057 [US4] Add `delete(Comment $comment): void` to
  `backend/app/Services/CommentService.php` — hard `delete()` inside a transaction (no
  SoftDeletes; supersedes hidden) (D3).
- [ ] T058 [US4] Add `destroy` to
  `backend/app/Http/Controllers/Admin/CommentModerationController.php` — resolve by hash
  (404), delete, return `204` (contracts).
- [ ] T059 [US4] Add `DELETE /api/admin/comments/{hash}` →
  `CommentModerationController@destroy` inside the admin group in `backend/routes/api.php`.
- [ ] T060 [P] [US4] Add `CommentApi.delete(hash)` (with `Csrf.ensure()`) to
  `frontend/src/lib/commentApi.ts`.
- [ ] T061 [US4] Extend `frontend/src/hooks/useComments.ts` — drop the row on `204`; decrement
  the public count only when the deleted row was visible; leave the row on any non-2xx
  (fail-safe) (contracts, FR-014).
- [ ] T062 [US4] Extend `frontend/src/components/comments/CommentItem.tsx` — add the Delete
  `ActionMenu` item (destructive emphasis) guarded by `useNotice().ask` confirm before calling
  delete (D9, FR-013).

**Checkpoint**: Full moderation (hide/unhide + confirmed permanent delete) works; all four
stories are independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Verification, coverage, and consistency across all stories.

- [ ] T063 [P] Run the backend suite + Clover coverage via the `php:8.3-cli` container and
  confirm ≥90% line coverage on the new code (`CommentService`, both controllers,
  `CommentResource`, `CreateCommentRequest`, `Comment`) (Principle VII).
- [ ] T064 [P] Run `npm run lint` and `npm run test` (Vitest coverage spans all of `src/`) and
  confirm ≥90% on the new comment modules/components/hook (Principle VII).
- [ ] T065 Manual responsive/theming pass on the comment section from ~320px to wide desktop
  in light and dark — no horizontal scroll, no clipped controls, hidden badge legible
  (FR-018, SC-008, Principles IV & VIII).
- [ ] T066 Run the `quickstart.md` scenarios end-to-end (US1–US4 + lifecycle/cascade/orphan)
  against the dev stack and confirm each maps to its acceptance criteria.
- [ ] T067 Update `backend`/`frontend` docs and the root `CLAUDE.md` "Current State" list with
  a **015-comments-on-trashposts** entry summarizing the delivered surface (comments table,
  `CommentService`, public + admin controllers, `CommentSection`). Note: the Current-State
  list currently ends at 013; add 015 here and, if not already present, backfill the
  unrelated 014-upload-page-polish entry in the same pass.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately.
- **Foundational (Phase 2)**: depends on Setup — **BLOCKS all user stories** (table, model,
  relations, resource, limiter, shared frontend model).
- **User Stories (Phase 3–6)**: all depend on Foundational. US1 is the read MVP; US2 depends
  on US1's `CommentService`/`CommentController`/`useComments`/`CommentSection` files (same
  files, extended). US3 and US4 extend the same service/controller/hook/`CommentItem` and so
  build on the US1/US2 files, but each remains independently testable.
- **Polish (Phase 7)**: after all desired stories are complete.

### User Story Dependencies

- **US1 (P1, read)**: after Foundational. No dependency on other stories — the MVP floor.
- **US2 (P1, add)**: after Foundational; shares/extends US1's service, controller, hook, and
  section files. Independently testable (post → top-of-list).
- **US3 (P2, hide/unhide)**: after Foundational; needs comments to exist (US1/US2) to
  moderate. Adds the admin controller/routes and extends the service/hook/`CommentItem`.
- **US4 (P2, delete)**: after Foundational; extends the same admin controller and
  service/hook/`CommentItem` as US3. Independently testable (confirmed permanent delete).

### Within Each User Story

- Tests are written first and must FAIL before implementation (superpowers TDD).
- Backend order: migration/model (Foundational) → service method → controller → route.
- Frontend order: `lib` (api/model) → hook → components → `PostPage` wiring.
- Story complete and green before moving to the next priority.

### Parallel Opportunities

- Setup T001/T002 run in parallel.
- Foundational T003–T007, T009, T010/T011 are largely parallel (distinct files); T008
  (provider) is independent too.
- Within a story, all test tasks marked [P] run in parallel (distinct files) before impl.
- Frontend `commentApi.ts` additions (T021/T036/T048/T060) touch the same file across stories
  — sequential within that file, but parallel to backend work of the same story.

---

## Parallel Example: User Story 1

```bash
# Tests first (distinct files, run together, expect FAIL):
Task: "CommentServiceTest list cases in backend/tests/Unit/Services/CommentServiceTest.php"
Task: "CommentControllerTest GET cases in backend/tests/Feature/Http/Controllers/CommentControllerTest.php"
Task: "commentApi.fetchPage test in frontend/tests/lib/commentApi.test.ts"
Task: "useComments load test in frontend/tests/hooks/useComments.test.ts"

# Then implementation — backend chain and frontend components in parallel:
Task: "CommentService::list in backend/app/Services/CommentService.php"
Task: "CommentItem.tsx in frontend/src/components/comments/CommentItem.tsx"
Task: "CommentList.tsx in frontend/src/components/comments/CommentList.tsx"
```

---

## Implementation Strategy

### MVP First (US1 + US2)

1. Phase 1 Setup → Phase 2 Foundational (CRITICAL — blocks everything).
2. Phase 3 US1 (read) → **STOP and VALIDATE** reading works for guests and signed-in users.
3. Phase 4 US2 (add) → validate verified users can post (top-of-list, no reload). This is the
   demonstrable MVP: comments can be read and written.

### Incremental Delivery

1. Foundation ready → US1 (read) → demo.
2. US2 (add) → demo (MVP complete).
3. US3 (hide/unhide) → demo reversible moderation.
4. US4 (delete) → demo permanent deletion + purge cascade.
5. Polish: coverage gates, responsive/theming, quickstart, docs.

### Parallel Team Strategy

After Foundational: one developer can carry the backend chain (service → controllers →
routes) while another builds the frontend (`lib` → hook → components → `PostPage`) per story,
since backend and frontend files are disjoint within each story.

---

## Notes

- [P] = different files, no incomplete-task dependency. `commentApi.ts`,
  `CommentService.php`, `CommentController.php`, `useComments.ts`, and `CommentItem.tsx` are
  each extended across multiple stories — edits to the SAME file are sequential, not [P].
- Tests mirror source under each stack's `tests/` (Principle VII); verify they fail first.
- Body is rendered as a plain-text React child only — never `dangerouslySetInnerHTML` (D10).
- No new npm/Composer dependency (Principle I); the `comments` limiter is app config.
- Commit after each task or logical group; stop at any checkpoint to validate the story.
