# Tasks: Registration Email Verification

**Input**: Design documents from `/specs/008-register-email-verification/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D9), data-model.md,
contracts/verification-api.md, contracts/frontend.md, quickstart.md

**Tests**: Included — Constitution Principle VII mandates ≥90% mirrored coverage
on both stacks, and the plan's Testing section commits to specific test files.
Write each story's tests first and watch them fail before implementing.

**Organization**: Tasks are grouped by user story so each story is independently
implementable and testable. Backend PHP runs through Docker (`php:8.3-cli`
image / `docker compose exec backend`) — there is no local PHP. Backend tests
run on SQLite `:memory:` only, with `Notification::fake()` for mail. After
editing backend PHP against the running dev stack, `docker compose restart
backend` (opcache holds timestamps).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story the task belongs to (US1, US2, US3)

## Path Conventions

Web app — `backend/` (Laravel 12 API) + `frontend/` (React 18 + Vite SPA), per
plan.md. Tests mirror source: `backend/tests/{Feature,Unit}/...` and
`frontend/tests/...` (the Vitest coverage gate spans ALL of `frontend/src/`).

---

## Phase 1: Setup (config & environment)

**Purpose**: Environment/config groundwork every story's email link depends on.

- [X] T001 [P] Add `FRONTEND_URL=http://localhost:5173` to `backend/.env.example` (with a *why* comment: the verification email links to the SPA, not the API) and mirror it into the running dev `backend/.env`
- [X] T002 [P] Add `FRONTEND_URL=http://localhost:5174` and confirm `MAIL_MAILER=log` in `backend/.env.e2e`
- [X] T003 [P] Set `'verification' => ['expire' => 1440]` (24 h, FR-002/D5) in `backend/config/auth.php`

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: The verification record and its exposure — every story reads
`email_verified_at` through the API and the SPA's `AuthUser`.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 [P] Extend `backend/tests/Feature/Http/Controllers/AuthControllerTest.php`: register/login/`GET /api/user` payloads include `email_verified_at` (`null` for a fresh registrant; ISO timestamp for a verified user) — must fail first
- [X] T005 [P] Extend `frontend/tests/lib/authApi.test.ts`: `AuthUser` carries `emailVerifiedAt: string | null` mapped from the API's `email_verified_at` — must fail first
- [X] T006 Make `User` implement `MustVerifyEmail` in `backend/app/Models/User.php` (data-model: enables `hasVerifiedEmail()` / `markEmailAsVerified()` / `sendEmailVerificationNotification()`; no attribute changes)
- [X] T007 Expose `email_verified_at` in `backend/app/Http/Resources/UserResource.php` (contract: verification-api.md "Changed payloads") — T004 goes green
- [X] T008 Add `emailVerifiedAt: string | null` to `AuthUser` and its response mapping in `frontend/src/lib/authApi.ts` — T005 goes green

**Checkpoint**: Verification state is readable end-to-end — user stories can begin.

---

## Phase 3: User Story 1 — Verify a new account via email (Priority: P1) 🎯 MVP

**Goal**: Registration creates an unverified account, sends a signed 24-h
verification email linking to `{FRONTEND_URL}/verify-email/{hash}?expires&signature`
(no ids in the URL — D3), the registrant lands on the `/verify-email` notice
page naming their address, and opening the link marks the account verified with
a confirmation page. Idempotent re-use; links survive sign-in (return-to login).

**Independent Test**: Register a fresh account, pull the link from
`storage/logs/laravel.log`, open it, and confirm `email_verified_at` flips from
`NULL` to now and the confirmation page shows (quickstart Scenarios 1, 2, 4).

### Tests for User Story 1 (write first — must fail)

