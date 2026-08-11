# Tasks: Password Recovery and Change

**Input**: Design documents from `/specs/022-password-recovery/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: **Included and mandatory.** Constitution Principle VII requires mirrored tests and CI
enforces ≥90% line coverage on both stacks. Two requirements — FR-004/SC-003 (paired
non-enumeration) and FR-017/FR-020/SC-007 (field-by-field invariance) — can only be enforced as
tests, never as prose, so their test tasks are load-bearing rather than optional.

**Organization**: Grouped by user story. Each story phase is a complete, independently testable
increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US5 from spec.md
- Every task names its exact file path

## Path Conventions

Two-app layout (plan.md → Project Structure): `backend/` Laravel 12 API, `frontend/` React 18 +
Vite SPA. Tests mirror source paths under each stack's own `tests/` dir.

**Local toolchain**: there is no local PHP — every backend command runs through the container
(`docker compose exec backend …`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the ground this feature stands on. It adds **no dependency, no migration, and
no column** — these tasks verify that claim rather than build anything.

- [X] T001 `backend/config/auth.php` carries `passwords.users` with `expire => 60` and `throttle => 60` (FR-007, FR-009 — research D1), but **both are hard-coded literals** (confirmed 2026-08-07). Wrap them as `env('AUTH_PASSWORD_RESET_EXPIRE', 60)` and `env('AUTH_PASSWORD_RESET_THROTTLE', 60)` so the spec's "configuration, not hard-coded behaviour" (Assumptions) is true, and add **both** keys to `backend/.env.example` with their defaults. Also confirm `backend/config/app.php:45` already exposes `auth_throttle` for the new limiter's cap (research D7)
- [X] T002 Confirm `backend/database/migrations/0001_01_01_000000_create_users_table.php` creates both `password_reset_tokens` and `sessions`, and that `backend/config/session.php` resolves the driver to `database` (data-model §1, §3) — **no migration is added by this feature**; record that `backend/.env.e2e`'s existing `AUTH_THROTTLE_PER_MINUTE=1000` already covers the new endpoints, so **the limiter cap** needs no new env var. (This is about the cap only — T001's two broker keys are a separate, expected addition to `.env.example`.)

  **Findings (2026-08-07).** Two of the three claims hold; one does not.

  - ✅ Both tables exist in `0001_01_01_000000_create_users_table.php:31` (`password_reset_tokens`: `email` PK, `token`, nullable `created_at`) and `:37` (`sessions`, incl. the indexed nullable `user_id` the purge needs). No migration required.
  - ✅ `.env.e2e:64` already sets `AUTH_THROTTLE_PER_MINUTE=1000`, which is the value `config('app.auth_throttle')` feeds the new `password` limiter — no new env var for the cap.
  - ❌ **`SESSION_DRIVER` does not resolve to `database`.** `config/session.php:23` defaults to `database`, but *every* environment overrides it to `file`: `.env:41`, `.env.example:49`, `.env.e2e:32`, `.env.e2e.example:35` (and `phpunit.xml:45` pins `array` for tests). `RememberMeSessionExpiryTest`'s docblock records the same thing for 018: "every env pins `SESSION_DRIVER=file`".

  **Consequence — US5 (Phase 7) only, blocking T063/T064/T065/T066.** The `sessions` table is empty in every real environment, so `SessionRevoker`'s `DELETE FROM sessions WHERE user_id = ?` would revoke nothing while its unit test (T062, which seeds rows directly) passes. FR-016 would silently not hold. Phases 2–6 are unaffected: nothing before US5 reads or writes the `sessions` table. Resolve before T065 by either (a) moving every env to `SESSION_DRIVER=database` — the `sessions` table is already migrated, and this is what data-model §3 assumed — or (b) revoking file sessions by another means, which the 018 test's own reasoning suggests is the harder path. This is a design-premise correction, not an implementation choice; re-open research D6 with it.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The password policy and the rate-limit bucket, stated once each. Every story below
consumes them.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests for Foundational

> Write these first and confirm they FAIL before implementing.

- [X] T003 [P] Create `backend/tests/Unit/Support/PasswordPolicyTest.php` asserting `PasswordPolicy::rules()` returns `required`, `string`, `confirmed` and an `Illuminate\Validation\Rules\Password` configured `min(8)->mixedCase()->numbers()`, and that a request validated with it rejects short / lowercase-only / digitless / mismatched-confirmation values (FR-013, FR-029, research D9)
- [X] T004 [P] Create `frontend/tests/lib/passwordModel.test.ts` covering `PasswordModel.policyErrors` — empty, too short, no uppercase, no lowercase, no digit, and a passing value — as the byte-equivalent client mirror of T003's rules

### Implementation for Foundational

- [X] T005 [P] Create `backend/app/Support/PasswordPolicy.php` — `declare(strict_types=1)`, one static `rules(): array` returning `['required', 'string', 'confirmed', Password::min(8)->mixedCase()->numbers()]` (research D9)
- [X] T006 [P] Create `frontend/src/lib/passwordModel.ts` — `export class PasswordModel` with the public static `policyErrors(password: string): string[]`, moved verbatim from `AuthModel`'s private `passwordPolicyErrors`
- [X] T007 Rewrite the `password` rule in `backend/app/Http/Requests/RegisterRequest.php` to `PasswordPolicy::rules()` (depends on T005) and update its docblock: the policy now lives in one place, so recovery cannot drift from registration
- [X] T008 Delete the private `passwordPolicyErrors` from `frontend/src/lib/authModel.ts` and delegate `validateRegister` to `PasswordModel.policyErrors` (depends on T006); adjust `frontend/tests/lib/authModel.test.ts` if it reached the private method
- [X] T009 [P] Add a `password` named limiter to `backend/app/Providers/AppServiceProvider.php` — `RateLimiter::for('password', $this->passwordLimit(...))` with a private `passwordLimit(Request $request): Limit` returning `Limit::perMinute((int) config('app.auth_throttle'))->by((string) ($request->user()?->getAuthIdentifier() ?? $request->ip()))`; it is a **separate bucket** from `auth`, so tripping the reset cap must never lock the visitor out of logging in (research D7)

**Checkpoint**: One policy, one bucket. User stories can now begin.

---

## Phase 3: User Story 1 - Ask for a recovery link (Priority: P1) 🎯 MVP

**Goal**: A "Forgot password?" control on the sign-in form leads to `/forgot-password`; submitting
an address produces one generic confirmation for every account state and mails a link only when the
account is real and enabled.

**Independent Test**: Request a link for a registered address and confirm an email carrying a link
is produced; request one for an unknown address and confirm the on-screen outcome is byte-identical
and no email is produced. Fully testable without the link ever being opened.

### Tests for User Story 1

> Write these first and confirm they FAIL before implementing.

- [X] T010 [P] [US1] Create `backend/tests/Unit/Services/PasswordServiceTest.php` covering `sendRecoveryLink`: an enabled account gets exactly one `ResetPassword` notification and a `password_reset_tokens` row; a **Google-only** account (`password IS NULL`) gets the same one notification with the same message — a null credential neither blocks the send nor changes the wording (FR-019, first half); an unknown address, a **disabled** account (FR-006), and a second call inside the 60-second interval (FR-009) each mail nothing; a mailer that throws is caught and passed to `report()` (FR-032, research D5). Every case returns `void` — assert there is no status to branch on (research D4)
- [X] T011 [P] [US1] Create `backend/tests/Feature/Http/Controllers/PasswordResetControllerTest.php` with the **paired non-enumeration** assertion (FR-004, SC-003): post a well-formed address in five states (real+enabled, unknown, disabled, inside the resend interval, mailer forced to throw), **four paired attempts each — 20 in all** — and assert every response is identical in **status, body and headers**. Two things this assertion must get right or it tests the wrong thing: (a) **exclude the `X-RateLimit-*` headers** — `throttle:password` decrements `X-RateLimit-Remaining` on every request, so they can never match across 20 calls, and they are keyed by IP rather than by the submitted address, so they disclose only the caller's own traffic; (b) **raise the cap for this test** (`config(['app.auth_throttle' => 1000])` or clear the limiter between attempts), since 20 calls would otherwise trip the 5/min limit at the sixth. **Do not compare timing** — FR-004 excludes it, research D12 says why. Plus `422` for empty/malformed (FR-003), `429` past the cap (FR-010), and that tripping `throttle:password` leaves `POST /api/login` working (research D7)
- [X] T012 [US1] Add the **link-shape** assertion to `backend/tests/Feature/Http/Controllers/PasswordResetControllerTest.php` (same file as T011, so sequential): the captured `ResetPassword` notification's URL matches `{frontend_url}/reset-password/{40 lowercase hex}#token={64 hex}` — no plaintext address anywhere in it, the token after the `#`, and exactly one link in the message (contracts/recovery-link.md, FR-005, FR-011, FR-018). This is where `EmailVerificationControllerTest` already asserts the verification link's shape, so the two stay side by side
- [X] T013 [P] [US1] Extend `backend/tests/Unit/Support/SpaRoutesTest.php`: `/forgot-password` matches, is **not** indexable, appears in `disallowedPaths()`, and a malformed variant does not match (contracts/frontend.md §1)
- [X] T014 [P] [US1] Create `frontend/tests/lib/passwordApi.test.ts` covering `PasswordApi.requestLink`: `200` → `{ ok: true }`, `422` → `{ ok: false, kind: 'validation', errors }`, `429` → `'rate-limited'`, a thrown fetch → `'network'`
- [X] T015 [P] [US1] Create `frontend/tests/pages/ForgotPasswordPage.test.tsx`: the form renders with a labelled e-mail field and a link back to `/login`; a malformed address is flagged inline via `role="alert"` and **the entered value is preserved** (US1 scenario 4); a `200` replaces the form with the confirmation; `429` and network failures show the shared sentences and **name no account**
- [X] T016 [P] [US1] Extend `frontend/tests/pages/LoginPage.test.tsx`: a "Forgot password?" link pointing at `/forgot-password` is present in the form (FR-001)

