# Tasks: Authentication (Full-Stack — Auth API + Login/Register/Account UI)

**Input**: Design documents from `/specs/007-auth-ui/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — Constitution Principle VII mandates ≥90% coverage. Backend: all of
`app/` is in the coverage scope (`phpunit.xml`), so each endpoint is covered by a
Feature test written **before** its controller method (fail-first), plus a Unit test for
`UserService`. Frontend: the pure `src/lib` layer (`authApi`, `authModel`) is unit-tested
test-first under `tests/lib/**` (the ≥90% scope); pages, the `useAuth` context, and route
guards are thin glue verified per the constitution's manual-verification gate
(quickstart.md scenarios).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: US1 (Register), US2 (Login/Logout), US3 (Account), US4 (Routes/redirects),
  US5 (a11y/theme/responsive). Setup/Foundational/Polish carry no story label.
- Paths are relative to the repo root. This feature touches **both** `backend/` and
  `frontend/`.

## Path Conventions

Decoupled two-app layout. Backend source in `backend/app/`, mirrored tests in
`backend/tests/`; frontend source in `frontend/src/`, mirrored tests in `frontend/tests/`.

Run gates through Docker (no local PHP/Node):
- Backend: `docker compose exec backend vendor/bin/pint --test`,
  `docker compose exec backend php artisan test`, coverage via
  `php -d pcov.enabled=1 vendor/bin/phpunit --coverage-clover backend/coverage.clover`
  then `python .github/scripts/check_coverage.py backend/coverage.clover 90`.
- Frontend: `docker compose exec frontend npm run lint`,
  `docker compose exec frontend npx vitest run --coverage` (`src/lib/**` ≥90%).
- **Restart `backend` after PHP/config edits** (opcache `validate_timestamps=0`):
  `docker compose restart backend`.

---

## Phase 1: Setup

**Purpose**: Confirm a green baseline so new failures are attributable to this feature.

- [x] T001 Start the stack (`docker compose up -d`) and confirm baseline green: backend `vendor/bin/pint --test` clean and `php artisan test` passing; frontend `npm run lint` clean and `npx vitest run --coverage` passing with `src/lib/**` ≥90% (no file changes; see specs/007-auth-ui/quickstart.md)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared, blocking infrastructure every story builds on — Sanctum SPA wiring
on the backend, the safe user output resource, the pure coverage-gated frontend auth lib
(written test-first), and the auth context + guards shell. **No user story can begin
until this phase is complete.**

### Backend infrastructure

- [x] T002 Add `laravel/sanctum` to `backend/composer.json` `require` and install it in the container (`docker compose exec backend composer require laravel/sanctum`); record the one-line rationale (constitutional baseline auth stack) — per specs/007-auth-ui/research.md D2
- [x] T003 Configure Sanctum SPA mode: publish `backend/config/sanctum.php` and `backend/config/cors.php`; set `cors.php` `supports_credentials => true` with paths covering `api/*` and `sanctum/csrf-cookie`; enable `$middleware->statefulApi()` in `backend/bootstrap/app.php`; add `SANCTUM_STATEFUL_DOMAINS`, `SESSION_DOMAIN`, and frontend origin keys to `backend/.env` and `backend/.env.example` (per specs/007-auth-ui/research.md D6, contracts/auth-api.md). Then `docker compose restart backend`
- [x] T004 [P] Create `backend/app/Http/Resources/UserResource.php` returning only `{ id, name, email, created_at, updated_at }` (no password/remember_token) per specs/007-auth-ui/data-model.md and contracts/auth-api.md

### Frontend pure lib (test-first) + shell

- [x] T005 [P] Create `frontend/tests/lib/authApi.test.ts` with failing tests: each function sends `credentials:'include'` + `Accept: application/json` and (for unsafe methods) `X-XSRF-TOKEN`; `register` 201→`{ok:true,user}`, 422→`{kind:'validation',errors}`, else→`{kind:'network'}`; `login` 200→ok, 401→`{kind:'auth'}`, 422→validation; `fetchCurrentUser` returns the user for `{data:{...}}`, `null` for `{data:null}` and for 401, `null` on network failure; `mapUser` snake→camel (per specs/007-auth-ui/contracts/frontend.md)
- [x] T006 [P] Create `frontend/tests/lib/authModel.test.ts` with failing tests: `validateRegister`/`validateLogin` field rules (required, email shape, password min-8/mixed-case/number, confirmation match) returning a field-error map; `mergeServerErrors` (server wins); auth status transitions (`unknown`→`anonymous`/`authenticated`, `authenticated`+401→`anonymous`) per specs/007-auth-ui/data-model.md
- [x] T007 [P] Create `frontend/src/lib/authApi.ts` (types `AuthUser`/`FieldErrors`/`AuthResult`, `mapUser`, `csrf`, `register`, `login`, `logout`, `fetchCurrentUser`) per contracts/frontend.md — reuse the existing `apiBase()` convention from `frontend/src/lib/api.ts`; all requests credentialed
- [x] T008 [P] Create `frontend/src/lib/authModel.ts` (`AuthStatus`, `validateRegister`, `validateLogin`, `mergeServerErrors`, form-state helpers) per specs/007-auth-ui/data-model.md
- [x] T009 Run `docker compose exec frontend npx vitest run --coverage` — the T005/T006 suites now pass and `src/lib/**` coverage stays ≥90%
- [x] T010 Create `frontend/src/hooks/useAuth.ts`: context provider holding `{status,user}`, calls `fetchCurrentUser` on mount (`unknown`→resolved), exposes `login`/`register`/`logout`; a 401 flips state to `anonymous` (thin glue; per contracts/frontend.md, research D7)
- [x] T011 [P] Create `frontend/src/components/RequireAuth.tsx` and `frontend/src/components/RequireAnon.tsx`: treat `unknown` as "resolving" (neutral placeholder, no redirect); `RequireAuth` anon→`<Navigate to="/login">`; `RequireAnon` authed→`<Navigate to="/">` (per contracts/routes.md)
- [x] T012 Edit `frontend/src/App.tsx`: wrap routes in the `useAuth` provider; add `/login` and `/register` under `RequireAnon` and `/account` under `RequireAuth`; leave `/`, `/posts/:hash`, `*` unchanged (per contracts/routes.md)

> **Sequencing note (impl):** T010–T012 (useAuth context, RequireAuth/RequireAnon guards,
> App provider + route wiring) are bundled into **US1** rather than committed here — they
> have no consumer until the first page exists, and wiring `/login`·`/register`·`/account`
> routes before those pages would not build. The pure lib (T005–T009) and backend infra
> (T002–T004) are the committed Foundational checkpoints.

**Checkpoint**: Backend boots with Sanctum SPA + CSRF; the auth lib is fully tested.
The auth context, guards, and route wiring land with their first consumer in US1.

---

## Phase 3: User Story 1 - Register a new account (Priority: P1) 🎯 MVP

**Goal**: A visitor registers (name/email/password+confirm) and becomes logged in;
invalid input shows clear per-field errors and creates no account.

**Independent Test**: `POST /api/register` with valid data → 201 + session established +
`GET /api/user` returns the user; invalid data → 422 with field errors and no user. In
the UI, `/register` with valid data lands logged in; with invalid data shows inline
errors (quickstart US1).

- [x] T013 [P] [US1] Create `backend/app/Http/Requests/RegisterRequest.php` with rules: `name` required|string|max:255; `email` required|email|unique:users|max:255; `password` required|string|min:8 + mixed case + number + confirmed (per specs/007-auth-ui/data-model.md, research D3)
- [x] T014 [P] [US1] Create `backend/tests/Unit/Services/UserServiceTest.php` (RefreshDatabase) with failing tests: `create()` persists a user with a **hashed** password (not plaintext) and returns it; duplicate email surfaces a unique-constraint error path (per data-model.md)
- [x] T015 [US1] Create `backend/app/Services/UserService.php` `create(array $data): User` that hashes the password and persists the user (Eloquent; mirrors the prototype's UserService minus the unused `hash`/Registered-event scope) — make T014 pass
- [x] T016 [US1] Create `backend/tests/Feature/Http/Controllers/AuthControllerTest.php` with failing register cases: valid input → 201 `{data:{id,name,email,...}}`, no password field in the response, user row created and authenticated; duplicate email → 422 with `errors.email`; weak password and mismatched confirmation → 422; (per contracts/auth-api.md, SC-001/SC-002/SC-009)
- [x] T017 [US1] Create `backend/app/Http/Controllers/AuthController.php` with `register(RegisterRequest)`: create via `UserService`, log the user in (establish session), return `UserResource` with 201; register the `POST /api/register` route in `backend/routes/api.php`; `docker compose restart backend` — make T016 register cases pass
- [x] T018 [US1] Create `frontend/src/pages/RegisterPage.tsx`: labeled name/email/password/confirm inputs, client `validateRegister` then `register()`, inline field errors (merging server 422), disable submit while pending, never repopulate password (thin glue; contracts/frontend.md)
- [x] T019 [US1] Validation: register **SPA path verified end-to-end** via the real Sanctum flow (GET /sanctum/csrf-cookie → credentialed POST /api/register with X-XSRF-TOKEN → **HTTP 201**, user created, safe profile, no password) — proves CSRF/session/CORS/cookie config. Frontend code green (ESLint/tsc/build/127 unit tests). Note: authed-nav "Account+Logout" + dup/weak/mismatch inline errors get a consolidated **browser e2e pass at Polish (T039)** once US2/US3 add login/logout/account. An earlier curl 419 was a test-script URL-decode bug, not an app fault.

**Checkpoint**: Registration works end-to-end — MVP demonstrable.

---

## Phase 4: User Story 2 - Log in and log out (Priority: P1)

**Goal**: A returning user logs in; wrong credentials give one non-disclosing error; a
logged-in user logs out and the app returns to anonymous.

**Independent Test**: `POST /api/login` correct→200+session, wrong→401 generic;
`POST /api/logout`→session revoked. In the UI, valid/invalid login behave accordingly,
and logout returns the anonymous state (quickstart US2/US3-logout).

- [x] T020 [P] [US2] Create `backend/app/Http/Requests/LoginRequest.php` with rules: `email` required|email; `password` required|string — **no** `exists` rule (anti-enumeration, research D5)
- [x] T021 [US2] Extend `backend/tests/Feature/Http/Controllers/AuthControllerTest.php` with failing cases: correct credentials → 200 + authenticated; wrong email and wrong password each → 401 with the **same** generic message (no disclosure); malformed body → 422; `logout` while authenticated → 200 and subsequent `GET /api/user` is anonymous; `logout` while anonymous → 401 (contracts/auth-api.md, SC-003/SC-004)
- [x] T022 [US2] Add `login(LoginRequest)` and `logout(Request)` to `backend/app/Http/Controllers/AuthController.php` (attempt auth, regenerate session on success, generic 401 on failure; logout invalidates session) and register `POST /api/login` and `POST /api/logout` (logout behind `auth:sanctum`) in `backend/routes/api.php`; `docker compose restart backend` — make T021 pass
- [x] T023 [US2] Create `frontend/src/pages/LoginPage.tsx`: labeled email/password, client `validateLogin` then `login()`, generic auth-error banner on 401, retryable banner on network error, submit guard, password never repopulated (thin glue; contracts/frontend.md)
- [x] T024 [US2] Edit `frontend/src/components/NavMenu.tsx`: anonymous → Login/Register; authenticated → Account link + Logout control wired to `useAuth().logout` (treat `unknown` as not-yet-authed; no flicker) per contracts/frontend.md
- [x] T025 [US2] Manual validation per quickstart US2/US3: valid login → logged in; wrong creds → one generic error (no email/password disclosure); Logout → anonymous and `/account` now redirects to `/login`

**Checkpoint**: Full login/logout loop works; the core auth cycle is complete.

---

## Phase 5: User Story 3 - View the account page (Priority: P2)

**Goal**: A logged-in user sees their own name + email and a logout control; the page is
URL-addressable and survives refresh while the session is valid.

**Independent Test**: authenticated `GET /api/user` → the user; anonymous → null/401.
In the UI, `/account` shows name+email + Logout; refresh keeps you logged in (quickstart US3).

- [x] T026 [US3] Extend `backend/tests/Feature/Http/Controllers/AuthControllerTest.php` with failing `user` cases: authenticated → 200 `{data:{id,name,email,...}}` (no secrets); anonymous → the agreed anonymous shape (`200 {data:null}`) per contracts/auth-api.md FR-005
- [x] T027 [US3] Add `user(Request)` to `backend/app/Http/Controllers/AuthController.php` returning `UserResource` when `$request->user()` is present and `{data:null}` otherwise; register `GET /api/user` in `backend/routes/api.php` (not behind `auth:sanctum`, so anonymous returns null not 401); `docker compose restart backend` — make T026 pass
- [x] T028 [US3] Create `frontend/src/pages/AccountPage.tsx`: render `useAuth().user` name + email and a Logout button (→ `logout` then redirect home), inside the shared layout (thin glue; contracts/frontend.md)
- [x] T029 [US3] Manual validation per quickstart US3: `/account` while logged in shows your name + email and Logout; refresh keeps you logged in (FR-013); after logout, `/account` redirects to `/login`

**Checkpoint**: The account view is complete and refresh-safe.

---

## Phase 6: User Story 4 - Deep-linkable auth routes with redirect rules (Priority: P2)

**Goal**: `/login`, `/register`, `/account` are real, refresh-safe URLs with the redirect
rules enforced and native Back/Forward.

**Independent Test**: open each auth URL directly in both auth states and confirm the
correct view or redirect; refresh restores; Back/Forward behave (quickstart US4).

- [x] T030 [US4] Verify/finish the guard wiring from Foundational against contracts/routes.md: anonymous `/account` → `/login`; authenticated `/login` or `/register` → `/`; the `unknown` gate prevents a flash-redirect on refresh of `/account`; fix any gap found
- [x] T031 [US4] Manual validation per quickstart US4/SC-005: anonymous `/account`→`/login`; authenticated `/login` and `/register`→`/`; refresh each route restores correctly from the URL alone; Back/Forward across a login transition restores views without re-exposing a protected page after logout

**Checkpoint**: Navigation is browser-native and the redirect matrix holds.

---

## Phase 7: User Story 5 - Accessible, themed, responsive auth forms (Priority: P3)

**Goal**: All three forms are labeled, error-accessible, follow `prefers-color-scheme`,
and reflow 320px→desktop with adequate touch targets.

**Independent Test**: keyboard/AT traversal with labels + `aria` error association;
OS light/dark followed; no horizontal scroll/clipping at ~320px/tablet/desktop (quickstart US5).

- [x] T032 [P] [US5] Extend `frontend/src/styles/theme.css` with auth-form rules: fluid `max-width` form column, labeled-field and error-text styles, adequate touch-target sizing; verify both light and dark `prefers-color-scheme` palettes (FR-016/FR-017)
- [x] T033 [US5] Ensure every input across LoginPage/RegisterPage/AccountPage has an associated `<label>` and each error uses `aria-invalid` + `aria-describedby` with text (not color-only) cues; logical focus order (FR-015)
- [x] T034 [US5] Manual a11y/responsive validation per quickstart US5/SC-007/SC-008: labels + tab order + announced errors on all three pages; theme follows OS light/dark; no horizontal scroll/clipping/overlap at ~320px, tablet, desktop; controls tap-operable

**Checkpoint**: All five stories functional, accessible, themed, responsive.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final gates — full automated suites, conventions, security spot-check, and
the end-to-end quickstart pass.

- [ ] T035 Backend gate: `docker compose exec backend vendor/bin/pint --test` clean; `php -d pcov.enabled=1 vendor/bin/phpunit --coverage-clover backend/coverage.clover` then `python .github/scripts/check_coverage.py backend/coverage.clover 90` — total `app/` coverage ≥90% (add tests for any uncovered branch in AuthController/UserService/Requests/Resource)
- [ ] T036 Frontend gate: `docker compose exec frontend npm run lint` clean and `docker compose exec frontend npx vitest run --coverage` with `src/lib/**` ≥90%
- [ ] T037 Run the lint-reviewer conventions check over all changed backend + frontend files against docs/CODING_CONVENTIONS.md (PHP: PSR-12, 4-space, `declare(strict_types=1)`, fns <30 lines; TS: 2-space, semicolons, `is/has/should`, fns <50 lines; comments explain *why*) and fix findings
- [ ] T038 Security spot-check (SC-009): inspect every auth response — no `password`/hash/remember_token field appears; confirm login error is identical for wrong-email vs wrong-password; confirm secrets/origins are env-only (no committed `.env`)
- [ ] T039 Full quickstart pass: execute every scenario in specs/007-auth-ui/quickstart.md end-to-end (register, login, logout, account, redirects, refresh, a11y, responsive, theme) and spot-check the success criteria

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately.
- **Foundational (Phase 2)**: depends on Setup. **BLOCKS all stories.** Backend infra
  (T002→T003, T004 parallel) and frontend lib (T005/T006 tests → T007/T008 impl → T009
  gate → T010→T011→T012) can proceed in parallel across stacks.
- **US1 (Phase 3)**: depends on Foundational. T013/T014 [P] → T015 → T016 → T017 → T018 → T019.
- **US2 (Phase 4)**: depends on Foundational + US1's AuthController existing. T020 → T021 → T022 → T023 → T024 → T025.
- **US3 (Phase 5)**: depends on Foundational + AuthController. T026 → T027 → T028 → T029.
- **US4 (Phase 6)**: depends on Foundational (guards) + at least US1/US2 for live auth states. T030 → T031.
- **US5 (Phase 7)**: depends on the three pages existing (US1–US3). T032 [P] → T033 → T034.
- **Polish (Phase 8)**: depends on all stories. T035/T036 [P] → T037 → T038 → T039.

### User Story Dependencies

- **US1 (P1)**: only Foundational — independently testable MVP.
- **US2 (P1)**: extends US1's AuthController (same file) → sequential after US1.
- **US3 (P2)**: extends AuthController + uses `useAuth.user`.
- **US4 (P2)**: validates the guards built in Foundational against live auth states.
- **US5 (P3)**: cross-cutting presentation pass over the three pages.

### Parallel Opportunities

- Across stacks in Foundational: backend T002–T004 ∥ frontend T005–T008.
- T005 ∥ T006 (different test files); T007 ∥ T008 (different source files).
- T013 (RegisterRequest) ∥ T014 (UserServiceTest).
- AuthController is one file edited by US1/US2/US3 → those backend edits are sequential.
- Polish T035 (backend) ∥ T036 (frontend).

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup (baseline green) → Phase 2 Foundational (Sanctum + tested lib + shell).
2. Phase 3 US1 → **STOP and VALIDATE** registration end-to-end. Registration + auto-login
   is a demonstrable MVP slice.

### Incremental Delivery

Setup + Foundational → US1 (register) → US2 (login/logout) → US3 (account) → US4
(redirect rules) → US5 (a11y/theme/responsive) → Polish (full gates). Validate at each
story checkpoint; commit after each task or logical group.

---

## Notes

- New dependency: `laravel/sanctum` only — the constitutional baseline auth stack, logged
  in plan Complexity Tracking (Principle I). No frontend dependency added.
- Backend code is entirely in the coverage scope (`app/`) → every new class needs tests to
  hold ≥90%. Frontend pages/hooks/guards are intentionally outside the `src/lib` coverage
  scope; their behavior is pinned by contracts + the quickstart manual gates.
- Restart `backend` after every PHP/config edit (opcache). Restart `frontend` if Vite
  serves stale modules after a merge/checkout.
- 39 tasks: 1 setup + 11 foundational + 7 (US1) + 6 (US2) + 4 (US3) + 2 (US4) + 3 (US5) +
  5 polish.