- [X] T009 [P] [US1] Create `backend/tests/Feature/Http/Controllers/EmailVerificationControllerTest.php` covering `GET /api/email/verify/{hash}`: valid link → 200, `email_verified_at` set, `meta.already_verified: false`, `Verified` event fired; already-verified → 200, `meta.already_verified: true`, timestamp unchanged (FR-005); expired (time-travel past 24 h) → 403, state unchanged; tampered signature → 403; `{hash}` of a *different* user's email → 403 (cross-account edge case); anonymous → 401; 7th hit within a minute → 429
- [X] T010 [P] [US1] Extend `backend/tests/Feature/Http/Controllers/AuthControllerTest.php`: register dispatches the `VerifyEmail` notification to the new user (`Notification::fake()`); register still returns 201 when notification dispatch throws a transport exception (FR-011)
- [X] T011 [P] [US1] Extend `frontend/tests/lib/authApi.test.ts`: `AuthApi.verifyEmail` outcomes — 200 fresh (`{ok:true, alreadyVerified:false}`), 200 already, 403 → `invalid`, 429 → `rate-limited`, fetch failure → `network`
- [X] T012 [P] [US1] Extend `frontend/tests/lib/authModel.test.ts`: `parseVerifyParams` (valid → `VerifyEmailInput`; missing/blank hash, expires, or signature → `null`) and verify-result → `verifying/confirmed/already/failed` view-state mapping
- [X] T013 [P] [US1] Extend `frontend/tests/hooks/useAuth.test.tsx` and `frontend/tests/components/AuthProvider.test.tsx`: context `refresh()` re-probes `/api/user` and updates `emailVerifiedAt`
- [X] T014 [P] [US1] Extend `frontend/tests/components/RequireAuth.test.tsx` (redirects to `/login` carrying the blocked location in router state) and `frontend/tests/pages/LoginPage.test.tsx` (on success navigates to `state.from ?? '/'`) — D9
- [X] T015 [P] [US1] Extend `frontend/tests/pages/RegisterPage.test.tsx`: successful registration navigates to `/verify-email` (FR-007)
- [X] T016 [P] [US1] Create `frontend/tests/pages/VerifyEmailNoticePage.test.tsx`: names the signed-in user's address in text; already-verified visitor sees "already verified" + link to `/account` instead of the notice
- [X] T017 [P] [US1] Create `frontend/tests/pages/VerifyEmailPage.test.tsx`: `verifying` while in flight; `confirmed` on 200 fresh (and auth `refresh()` called); `already` on 200 already-verified; `failed` on 403; malformed params render `failed` without issuing a request

### Backend implementation for User Story 1

- [X] T018 [P] [US1] Create `backend/app/Http/Requests/VerifyEmailRequest.php`: `authorize()` = `hash_equals(sha1(authenticated user's email), route('hash'))` — the in-house replacement for the stock id-based `EmailVerificationRequest` (D3, no ids in URLs)
- [X] T019 [US1] Create `backend/app/Http/Controllers/EmailVerificationController.php` with `verify(VerifyEmailRequest)`: if unverified, `markEmailAsVerified()` + `event(new Verified($user))`; respond 200 `{data: UserResource, meta: {already_verified}}` per contracts/verification-api.md (depends on T018)
- [X] T020 [US1] Register `GET /email/verify/{hash}` in `backend/routes/api.php`, name `verification.verify`, middleware `auth:sanctum`, `signed:relative`, `throttle:6,1` (depends on T019)
- [X] T021 [US1] In `backend/app/Providers/AppServiceProvider.php` `boot()`, wire `VerifyEmail::createUrlUsing` to a **static class method** (not a closure — conventions) that builds a *relative* temporary signed URL for `verification.verify` (expiry from `auth.verification.expire`) and emits `{FRONTEND_URL}/verify-email/{hash}?expires&signature` (D3; depends on T020 for the route name)
- [X] T022 [US1] In `backend/app/Http/Controllers/AuthController.php` `register()`, call `$user->sendEmailVerificationNotification()` inside try/catch with `report()` on failure — registration always returns 201 (FR-011, D4) — T009/T010 go green

### Frontend implementation for User Story 1

- [X] T023 [P] [US1] Add `AuthApi.verifyEmail(input: VerifyEmailInput): Promise<VerifyEmailResult>` (GET with `credentials: 'include'`, typed outcomes per contracts/frontend.md) in `frontend/src/lib/authApi.ts` — T011 goes green
- [X] T024 [P] [US1] Add `AuthModel.parseVerifyParams` and verify-result → view-state mapping helpers in `frontend/src/lib/authModel.ts` — T012 goes green
- [X] T025 [US1] Implement `refresh(): Promise<void>` in `frontend/src/components/AuthProvider.tsx` and expose it via the context type in `frontend/src/hooks/useAuth.ts` — T013 goes green
- [X] T026 [P] [US1] Edit `frontend/src/components/RequireAuth.tsx`: `<Navigate to="/login" replace state={{ from: location }} />` — T014 (guard half) goes green
- [X] T027 [US1] Edit `frontend/src/pages/LoginPage.tsx`: on success navigate to `state.from ?? '/'` (D9) — T014 (login half) goes green
- [X] T028 [US1] Edit `frontend/src/pages/RegisterPage.tsx`: on success navigate to `/verify-email`; success notice mentions checking email (FR-007) — T015 goes green
- [X] T029 [US1] Create `frontend/src/pages/VerifyEmailNoticePage.tsx`: "check your inbox at {email}" from auth context, status in text (Principle IV); already-verified variant links to `/account` (resend button arrives in US2) — T016 goes green
- [X] T030 [US1] Create `frontend/src/pages/VerifyEmailPage.tsx`: on mount parse `:hash` + `expires`/`signature` via `AuthModel.parseVerifyParams`, call `AuthApi.verifyEmail`, render `verifying/confirmed/already/failed`; call auth `refresh()` on `confirmed`; outcomes announced accessibly (`aria-live`) (depends on T023–T025) — T017 goes green
- [X] T031 [US1] Add `RequireAuth`-wrapped routes `/verify-email` → `VerifyEmailNoticePage` and `/verify-email/:hash` → `VerifyEmailPage` in `frontend/src/App.tsx` (depends on T029, T030)
- [X] T032 [P] [US1] Extend `frontend/src/styles/theme.css` with verification status/notice styles for both light and dark schemes (Principle IV)