### Implementation for User Story 1

- [X] T017 [P] [US1] Create `backend/app/Http/Requests/ForgotPasswordRequest.php` — `email` → `['required', 'email', 'max:255']`, **deliberately no `exists:users,email`** (that rule would itself be the oracle FR-004 forbids); document the omission in the docblock
- [X] T018 [P] [US1] Register the link builder in `backend/app/Providers/AppServiceProvider.php`: `ResetPassword::createUrlUsing(self::recoveryLinkFor(...))` directly beside the existing `VerifyEmail::createUrlUsing`, with a private static `recoveryLinkFor` returning `config('app.frontend_url') . '/reset-password/' . sha1($email) . '#token=' . $token` (contracts/recovery-link.md, research D2)
- [X] T019 [US1] Create `backend/app/Services/PasswordService.php` with `sendRecoveryLink(string $email): void` — resolve the account, `return` early when it is missing **or `disabled_at` is non-null** (the broker cannot see `disabled_at`, research D4), then `Password::sendResetLink(['email' => $email])` inside `try { … } catch (Throwable $e) { report($e); }`; every non-sendable path exits through the same `return` so there is no value the controller could branch on
- [X] T020 [US1] Create `backend/app/Http/Controllers/PasswordResetController.php` with `request(ForgotPasswordRequest $request): JsonResponse` — call the service and unconditionally answer `200` with `{"message": "If an account exists for that address, a password recovery link is on its way."}` (contracts/password-recovery-api.md §1)
- [X] T021 [US1] Register `POST /api/password/forgot` in `backend/routes/api.php` as `api.password.forgot` under `throttle:password`, with a comment naming FR-004's unconditional 200
- [X] T022 [P] [US1] Add `FORGOT_PASSWORD = '/forgot-password'` to `backend/app/Support/SpaRoutes.php` — in `STATIC_ROUTES` mapped to `false` (never indexable) and in `disallowedPaths()` (FR-018)
- [X] T023 [P] [US1] Create `frontend/src/lib/passwordApi.ts` — `export class PasswordApi` with `static requestLink(email)`, using the same `Csrf.ensure()` + `credentials: 'include'` fetch shape as `AuthApi`; it resolves `{ ok: true }` for **any** `200`, so the page never has information to render anything but the confirmation (FR-004)
- [X] T024 [US1] Create `frontend/src/pages/ForgotPasswordPage.tsx` on `useAuthForm` + `AuthField` — H1 "Reset password", one e-mail field, submit "Send recovery link", a link back to `/login`, and a `sent` state replacing the form with the confirmation (contracts/frontend.md §2); client validation is feedback only
- [X] T025 [US1] Register `<Route path="/forgot-password" element={<ForgotPasswordPage />} />` in `frontend/src/App.tsx` — **no `RequireAnon`** (research D11); same commit as T022, per the mirror rule
- [X] T026 [US1] Add `<Link to="/forgot-password">Forgot password?</Link>` inside `.auth-form` in `frontend/src/pages/LoginPage.tsx`, beside the existing "No account?" line and styled the same way (FR-001) — nothing else on the page changes

