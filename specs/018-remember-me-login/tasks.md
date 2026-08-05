---

description: "Task list for 018-remember-me-login"
---

# Tasks: "Remember Me" Login Session Persistence

**Input**: Design documents from `/specs/018-remember-me-login/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/login-endpoint.md, quickstart.md

**Tests**: Included — Constitution Principle VII requires ≥90% line coverage on both stacks
(CI-enforced), and `quickstart.md`'s "Automated coverage" section explicitly calls out the
backend/frontend cases to write here.

**Organization**: Tasks are grouped by user story (US1/US2/US3, priorities from spec.md). No new
database table/column/migration exists for this feature (data-model.md) — the entire mechanism is
two cookies plus request-scoped config, so most production code lives in Foundational; the user
story phases layer the login/logout wiring (US1), expiry/sliding-window proof (US2), and
no-regression proof (US3) on top of it, each independently testable per its own Independent Test
in spec.md.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Path Conventions

Existing decoupled `backend/` (Laravel 12) + `frontend/` (React 18 + Vite) layout — see
plan.md's Project Structure for the exact file list this feature touches.

---

## Phase 1: Setup

**Purpose**: The one new config surface, ahead of everything else that reads it.

- [x] T001 Create `backend/config/remember.php` returning `lifetime` (minutes, default 10080 via
  `REMEMBER_ME_LIFETIME`) and `cookie` (name, default `Str::slug(APP_NAME).'-remember'` via
  `REMEMBER_ME_COOKIE`) — mirrors `config/session.php`'s own pattern (research D6)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared cookie-and-middleware mechanism every user story exercises. No user
story can be implemented or tested until this phase is complete.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 [P] Create `App\Support\RememberMe` in `backend/app/Support/RememberMe.php` with
  static `queue()` (queues the flag cookie via `Cookie::queue()`, value `"1"`,
  `config('remember.lifetime')`) and `forget()` (via `Cookie::forget(config('remember.cookie'))`)
  helpers — matches the existing `App\Support\MediaPath` one-class-of-statics pattern
  (research D2, D6)
- [x] T003 [P] Unit tests for `RememberMe::queue()`/`forget()` in
  `backend/tests/Unit/Support/RememberMeTest.php`
- [x] T004 [P] Add `'remember' => ['sometimes', 'boolean']` to `rules()` in
  `backend/app/Http/Requests/LoginRequest.php` (research D4, data-model.md §3)
- [x] T005 Create `App\Http\Middleware\ApplyRememberMeLifetime` in
  `backend/app/Http/Middleware/ApplyRememberMeLifetime.php` — before the session starts, if
  `$request->hasCookie(config('remember.cookie'))` (presence only, never decrypts — research D3),
  call `config(['session.lifetime' => config('remember.lifetime')])`, then `$next($request)`
- [x] T006 [P] Feature test for `ApplyRememberMeLifetime` in
  `backend/tests/Feature/Http/Middleware/ApplyRememberMeLifetimeTest.php` — raises lifetime when
  the flag cookie is present, leaves it untouched when absent
- [x] T007 Create `App\Http\Middleware\SlideRememberMeCookie` in
  `backend/app/Http/Middleware/SlideRememberMeCookie.php` — after `$next($request)`, if the
  resolved user is authenticated and the flag cookie is present, re-queue it via
  `RememberMe::queue()` so its `Max-Age` resets every authenticated request (research D2 step 3,
  FR-004)
- [x] T008 [P] Feature test for `SlideRememberMeCookie` in
  `backend/tests/Feature/Http/Middleware/SlideRememberMeCookieTest.php` — renews the cookie on an
  authenticated request when present, does nothing when absent or unauthenticated
- [x] T009 Register both middleware in `backend/bootstrap/app.php`: prepend
  `ApplyRememberMeLifetime` to the `api` group *after* `$middleware->statefulApi()` (so it lands
  ahead of Sanctum's own prepended middleware — research D3), and append
  `SlideRememberMeCookie` to the `api` group *after* the existing `EnsureAccountEnabled` (so a
  request that middleware already rejected never gets its cookie renewed)

**Checkpoint**: Config, support class, and both middleware exist and are wired into the pipeline.
Login/logout can now be taught to use `RememberMe`.

---

## Phase 3: User Story 1 - Stay signed in with Remember Me (Priority: P1) 🎯 MVP

**Goal**: A user who checks "Remember me" at login stays signed in across browser restarts and a
multi-day (but under 7) idle gap.

**Independent Test**: Log in with "Remember me" checked, simulate returning after a few days
(under 7) of inactivity, confirm still signed in — no re-authentication required.

### Tests for User Story 1

- [x] T010 [P] [US1] Extend `backend/tests/Feature/Http/Controllers/AuthControllerTest.php`:
  `login` with `remember: true` and valid credentials returns 200, sets the remember cookie
  (`config('remember.cookie')`), and the response's session cookie carries the 7-day lifetime;
  `remember` omitted/`false` sets no remember cookie (baseline for the US3 checkpoint too); a
  disabled account's login attempt with `remember: true` still returns 403 and queues no
  remember cookie (contracts/login-endpoint.md's 403 guarantee, FR-006); `logout` after a
  remembered login clears both the session cookie and the remember cookie in the response
  (FR-005, SC-004 — no test previously covered this transition); and a remember cookie queued
  by one login's response is independent of a second, separate login/request in the same test
  (differing account or `remember` choice) — the second response's cookies are unaffected by
  the first (FR-007, cross-session independence — currently only spot-checked manually in
  quickstart.md)
- [x] T011 [P] [US1] Extend `frontend/tests/pages/LoginPage.test.tsx`: the "Remember me" checkbox
  renders unchecked by default and its state is included in the submitted `login()` call
- [x] T012 [P] [US1] Extend `frontend/tests/lib/authApi.test.ts`: `AuthApi.login` sends
  `remember` straight through in the JSON body

### Implementation for User Story 1

- [x] T013 [US1] In `backend/app/Http/Controllers/AuthController.php::login`, after the existing
  disabled-account check, when `$request->boolean('remember')` call `RememberMe::queue()` and
  `config(['session.lifetime' => config('remember.lifetime')])` before `$request->session()->regenerate()`
  (research D2 step 1, D4)
- [x] T014 [US1] In `AuthController::logout`, call `RememberMe::forget()` alongside the existing
  session teardown (FR-005, research D2 step 4)
- [x] T015 [US1] In `backend/app/Http/Middleware/EnsureAccountEnabled.php`, call
  `RememberMe::forget()` alongside the existing disabled-account teardown (FR-006, research D2
  step 4)
- [x] T016 [P] [US1] Extend `backend/tests/Feature/Http/Middleware/EnsureAccountEnabledTest.php`
  to assert the remember cookie is cleared on the disabled-account 401 path
- [x] T017 [US1] Add a "Remember me" checkbox to `frontend/src/pages/LoginPage.tsx`: local
  `useState(false)`, a real visible `<label>` (not `sr-only` — Principle IV), rendered below the
  password field; `handleSubmit` calls `login({ ...form.values, remember })`
- [x] T018 [US1] Add `remember: boolean` to `LoginInput` in `frontend/src/lib/authApi.ts` and
  pass it straight through in `AuthApi.login`'s JSON body (no new mapping logic — matches every
  other field already there)

**Checkpoint**: User Story 1 is fully functional and independently testable — a remembered login
survives a multi-day idle gap; logging out or disabling the account clears the cookie so it can
never be replayed.

---

## Phase 4: User Story 2 - Remembered session eventually expires from inactivity (Priority: P2)

**Goal**: A remembered session that sees no activity for 7 full days requires signing in again;
activity before then restarts the 7-day countdown.

**Independent Test**: Log in with "Remember me" checked, simulate exactly 7 days of no activity,
confirm the next visit requires signing in again; separately, confirm activity on day 5 restarts
the window (still signed in past the original 7-day mark).

**Note**: The expiry/renewal mechanism itself was built in Phase 2 (T005–T009) and wired in Phase
3 (T013); this phase's tasks are the acceptance-level proof of both halves of FR-004/SC-002 — no
new production code is expected.

### Tests for User Story 2

- [x] T019 [P] [US2] Add a test to `backend/tests/Feature/Http/Middleware/ApplyRememberMeLifetimeTest.php`
  (or a sibling test) proving that once the remembered session's idle time exceeds
  `config('remember.lifetime')`, the next request finds no valid session (matches today's expired-
  session behavior — no remember-specific "still half-alive" state, per data-model.md §4)
- [x] T020 [P] [US2] Extend `backend/tests/Feature/Http/Middleware/SlideRememberMeCookieTest.php`:
  an authenticated request partway through the window re-queues the cookie with a fresh full-length
  `Max-Age`, so a subsequent gap that would have exceeded the *original* window from login still
  finds the session valid (Acceptance Scenario 2 — the sliding restart)

**Checkpoint**: User Stories 1 AND 2 both verified — remembered sessions survive idle gaps under 7
days, slide forward on activity, and lapse at exactly 7 days of true inactivity.

---

## Phase 5: User Story 3 - Default (non-remembered) sign-in is unaffected (Priority: P3)

**Goal**: Logging in without checking "Remember me" behaves byte-for-byte as it did before this
feature — no remember cookie, no lifetime change.

**Independent Test**: Log in without checking "Remember me", confirm the sign-in duration matches
current (pre-feature) behavior.

### Tests for User Story 3

- [x] T021 [P] [US3] Extend `backend/tests/Feature/Http/Controllers/AuthControllerTest.php`:
  login with `remember` omitted (and, separately, explicitly `false`) sets only the session
  cookie, at the default `SESSION_LIFETIME` (120 minutes) — no `config('remember.cookie')` in the
  response at all (SC-003)
- [x] T022 [P] [US3] Extend `frontend/tests/pages/LoginPage.test.tsx`: the checkbox is unchecked
  after remount regardless of a prior login's choice (nothing persists it client-side — spec
  Assumption/Edge Case)

**Checkpoint**: All three user stories independently functional — remembered sessions persist and
slide, then expire on true inactivity; non-remembered sessions are provably unchanged.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification across all stories.

- [ ] T023 [P] Run the manual scenarios in `specs/018-remember-me-login/quickstart.md` (US1, US2,
  US3, and the four edge-case spot-checks — manual sign-out, disabled account, cross-device
  independence, checkbox never pre-filled) against the running Docker stack
- [ ] T024 Confirm the ≥90% Clover/coverage gate still passes for both stacks (Constitution
  Principle VII) — `docker compose exec backend php artisan test --coverage` and
  `npm run test -- --coverage` (frontend)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup (T001's config values are read by T005–T008) —
  BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational — delivers the MVP
- **User Story 2 (Phase 4)**: Depends on Foundational AND on US1's T013 (the login endpoint must
  actually set `remember.lifetime` before expiry/sliding behavior can be exercised) — not
  independent of US1 in implementation, though its *tests* target distinct acceptance criteria
- **User Story 3 (Phase 5)**: Depends on Foundational AND on US1's T013 (same reason — proving the
  "unaffected" baseline requires the `remember` branch to exist so the omitted-case path can be
  exercised against it); genuinely independent of US2
- **Polish (Phase 6)**: Depends on all three user stories being complete

### Within Each User Story

- Tests are written first (T010–T012, T019–T020, T021–T022) and should fail before their
  corresponding implementation task
- Foundational middleware (T005, T007) before the controller/frontend wiring that depends on them
  (T013, T017)

### Parallel Opportunities

- T002, T003, T004 (Phase 2) can run in parallel — different files, no dependencies
- T006 and T008 (Phase 2) can run in parallel once T005/T007 exist, and with each other
- T010, T011, T012 (Phase 3 tests) can run in parallel
- T016 can run in parallel with T017/T018 (different files)
- T019 and T020 (Phase 4) can run in parallel
- T021 and T022 (Phase 5) can run in parallel

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Launch independent Foundational tasks together:
Task: "Create RememberMe support class in backend/app/Support/RememberMe.php"
Task: "Unit tests for RememberMe in backend/tests/Unit/Support/RememberMeTest.php"
Task: "Add remember validation rule to LoginRequest in backend/app/Http/Requests/LoginRequest.php"
```

## Parallel Example: User Story 1 tests

```bash
Task: "Extend AuthControllerTest.php with remember-me login, logout, disabled-account, and
  cross-session cases"
Task: "Extend LoginPage.test.tsx with checkbox rendering/submit cases"
Task: "Extend authApi.test.ts with remember pass-through case"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 2: Foundational (T002–T009) — CRITICAL, blocks all stories
3. Complete Phase 3: User Story 1 (T010–T018)
4. **STOP and VALIDATE**: run the US1 scenario from quickstart.md independently
5. Deploy/demo if ready — this alone is the feature's entire value proposition

### Incremental Delivery

1. Setup + Foundational → mechanism ready, nothing user-visible yet
2. Add US1 → test independently → deploy/demo (MVP — remember-me works end to end)
3. Add US2 → test independently → deploy/demo (expiry/sliding-window proof)
4. Add US3 → test independently → deploy/demo (no-regression proof)
5. Polish (T023–T024)

---

## Notes

- No new database table/column/migration — verify no task above accidentally introduces one
- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Commit after each task or logical group (per `speckit-git-commit` hook / project convention)
- Stop at any checkpoint to validate a story independently