### E2E for User Story 1

- [X] T033 [P] [US1] Create `frontend/e2e/helpers/mailLog.ts`: read `backend/storage/logs/laravel.log`, decode quoted-printable (`=3D`, `=` soft line breaks), return the newest `/verify-email/...` URL, filterable by recipient (D7, in-house — no new deps)
- [X] T034 [US1] Create `frontend/e2e/verify-email.spec.ts`: register unique user → lands on `/verify-email` naming the address → extract link via `mailLog.ts` → open it → confirmation shown → reload the link URL shows "already verified" (FR-005); second case: open a valid link in a signed-out context → `/login` → sign in → returned to the link and verified (spec scenario 4) (depends on T033)

**Checkpoint**: Register → email → verify → confirmation works end-to-end — MVP.

---

## Phase 4: User Story 2 — Request a new verification message (Priority: P2)

**Goal**: Signed-in unverified users can request a fresh verification message
(rate-limited 6/min); expired/invalid link landings offer the resend path.

**Independent Test**: Register, ignore the first message, trigger resend, and
verify with the newly delivered link; 7 rapid resends yield a clear 429 message
(quickstart Scenario 3).

### Tests for User Story 2 (write first — must fail)

- [X] T035 [P] [US2] Extend `backend/tests/Feature/Http/Controllers/EmailVerificationControllerTest.php` for `POST /api/email/verification-notification`: unverified user → 200 `{message}` and a fresh `VerifyEmail` notification (`Notification::fake()`); already-verified → 409, nothing sent; anonymous → 401; 7th request within a minute → 429 (FR-006)
- [X] T036 [P] [US2] Extend `frontend/tests/lib/authApi.test.ts` (`AuthApi.resendVerification` outcomes: 200 `sent`, 409 `already-verified`, 429 `rate-limited`, fetch failure `network`) and `frontend/tests/lib/authModel.test.ts` (resend-result → user feedback mapping, incl. "try again in a minute" for 429)
- [X] T037 [P] [US2] Extend `frontend/tests/pages/VerifyEmailNoticePage.test.tsx` (resend button: success/already/rate-limited/network feedback announced; button disabled while in flight) and `frontend/tests/pages/VerifyEmailPage.test.tsx` (`failed` state offers the resend action, FR-004)

### Implementation for User Story 2

- [X] T038 [US2] Add `send()` to `backend/app/Http/Controllers/EmailVerificationController.php`: already verified → 409 `{message: "Email already verified."}`; otherwise `sendEmailVerificationNotification()` → 200 `{message: "Verification link sent."}` per contracts/verification-api.md
- [X] T039 [US2] Register `POST /email/verification-notification` in `backend/routes/api.php`, middleware `auth:sanctum`, `throttle:6,1` (depends on T038) — T035 goes green
- [X] T040 [US2] Add `AuthApi.resendVerification(): Promise<ResendResult>` (POST via the existing CSRF-aware path) in `frontend/src/lib/authApi.ts` and the resend feedback mapping in `frontend/src/lib/authModel.ts` — T036 goes green
- [X] T041 [US2] Add the resend button to `frontend/src/pages/VerifyEmailNoticePage.tsx` (labeled, disabled in flight, outcome announced via the existing notice/`aria-live` pattern) (depends on T040) — T037 (notice half) goes green
- [X] T042 [US2] Add the resend action to the `failed` state of `frontend/src/pages/VerifyEmailPage.tsx` (FR-004: clear explanation + path to a new message) (depends on T040) — T037 (landing half) goes green
- [X] T043 [US2] Extend `frontend/e2e/verify-email.spec.ts`: register → discard first link → press resend on the notice page → extract the *newest* link → verify with it (quickstart Scenario 3)

**Checkpoint**: Users who missed or outlived their first link can recover unaided.

---

## Phase 5: User Story 3 — Verification status on the account page (Priority: P3)

**Goal**: `/account` states the email's verification status in text and offers
the resend action only while unverified (FR-008).

**Independent Test**: Sign in unverified → account page says "Not verified" and
offers resend; verify → page says "Verified" with no resend control
(quickstart Scenario 5).

### Tests for User Story 3 (write first — must fail)