**Checkpoint**: US1 is independently deliverable — a stuck user can ask for a link and the site
gives nothing away about who has an account.

---

## Phase 4: User Story 2 - Choose a new password from the link (Priority: P1)

**Goal**: Opening the emailed link lands on `/reset-password/:hash`, which checks the token without
consuming it and then accepts a new password twice, setting it and consuming the link — without
establishing a session.

**Independent Test**: From a valid, unused link, set a new password and confirm the old password no
longer signs in while the new one does.

### Tests for User Story 2

> Write these first and confirm they FAIL before implementing.

- [X] T027 [P] [US2] Extend `backend/tests/Unit/Services/PasswordServiceTest.php`: `reset()` writes the new password (hashed by the model cast, never pre-hashed), deletes the `password_reset_tokens` row, and **never calls `Auth::login`** (INV-6); a policy failure never reaches the service at all because form-request validation runs first
- [X] T028 [P] [US2] Extend `backend/tests/Feature/Http/Controllers/PasswordResetControllerTest.php`: `POST /api/password/reset/check` → `204` for a live link and **writes nothing** (row and `created_at` unchanged — FR-012); `POST /api/password/reset` → `200` with `{"message": "Your password has been changed. Please log in."}`, the old password is refused at `/api/login` and the new one accepted, **no session cookie is issued** (FR-021), and the response body carries **no account detail** (INV-7). Two cases beyond the happy path: a **Google-only** account (`password IS NULL`) completes the reset and afterwards signs in **both** ways — `password` is set, its `user_identities` row is byte-identical, and `has_password` flips to `true` (FR-019, second half — the account holder who loses their Google account keeps their Ladybug one); and **both** endpoints answer `429` past the cap, not only `/forgot` (FR-033 names the reset form specifically)
- [X] T029 [P] [US2] Extend `backend/tests/Unit/Support/SpaRoutesTest.php`: `/reset-password/{40 lowercase hex}` matches and is non-indexable; a 39-char, 41-char, uppercase or non-hex segment does **not** match; the `/reset-password` prefix is in `disallowedPaths()`
- [X] T030 [P] [US2] Extend `frontend/tests/lib/passwordApi.test.ts` with `checkToken` (`204` → `{ ok: true }`, `403` → `'invalid'`, `429`, network) and `reset` (`200` → `{ ok: true }`, `422` → `'validation'`, `403` → `'invalid'`, `429`, network)
- [X] T031 [P] [US2] Extend `frontend/tests/lib/passwordModel.test.ts` with `parseResetFragment` (a well-formed `#token=…` → the token; absent, empty, or malformed → `null`) and `validateReset` (policy errors plus the confirmation-mismatch message, touched-aware like the other validators)
- [X] T032 [P] [US2] Create `frontend/tests/pages/ResetPasswordPage.test.tsx` for the `checking` → `form` → `done` path: the pending state on mount, the form after a `204` with **no current-password field and no e-mail, name, or other account detail rendered** (FR-011), a `422` keeping the page in `form` with inline field messages and the link still usable, and `done` rendering the confirmation plus a link to `/login` with **no auth refresh and no login call** (FR-021). Add the **Refresh** assertion FR-024 needs and only this test can give cheaply: unmount and remount at the same address with the same `#token=…` fragment, and the page checks again and reaches `form` — proving the fragment is still there to be read, which is the whole of research D3 and the one automated guard against a future `history.replaceState` turning every live link dead on reload

### Implementation for User Story 2

- [X] T033 [P] [US2] Create `backend/app/Http/Requests/CheckResetTokenRequest.php` — `hash` and `token` both `['required', 'string']`
- [X] T034 [P] [US2] Create `backend/app/Http/Requests/ResetPasswordRequest.php` — `hash` and `token` `['required', 'string']`, `password` → `PasswordPolicy::rules()`; note in the docblock that validation running **before** the broker is what keeps a rejected password from touching the link (US2 scenarios 3–4)
- [X] T035 [US2] Add to `backend/app/Services/PasswordService.php`: `checkResetToken(string $hash, string $token): bool` (resolve the account via `UserService::findByEmailDigest`, refuse a disabled one, then `Password::getRepository()->exists()` — a pure read, FR-012) and `reset(...)`, whose broker callback calls a new private `applyNewPassword(User $user, string $password, ?string $keepSessionId): void` wrapping the writes in **one** `DB::transaction` (data-model §4, INV-3)
- [X] T036 [US2] Add `check()` and `reset()` to `backend/app/Http/Controllers/PasswordResetController.php` — `204`/`403` and `200`/`403` respectively, the `403` carrying one message, `"This password recovery link is no longer valid."`, for every refusal (contracts/password-recovery-api.md §2–§3)
- [X] T037 [US2] Register `POST /api/password/reset/check` (`api.password.reset.check`) and `POST /api/password/reset` (`api.password.reset`) in `backend/routes/api.php` under `throttle:password`, with a comment on why the check is a POST-with-body rather than a GET (research D8)
- [X] T038 [P] [US2] Add `RESET_PASSWORD_HASH = '/reset-password/{hash}'` to `backend/app/Support/SpaRoutes.php` — in `DYNAMIC_ROUTES` with pattern `#^/reset-password/[0-9a-f]{40}$#` and `'indexable' => false`, plus the `/reset-password` prefix in `disallowedPaths()`
- [X] T039 [US2] Add `checkToken(hash, token)` and `reset(input)` to `frontend/src/lib/passwordApi.ts`, mapping statuses exactly as contracts/frontend.md §6 specifies
- [X] T040 [US2] Add `parseResetFragment`, `validateReset` and `resetFailureMessage` to `frontend/src/lib/passwordModel.ts` — `parseResetFragment` mirrors `AuthModel.parseVerifyParams`'s shape, returning `null` for an absent or malformed fragment so the page can refuse without issuing a doomed request
- [X] T041 [US2] Create `frontend/src/pages/ResetPasswordPage.tsx` — digest from `useParams().hash`, token from `useLocation().hash`, one check on mount only, and the `checking`/`form`/`done` states; password inputs carry `autoComplete="new-password"` and are never repopulated. **Do not strip the fragment** — no `history.replaceState`, so Refresh keeps a live link live (research D3, FR-024)
- [X] T042 [US2] Register `<Route path="/reset-password/:hash" element={<ResetPasswordPage />} />` in `frontend/src/App.tsx` — unguarded (research D11); same commit as T038

**Checkpoint**: US1 + US2 together are the MVP — a locked-out user can regain access end to end.

---

## Phase 5: User Story 3 - Change the password while signed in (Priority: P2)

**Goal**: `/account` gains a password section beside the display-name section. An account with a
password must prove the current one; a Google-only account sees no current-password field and gains
a password without disturbing its Google link.

**Independent Test**: Sign in, change the password from the account page, confirm the new password
signs in and the old one does not — with no email sent and no link involved.

### Tests for User Story 3

> Write these first and confirm they FAIL before implementing.

- [X] T043 [P] [US3] Extend `backend/tests/Feature/Http/Controllers/AuthControllerTest.php` for `PUT /api/user/password`: `200` returning the `UserResource` envelope with `has_password: true`; `422` on a wrong `current_password` **with no password field echoed back**; `422` on a policy failure or confirmation mismatch; `401` with no session; `429` past the per-**account** cap (FR-030); and a **Google-only** account (`password IS NULL`) succeeding **without** sending `current_password`, its `user_identities` row untouched afterwards (FR-019, FR-031)
- [X] T044 [P] [US3] Extend `backend/tests/Unit/Services/PasswordServiceTest.php`: `change()` writes the password and deletes any outstanding `password_reset_tokens` row for the account — FR-008's second half, so an account-page change shuts an attacker's outstanding link
- [X] T045 [P] [US3] Extend `frontend/tests/lib/passwordApi.test.ts` with `changePassword`: `200` → `{ ok: true, user }` mapped through `AuthApi.mapUser`, `422` → `'validation'`, `401` → `'auth'`, `429` → `'rate-limited'`, network → `'network'`
- [X] T046 [P] [US3] Extend `frontend/tests/lib/passwordModel.test.ts` with `validateChange(values, hasPassword, touched?)` — `currentPassword` required **only** when `hasPassword` — and `changeFailureMessage(result)` preferring the server's field message, then the shared fallbacks
- [X] T047 [P] [US3] Create `frontend/tests/components/AccountPasswordForm.test.tsx`: with `hasPassword: true` all three fields render; with `hasPassword: false` the current-password input is **absent from the DOM** (not disabled, not hidden) and the Google sentence is rendered as text (FR-031); a `200` shows "Password updated.", clears all three fields and calls the auth context's `refresh`; any refusal clears all three fields (US3 scenario 3); `429` and `401` show the shared sentences
- [X] T048 [P] [US3] Extend `frontend/tests/pages/AccountPage.test.tsx`: the password section renders directly after `<AccountNameForm />` and neither section's state can clear or block the other