- [X] T044 [P] [US3] Extend `frontend/tests/pages/AccountPage.test.tsx`: unverified user sees "Not verified" **as text** plus a labeled resend button with the shared outcome handling; verified user sees "Verified" and no resend control

### Implementation for User Story 3

- [X] T045 [US3] Add an "Email verification" row to the details list in `frontend/src/pages/AccountPage.tsx`: status from `useAuth().user.emailVerifiedAt`, resend button reusing `AuthApi.resendVerification` + the `AuthModel` feedback mapping (depends on US2's T040 for the resend action; the status text alone needs only Phase 2) — T044 goes green
- [X] T046 [US3] Extend `frontend/e2e/verify-email.spec.ts`: before verifying, `/account` shows "Not verified"; after the verify flow, `/account` shows "Verified" with no resend button

**Checkpoint**: All three stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Prove the constitution gates on the finished feature.

- [ ] T047 Run backend gates in Docker: `vendor/bin/pint --test` and `php artisan test` via `php:8.3-cli`; run coverage the CI way (pcov + `.github/scripts/check_coverage.py`, ≥90% over `app/`) and close any gaps
- [ ] T048 Run frontend gates: `docker compose exec frontend npm run lint` and `npm run test` — Vitest coverage ≥90% across ALL of `src/`; close any gaps
- [ ] T049 Run the full e2e suite against the isolated stack: `scripts\e2e.ps1` (ports 5174/8001; includes `verify-email.spec.ts`)
- [ ] T050 Manual quickstart validation: Scenarios 1–5 plus the constitution gates — Back/Forward/Refresh on `/verify-email` and `/verify-email/:hash` (Principle III/FR-010), both themes + status-not-by-color + labeled controls (IV), 320 px → desktop (VIII)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately.
- **Foundational (Phase 2)**: after Setup — BLOCKS all stories.
- **US1 (Phase 3)**: after Phase 2. No dependency on other stories.
- **US2 (Phase 4)**: after Phase 2. Reuses US1's controller/spec files
  (T038 → T019's file, T043 → T034's spec), so run after US1 when working
  solo; the backend resend endpoint itself is independently testable.
- **US3 (Phase 5)**: after Phase 2 for the status display; the resend button
  needs US2's T040.
- **Polish (Phase 6)**: after all implemented stories.

### Key task-level dependencies

- T021 (createUrlUsing) needs T020 (the named route it signs against).
- T030 (VerifyEmailPage) needs T023–T025; T031 (routes) needs T029 + T030.
- T041/T042 need T040; T045 needs T040.
- Every story's test tasks precede its implementation tasks (TDD — fail first).

### Parallel Opportunities

- Phase 1: T001, T002, T003 all [P].
- Phase 2: T004 ∥ T005 (tests), then T006 → T007 while T008 runs in parallel.
- US1 tests T009–T017 are all [P] (nine different files). Backend impl T018 ∥
  frontend impl T023/T024/T026/T032 ∥ e2e helper T033 once tests are red.
- US2: T035–T037 [P]; backend T038–T039 ∥ frontend T040–T042.
- With Phase 2 done, US1's backend track and frontend track can proceed in
  parallel (they meet at e2e T034).

---

## Parallel Example: User Story 1

```text
# All US1 tests together (different files, all must fail first):
T009 EmailVerificationControllerTest      T010 AuthControllerTest additions
T011 authApi.test.ts                      T012 authModel.test.ts
T013 useAuth/AuthProvider tests           T014 RequireAuth/LoginPage tests
T015 RegisterPage test                    T016 VerifyEmailNoticePage test
T017 VerifyEmailPage test

# Then implementation in two parallel tracks:
Backend:  T018 → T019 → T020 → T021 → T022
Frontend: T023 ∥ T024 ∥ T026 ∥ T032, then T025 → T027/T028/T029 → T030 → T031
E2E:      T033, then T034 (after both tracks land)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup → Phase 2 Foundational.
2. Phase 3 (US1): tests red → backend track + frontend track → e2e green.
3. **STOP and VALIDATE**: quickstart Scenarios 1, 2, 4 by hand; backend +
   frontend gates green. This alone delivers the feature's core promise —
   proof of address control.

### Incremental Delivery

1. US1 → validate → commit/push (MVP).
2. US2 (resend + recovery from expiry) → validate Scenario 3 → commit/push.
3. US3 (account-page status) → validate Scenario 5 → commit/push.
4. Phase 6 gates before declaring the feature done.

### Notes

- FR-009 guard: add **no** `verified` middleware anywhere — verification gates
  nothing yet.
- No new npm/Composer packages, no new containers (Principle I; D7's log-mailer
  decision). Zero migrations (D2).
- Commit after each task or logical group; every commit must keep both stacks'
  gates green.