### Implementation for User Story 3

- [X] T049 [P] [US3] Create `backend/app/Http/Requests/UpdatePasswordRequest.php` — `password` → `PasswordPolicy::rules()`, and `current_password` → `['required', 'current_password']` added by a plain **`if`** on `$this->user()->password !== null` (closure-free, per the standing preference); when the account has no password the key is absent from the array entirely, so a submitted value is ignored rather than checked (contracts/account-password-api.md)
- [X] T050 [US3] Add `change(User $user, string $password, ?string $keepSessionId): User` to `backend/app/Services/PasswordService.php`, routed through the **same** private `applyNewPassword` as T035 plus `Password::broker()->deleteToken($user)` so neither route can grow a gap the other lacks

  **Built as `change(User $user, string $password): User`** (2026-08-07). `$keepSessionId` is
  the session-revocation argument and nothing reads it until T066 wires `SessionRevoker` in,
  so shipping it now would be a parameter accepted and ignored — untestable by construction.
  T066 adds it to `change`, to `applyNewPassword`, and to T051's controller call in one move.
- [X] T051 [US3] Add `updatePassword(UpdatePasswordRequest $request): JsonResponse` to `backend/app/Http/Controllers/AuthController.php` beside `updateProfile`, calling the service with `session()->getId()` and returning a `UserResource` response (contracts/account-password-api.md)
- [X] T052 [US3] Register `PUT /api/user/password` in `backend/routes/api.php` as `api.auth.password.update` under `['auth:sanctum', 'throttle:password']`, with a comment noting two things: the limiter keys by account id here (not IP), and **why `PUT` when the neighbouring `updateProfile` is `PATCH /api/user`** — that one sends a partial account, this one replaces one whole credential at its own address, so the verbs differ because the requests differ (contracts/account-password-api.md)
- [X] T053 [P] [US3] Add `changePassword(input)` to `frontend/src/lib/passwordApi.ts`, mapping its `200` through `AuthApi.mapUser` so the refreshed `hasPassword` reaches the page in the shape the SPA already speaks
- [X] T054 [P] [US3] Add `validateChange` and `changeFailureMessage` to `frontend/src/lib/passwordModel.ts`
- [X] T055 [US3] Create `frontend/src/components/AccountPasswordForm.tsx` mirroring `AccountNameForm`'s markup — `fieldset disabled={saving}`, inline `role="alert"` error, `role="status"` success line — with the two shapes chosen from `user.hasPassword`, all three inputs cleared on any outcome, and `refresh()` called on success (contracts/frontend.md §5)
- [X] T056 [US3] Render `<AccountPasswordForm />` directly after `<AccountNameForm />` in `frontend/src/pages/AccountPage.tsx` — no new address, no new guard (FR-025, FR-026)

**Checkpoint**: US1, US2 and US3 each work independently; the account page now covers the
deliberate half of password management.

---

## Phase 6: User Story 4 - Dead, spent, and tampered links (Priority: P2)

**Goal**: Every unusable link — expired, consumed, superseded, tampered, unknown, deleted, disabled
— is refused with one indistinguishable message and a one-click path back to the request view, and
no password changes.

**Independent Test**: Open an expired link, an already-used link, and a link with one character
altered; confirm each shows the same "no longer valid" outcome with a path to request a new one, and
that no password changed.

### Tests for User Story 4

> Write these first and confirm they FAIL before implementing.

- [X] T057 [P] [US4] Extend `backend/tests/Feature/Http/Controllers/PasswordResetControllerTest.php` with the **refusal matrix** (FR-015, SC-004): expired (`created_at` pushed past `auth.passwords.users.expire`), already consumed, superseded by a newer request, altered token, altered digest, missing token, unknown digest, deleted account, disabled account, and voided by an account-page change — each on **both** `check` and `reset`, each answering an identical `403` body naming no account detail, and in **no** case a changed password. Also assert the `422`-vs-`403` split: a policy failure leaves the link **alive** and a second, valid submission succeeds (US2 scenarios 3–4); and that `check` is side-effect-free — call it three times and the row is byte-identical (FR-012)
- [X] T057a [US4] Extend the same file as T057 (so it follows it, not parallel to it) with the **signed-in holder** case the spec calls out by name (Edge Cases, FR-016): acting as account **B**, complete a reset for account **A**'s link — A's password changes and A's sessions die, while B's session is untouched and still authenticated on its next request, proving the link is honoured for the account it *names* and never for the signed-in one (research D11, which registers the route unguarded for exactly this). Then the same reset for **B's own** link — B's own session dies too, because FR-016 applies whenever the session belongs to the reset account, and the recovery route keeps none (FR-021)

  **Built (2026-08-11).** Confirms the premise-correction note under T065: Sanctum's
  `AuthenticateSession` (pulled in by `statefulApi()`, not opt-in) already tears a stale
  session down on its very next request, ahead of anything `SessionRevoker` (Phase 7) will
  add — a mismatched `password_hash_web` throws `AuthenticationException` (a hard `401`), it
  does **not** degrade to the anonymous `{"data": null}` shape an unauthenticated request gets.
  Exercising this needed real cross-request cookie replay (`loginSession` / `withSessionCookie`
  helpers, mirroring `AuthControllerTest::actAsFreshClient`) rather than `actingAs()`, and both
  helpers call `$this->app['auth']->forgetGuards()` before every switch — the guard singleton
  otherwise caches whichever user its last resolution found and leaks it across the next
  request, the same caching hazard `actAsFreshClient`'s docblock already names.
- [X] T058 [P] [US4] Extend `frontend/tests/pages/ResetPasswordPage.test.tsx` for the `dead` state: entered from a `403` on check, from a `403` on submit, and from a missing or malformed fragment; each renders the same sentence plus a `<Link to="/forgot-password">` control, and the page issues no further requests

  **Already done.** Built ahead of schedule in T027–T042 (US2): a page that renders nothing
  for a refused check isn't shippable, so the `dead` view state and its four tests were
  already in place. Confirmed passing as part of this phase, no diff.

### Implementation for User Story 4

- [X] T059 [US4] **Verification pass, not new code.** T019, T035 and T036 already specify the single-exit shape; this task re-reads `backend/app/Services/PasswordService.php` and `PasswordResetController.php` against T057/T057a's now-complete refusal matrix and confirms it held up: the account lookup, the disabled check and the token comparison all still fall through to the same `false`/refusal, and the controller still maps every one of them to a single `403` message (INV-7). If a branch grew a distinguishable exit while US2 was built, this is where it is collapsed back — but the expected outcome is no diff

  **Confirmed (2026-08-11).** All 24 `PasswordResetControllerTest` cases, including the new
  10-scenario refusal matrix, pass against the unmodified service and controller — no diff.
- [X] T060 [US4] Add the `dead` state to `frontend/src/pages/ResetPasswordPage.tsx` — the one sentence plus `<Link to="/forgot-password">Request a new link</Link>`, entered from a failed check, a `403` on submit, or a `null` from `parseResetFragment` (US4 scenario 5)

  **Already done** in T027–T042, alongside T058. No diff.
- [X] T061 [US4] Add `resetFailureMessage(kind)` cases to `frontend/src/lib/passwordModel.ts` so every failure — invalid link, rate-limited, network — is one plain sentence, never colour or an icon (FR-023)

  **Already done** in T027–T042, alongside T058. No diff.

**Checkpoint**: The most common non-happy path is now a dead end no longer.

---

## Phase 7: User Story 5 - A password change ends every other session (Priority: P3)

**Goal**: A successful change by either route deletes every other session row and rotates
`remember_token`, keeping only the acting session on the account-page route.

**Independent Test**: Sign in on two clients, change the password from a third (once by link, once
from the account page), confirm both existing sessions are refused on their next request and a
"remember me" from before no longer restores a session.

### Tests for User Story 5

> Write these first and confirm they FAIL before implementing.

- [X] T062 [P] [US5] Create `backend/tests/Unit/Support/SessionRevokerTest.php`: with `$keepSessionId = null` every `sessions` row for the account is deleted; with an id, that one row survives and the rest go; other accounts' rows are never touched; an account with no rows is a no-op
- [X] T063 [P] [US5] Extend `backend/tests/Feature/Http/Controllers/PasswordResetControllerTest.php`: after a successful reset **all** the account's `sessions` rows are gone (there is no acting session to keep — FR-021), `remember_token` is rotated, and the **SC-007 field-by-field** snapshot holds — every `users` column except `password` and `remember_token` is byte-identical before and after, `email_verified_at` included (FR-017, FR-020, INV-5). Assert the snapshot **column-wise over the live schema** (iterate the table's columns, don't hand-list them): that way it doubles as FR-034's guard — the day someone adds a `password_changed_at`, this test fails and says so, which is the only automated hold on a requirement whose whole content is that nothing is recorded
- [X] T064 [P] [US5] Extend `backend/tests/Feature/Http/Controllers/AuthControllerTest.php`: after a successful `PUT /api/user/password` the acting session row **survives** and the client's next request is still authenticated (FR-028), every other row is gone, a 018 "remember me" session from before no longer restores access, and the same schema-driven SC-007 snapshot holds for this route — carrying the same FR-034 guard (no audit row, no timestamp, no new column)

  **Built (2026-08-11).** T002's premise correction resolved first: `SESSION_DRIVER` moved to
  `database` in every real env (`.env`, `.env.example`, `.env.e2e`, `.env.e2e.example`) and in
  `phpunit.xml`, since the file/array drivers left the `sessions` table permanently empty —
  option (a) from T002's note, confirmed safe by a full suite run before touching Phase 7 code
  (one casualty: `RobotsControllerTest` needed `RefreshDatabase` to migrate the table its
  `web.php` route now touches via `StartSession`; `RememberMeSessionExpiryTest` and
  `OAuthFlowStateTest` got docblock corrections, no behaviour change).

  Both feature tests needed real cookie-carrying, cross-request replay (`loginSession` /
  `withSessionCookie`, extended into `AuthControllerTest`), and that surfaced a second,
  unrelated masking bug in the same family `RememberMeSessionExpiryTest`'s docblock already
  names: `Illuminate\Session\Store::loadSession()` does `array_replace($this->attributes,
  $this->readFromHandler())`, so once `SessionRevoker` deletes a row, that session's NEXT
  simulated read (empty) leaves the PRIOR request's stale attributes in place, because a
  single PHPUnit process shares one Store singleton across every request it makes — production
  boots a fresh one per request and has no such gap. Every "is this session really dead"
  assertion in both files was therefore moved to the DB layer (`assertDatabaseMissing('sessions',
  …)`) rather than a further simulated request, including T057a's pre-existing 401 assertion
  (Phase 6), which this phase's real row-deletion superseded — its stale-hash 401 came from
  `AuthenticateSession` alone, before `SessionRevoker` existed; the row is now actually gone,
  and this file's own masking bug can no longer tell the difference between "gone" and "empty
  read" through a live round trip.

### Implementation for User Story 5

- [X] T065 [US5] Create `backend/app/Support/SessionRevoker.php` — `revoke(User $user, ?string $keepSessionId): void`, one `DELETE FROM sessions WHERE user_id = ? [AND id != ?]` through the query builder; document why this and not `Auth::logoutOtherDevices` (research D6: it needs the plaintext password the recovery route never has, and depends on `AuthenticateSession`, which this app does not run)

  **Premise correction (2026-08-07, found while building Phase 5).** The app **does** run
  `Laravel\Sanctum\Http\Middleware\AuthenticateSession` — `$middleware->statefulApi()` in
  `bootstrap/app.php` pulls it in through Sanctum's own `config('sanctum.middleware')`, and
  it is visible in any api-group stack trace. So research D6's second clause is wrong; only
  the first (`logoutOtherDevices` needs the plaintext password the recovery route never has)
  still stands, and it is enough on its own. Two consequences for US5:
  - That middleware already logs a client out when the session's stored `password_hash_web`
    stops matching the account's — so a **remote** session dies on its next request even
    before `SessionRevoker` deletes its row. It re-stores the hash **after** the response on
    the acting request, which is why the acting client survives its own change (FR-028) with
    no extra code. T064's assertion should hold as written; if it does not, this is the first
    place to look, not the revoker.
  - It also means a feature test cannot switch accounts mid-test without `flushSession()` +
    `forgetGuards()` first — see `AuthControllerTest::actAsFreshClient`, which T063/T064 will
    want to reuse rather than rediscover.
- [X] T066 [US5] Wire `SessionRevoker::revoke` and the `remember_token` rotation into `applyNewPassword` in `backend/app/Services/PasswordService.php`, **inside** the existing transaction — `null` on the recovery route, `session()->getId()` on the account-page route — so the password's death and its dependent credentials' death are simultaneous (INV-3)

  **Built (2026-08-11).** `applyNewPassword` gained `?string $keepSessionId = null` as its
  third parameter, defaulted so `reset()` can still hand the broker's fixed 2-argument
  callback `$this->applyNewPassword(...)` unmodified (research D6) — no closure needed.
  `change()` now takes `?string $keepSessionId` and `AuthController::updatePassword` passes
  `session()->getId()`; every other existing caller (tests) now passes `null` explicitly.

**Checkpoint**: All five stories are independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T067 [P] Add `latestResetLink(recipient?)` to `frontend/tests/e2e/helpers/mailLog.ts` beside `latestVerificationLink`, matching `/reset-password/…#token=…` — the fragment must survive the quoted-printable unfolding intact, since `page.goto()` delivers it to the SPA

  **Built (2026-08-11).** Both link finders now share a private `extractLink(pathSegment,
  recipient?)`, added after the commit-quality-verifier flagged the initial copy-paste
  (the two methods were identical but for the path segment).
- [X] T068 Create `frontend/tests/e2e/password-recovery.spec.ts` against the isolated `docker-compose.e2e.yml` stack: request a link → read it from the log → open it → set a new password → the old password is refused → the new one signs in → re-opening the link is refused. Run it with `.\scripts\e2e.ps1`

  **Built (2026-08-11).** Passes against the isolated stack.
- [X] T069 [P] Add a **022-password-recovery** entry to the Current State list in `C:\projects\ladybug\CLAUDE.md` and drop "password reset" from the "Not built yet" line — naming the no-migration decision, the fragment-carried token, the single `PasswordService` collapse point, and the shared `PasswordPolicy`
- [X] T070 Run the backend gates in the container and fix what they find: `vendor/bin/pint --test`, `php artisan test`, `php artisan test --coverage-clover=coverage.xml`, then `python .github/scripts/check_coverage.py coverage.xml` (≥90%)

  **Run (2026-08-11).** Pint clean (198 files); 1081 tests passed (3015 assertions);
  coverage 97.86%.
- [X] T071 Run the frontend gates from `frontend/` and fix what they find: `npm run lint`, `npm test`, `npm run test:coverage` (the gate spans **all** of `src/`)

  **Run (2026-08-11).** ESLint clean; 1145 tests passed (104 files); coverage 98.43%
  lines (98.39% statements, 95% branches).
- [X] T072 Walk `specs/022-password-recovery/quickstart.md` §3–§10 by hand against `docker compose up -d` — the four journeys, the rate-limit bucket separation, the light/dark and 320px passes, and §10's proof that the token appears in **neither** nginx's access log nor `laravel.log`. Remember `docker compose restart backend` after PHP edits (opcache) and `restart frontend` after a merge

  **Walked (2026-08-11), against the isolated e2e stack rather than dev** (dev's
  `backend/.env` has `MAIL_MAILER=smtp` pointed at a real mailbox, not the log
  `quickstart.md` §0 assumes — a pre-existing environment gap outside this feature's
  scope). Confirmed by hand: the full recovery journey (register → forgot → link from
  `laravel.log` → check → reset → old password refused → new one signs in → re-opening
  the spent link refused); the rate-limit bucket separation on the real 5/min config
  (6th `/forgot-password` call → `429`, `/login` right after still answers on its own
  terms, `401` for wrong credentials — not `429`); and §10 — the token string appears in
  neither the e2e nginx access log nor `laravel.log` outside the mail body. **Not
  verified**: §9's light/dark and 320px visual pass — no browser automation was
  available in this session. That gate still needs a manual or Playwright visual pass
  before considering presentation fully proven, though the component/page test suites
  already assert the underlying a11y attributes (labels, `role="alert"`, focus).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — verification only
- **Foundational (Phase 2)**: depends on Setup — **blocks every user story**
- **US1 (Phase 3)**: depends on Foundational
- **US2 (Phase 4)**: depends on Foundational. Shares `PasswordService`, `PasswordResetController`, `passwordApi.ts`, `passwordModel.ts` and `App.tsx` with US1, so in a single-developer run it follows US1
- **US3 (Phase 5)**: depends on Foundational **only** — it touches no recovery endpoint and can ship without US1/US2 (spec: "it works if recovery is not built")
- **US4 (Phase 6)**: depends on US2 — it hardens the refusal path US2 opens
- **US5 (Phase 7)**: depends on US2 **and** US3 — it wires the shared after-effect into both routes
- **Polish (Phase 8)**: depends on all five stories

### Within Each User Story

- Tests are written first and must FAIL before implementation
- Support classes → service → controller → route (backend); `lib/` class → page/component → router entry (frontend)
- The **mirror rule** is a hard pairing: `SpaRoutes.php` and `App.tsx` must change in the **same commit** (T022+T025, T038+T042), or the address answers 404 to every crawler while rendering fine in a browser

### Parallel Opportunities

- **Phase 2**: T003 ∥ T004 (tests); T005 ∥ T006 ∥ T009 (impl)
- **Phase 3**: T010 ∥ T011 ∥ T013 ∥ T014 ∥ T015 ∥ T016 (T012 extends T011's file, so it follows it); then T017 ∥ T018 ∥ T022 ∥ T023
- **Phase 4**: T027–T032 in parallel; then T033 ∥ T034 ∥ T038
- **Phase 5**: T043–T048 in parallel; then T049 ∥ T053 ∥ T054
- **Phase 6**: T057 ∥ T058 (T057a extends T057's file, so it follows it)
- **Phase 7**: T062 ∥ T063 ∥ T064
- **Across stories**: **US3 shares no file with US1/US2** except `passwordApi.ts`, `passwordModel.ts` and `routes/api.php` — with two developers, one takes the recovery pair and the other takes the account page from the moment Phase 2 lands

### Parallel Example: User Story 1

```bash
# Six US1 test tasks together — six distinct files (T012 follows T011: same file):
Task: "T010 PasswordServiceTest.php — sendRecoveryLink cases"
Task: "T011 PasswordResetControllerTest.php — paired non-enumeration"
Task: "T013 SpaRoutesTest.php — /forgot-password"
Task: "T014 passwordApi.test.ts — requestLink"
Task: "T015 ForgotPasswordPage.test.tsx"
Task: "T016 LoginPage.test.tsx — the forgot link"

# Then four US1 implementation tasks together — four distinct files:
Task: "T017 ForgotPasswordRequest.php"
Task: "T018 AppServiceProvider.php — ResetPassword::createUrlUsing"
Task: "T022 SpaRoutes.php — FORGOT_PASSWORD"
Task: "T023 passwordApi.ts — requestLink"
```

---

## Implementation Strategy

### MVP First (US1 + US2)

1. Phase 1 Setup → Phase 2 Foundational
2. Phase 3 (US1) → **STOP and VALIDATE**: quickstart §4 — an unknown address and a real one are
   indistinguishable
3. Phase 4 (US2) → **STOP and VALIDATE**: quickstart §3 — the full recovery journey in 4 steps

US1 and US2 together are the minimum that delivers value; either alone leaves the user stranded,
which is why both are P1.

### Incremental Delivery

1. Setup + Foundational → one policy, one limiter, and registration already benefits
2. + US1 → the request half works, and the site gives nothing away
3. + US2 → **MVP**: a locked-out user recovers end to end
4. + US3 → the deliberate half; needs no inbox, ships independently
5. + US4 → dead links stop being dead ends
6. + US5 → a password change becomes a security control rather than a convenience
7. Polish → the e2e spec, the CI gates, and the quickstart walk

### Notes

- **No dependency, no migration, no column.** If a task seems to need one, the design was
  misread — re-read research D1 and D10 before adding anything (Principle I).
- FR-004 is enforced by the *absence of a return value*: `sendRecoveryLink` returns `void` on
  purpose (research D4). Do not "improve" it into a status the controller switches on — that is
  the enumeration oracle, reintroduced.
- FR-004 covers what the server **says**, not how long it takes. Do not add a `sleep`, a response
  floor, or a dummy bcrypt on the ineligible path to even out the timing: both were considered and
  rejected in research D12 (one hands an attacker CPU amplification on an anonymous endpoint, the
  other holds a php-fpm worker), and the spec now says so outright. A test that asserts on duration
  is asserting something this feature does not promise.
- The token lives in the URL **fragment**. Any change that moves it into a path or query silently
  breaks FR-018 in three server configurations at once (research D2).
- Commit after each task or logical group; commit-quality-verifier gates each phase commit.
