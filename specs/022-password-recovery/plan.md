# Implementation Plan: Password Recovery and Change

**Branch**: `022-password-recovery` | **Date**: 2026-08-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/022-password-recovery/spec.md`

## Summary

Two independent routes to a new password, sharing one set of after-effects.

**Recovery (US1/US2/US4, P1)**: a "Forgot password?" link on the sign-in form leads to
`/forgot-password`, which posts an address to `POST /api/password/forgot`. The server answers
one generic confirmation for every well-formed address — account or not, disabled or not,
throttled or not, mail failed or not — and only when the account is real and enabled does it
mint a link through **Laravel's existing password broker** and the **`password_reset_tokens`
table that migration `0001_01_01_000000` already creates**. No migration, no new dependency: the
broker already stores the token bcrypt-hashed, expires it at 60 minutes, throttles a re-send to
60 seconds, and keeps at most one outstanding row per address — FR-007, FR-008, FR-009 and
FR-018 are configuration of code that ships with the framework.

The emailed link is `{FRONTEND_URL}/reset-password/{sha1(email)}#token=…`. The path segment is
the sha1 digest feature 008's verification links already use (`users.email_sha1`, indexed), so no
page in the journey prints an address (FR-011). The token rides in the **URL fragment**, which no
browser ever sends to a server — and in production every SPA address is proxied to Laravel's
`ShellController`, so a token in the path or query would land in nginx's access log and in PHP
(FR-018).

Opening the link renders `/reset-password/:hash`, which asks the server `POST
/api/password/reset/check` whether the token is still alive — a read that does not consume it
(FR-012) — so a dead link is refused on open (US4) rather than after the user has typed a
password. Submitting goes to `POST /api/password/reset`, which sets the password, deletes the
token, and establishes **no session** (FR-021).

**Deliberate change (US3, P2)**: `AccountPage` gains an `AccountPasswordForm` beside the existing
`AccountNameForm`, posting to `PUT /api/user/password`. An account that has a password must prove
the current one; a Google-only account (`has_password: false`, already on `UserResource`) sees no
current-password field at all and gains a password without touching its Google link (FR-031).

**Shared after-effects (US5)**: both routes run through one `PasswordService`, which on success
deletes the account's rows from the `sessions` table (`SESSION_DRIVER=database`) — keeping the
acting session id when there is one — rotates `remember_token`, and deletes any outstanding
recovery token. That is FR-008's second half and FR-016 in one place, so neither route can grow a
gap the other does not have.

## Technical Context

**Language/Version**: PHP 8.2+ (Laravel 12) backend; TypeScript / React 18 (Vite) frontend

**Primary Dependencies**: None added. Laravel's `Illuminate\Auth\Passwords` broker,
`Illuminate\Auth\Notifications\ResetPassword`, Sanctum SPA sessions, React Router — all already
present.

**Storage**: MySQL via Eloquent. **No migration.** `password_reset_tokens` (email PK, bcrypt
`token`, `created_at`) and `sessions` (`id` PK, `user_id`) both already exist; `users.email_sha1`
and `users.password` (nullable since 017) already carry what the feature reads and writes.

**Testing**: Backend PHPUnit (`backend/tests/`, mirrored paths, run through the `php:8.3-cli`
container); frontend Vitest (`frontend/tests/`, mirrored paths) plus one Playwright e2e spec
against the isolated `docker-compose.e2e.yml` stack, where `MAIL_MAILER=log` and the existing
`MailLog` helper reads the link out of `laravel.log` exactly as a user reads it out of an inbox.

**Target Platform**: Web — the SPA served in production by Laravel's `ShellController` behind
nginx; the API on the same origin.

**Project Type**: Web application (decoupled `backend/` Laravel API + `frontend/` React SPA).

**Performance Goals**: No new hot path. The request endpoint costs one indexed lookup plus one
bcrypt hash; the check and reset endpoints one indexed lookup plus one `Hash::check`. The session
purge is a single indexed `DELETE` on `sessions.user_id`.

**Constraints**: The token must never reach a server log (FR-018) — hence the fragment. The
generic confirmation must not vary with account state (FR-004) — hence one collapse point in
`PasswordService`, not per-branch mapping in the controller; FR-004 governs status, body, wording
and headers, and deliberately **not** response timing, which is not equalised (research D12). Refresh on the reset page must keep
the link working (FR-024) — hence the fragment is read on every mount and never stripped.

**Scale/Scope**: 3 anonymous endpoints + 1 authenticated endpoint; 2 new SPA routes + 1 account-page
section + 1 link on the sign-in form; 1 support class, 1 service, 4 form requests, 1 controller
on the backend; 2 pages, 1 component, 2 `lib/` classes on the frontend.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design — see below.*

| Principle | Verdict | How this feature satisfies it |
|---|---|---|
| **I. Minimal Dependencies** | ✅ PASS | Zero packages added, npm or Composer. The broker, the token table, the notification, and the rate limiter are all framework surface already in `composer.lock`. The only in-house code is the glue the spec's own rules demand (non-enumeration, disabled-account exclusion, session revocation). |
| **II. Coding Conventions** | ✅ PASS | PHP: `declare(strict_types=1)`, PSR-12, typed signatures, methods under 30 lines — `PasswordService` splits request/reset/change into separate short methods rather than one branching entry point. TS: 2-space, semicolons, `PascalCase` components, `is`/`has` booleans, functions under 50 lines — the two new pages follow `LoginPage`'s `FIELDS` roster + `useAuthForm` shape, which is what keeps them inside the budget. `lib/` additions are classes of statics (`PasswordApi`, `PasswordModel`). Closures are avoided per the standing preference: rules are built with an `if`, not a `Rule::when` callback. |
| **III. Browser-Native Navigation** | ✅ PASS | Two real, shareable addresses (`/forgot-password`, `/reset-password/:hash`), both registered in `SpaRoutes.php` so the server answers 200 rather than 404 (016's mirror rule). Back/Forward/Refresh restore each view; the reset page re-reads the fragment on every mount, so Refresh keeps a live link live (FR-024). No password value is ever repopulated. |
| **IV. Theme & Accessibility** | ✅ PASS | Both pages reuse `AuthField` (visually-hidden `<label>`, `aria-invalid`, `aria-describedby`, `role="alert"` text errors) and the existing `auth`/`auth-form` styles, which already follow `prefers-color-scheme`. The account section reuses `AccountNameForm`'s markup. Every outcome — valid link, dead link, wrong current password, Google-only account — is stated in words, never by colour (FR-023, FR-031). |
| **V. Stable Identifiers** | ✅ PASS | No database id appears anywhere. The link carries `sha1(email)` — the same handle 008's verification links carry — and the token, neither of which is an id. Principle V's 10-char code governs memes; account addressing here follows the established digest pattern. |
| **VI. Security & Input Validation** | ✅ PASS | Every input is validated server-side as the authority (client validation is feedback only). Token comparison is `Hash::check` against a bcrypt-stored value, so a database read yields no usable link. Rate limits on all four endpoints (FR-010, FR-030, FR-033). No enumeration oracle: one collapse point, one message. Eloquent only. No secret in any committed file — the 60-minute window and 60-second interval are `config/auth.php`, the caps are `config/app.php`, both env-overridable. |
| **VII. Test Coverage & Organization** | ✅ PASS | Mirrored tests for every new file, backend and frontend, plus the ≥90% Clover/Vitest gates CI already runs. The non-enumeration requirement (FR-004, SC-003) is asserted as *paired* tests — real address vs. unknown vs. disabled must produce byte-identical responses — which is the only way that requirement can be enforced rather than asserted in prose. |
| **VIII. Responsive Layout** | ✅ PASS | Both pages are the existing `.auth` form shell, already fluid from 320px up; the account section is the existing `.account` block. No new fixed widths. |

**Result: PASS, no violations, Complexity Tracking empty.**

**Post-design re-check (after Phase 1)**: still PASS, unchanged. The design added no package, no
migration, and no column; the two new `lib/` modules are classes of statics; the two new addresses
are registered on both sides of the 016 mirror as non-indexable and disallowed; the four new
endpoints are all rate-limited and all validate server-side. Two design decisions *strengthened*
the check rather than straining it — the token moved into the URL fragment so FR-018 holds without
depending on nginx configuration (research D2), and the password policy was extracted so this
feature reduces the duplication it inherited (research D9).

Two pre-existing costs this feature *extends* but does not create:

- The `App.tsx` ↔ `SpaRoutes.php` route-table duplication (recorded in 016's Complexity
  Tracking). Both new addresses must be added in both places in the same commit, or they answer
  404 to every crawler and unfurler while rendering fine in a browser.
- The password policy, previously stated twice (server `RegisterRequest`, client `AuthModel`).
  This feature would have made it five statements, so it is extracted to
  `App\Support\PasswordPolicy` and `PasswordModel.policyErrors` — a net reduction, not an
  addition (research D9).

## Project Structure

### Documentation (this feature)

```text
specs/022-password-recovery/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions D1–D12
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── password-recovery-api.md
│   ├── account-password-api.md
│   ├── recovery-link.md
│   └── frontend.md
└── tasks.md             # Phase 2 — /speckit-tasks, NOT created here
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── Http/
│   │   ├── Controllers/
│   │   │   ├── PasswordResetController.php   # NEW — request / check / reset
│   │   │   └── AuthController.php            # CHANGED — + updatePassword()
│   │   └── Requests/
│   │       ├── ForgotPasswordRequest.php     # NEW
│   │       ├── CheckResetTokenRequest.php    # NEW
│   │       ├── ResetPasswordRequest.php      # NEW
│   │       ├── UpdatePasswordRequest.php     # NEW
│   │       └── RegisterRequest.php           # CHANGED — adopts PasswordPolicy
│   ├── Providers/AppServiceProvider.php      # CHANGED — `password` limiter,
│   │                                         #   ResetPassword::createUrlUsing
│   ├── Services/PasswordService.php          # NEW — the whole feature's decisions
│   ├── Support/
│   │   ├── PasswordPolicy.php                # NEW — the one server-side rule set
│   │   ├── SessionRevoker.php                # NEW — the sessions-table purge
│   │   └── SpaRoutes.php                     # CHANGED — 2 addresses, both noindex
│   └── Models/User.php                       # UNCHANGED (already CanResetPassword)
├── routes/api.php                            # CHANGED — 4 routes
└── tests/
    ├── Feature/Http/Controllers/
    │   ├── PasswordResetControllerTest.php   # NEW
    │   └── AuthControllerTest.php            # CHANGED — updatePassword cases
    └── Unit/
        ├── Services/PasswordServiceTest.php  # NEW
        └── Support/
            ├── PasswordPolicyTest.php        # NEW
            ├── SessionRevokerTest.php        # NEW
            └── SpaRoutesTest.php             # CHANGED

frontend/
├── src/
│   ├── pages/
│   │   ├── ForgotPasswordPage.tsx            # NEW — /forgot-password
│   │   ├── ResetPasswordPage.tsx             # NEW — /reset-password/:hash
│   │   ├── LoginPage.tsx                     # CHANGED — "Forgot password?" link
│   │   └── AccountPage.tsx                   # CHANGED — renders the section
│   ├── components/AccountPasswordForm.tsx    # NEW
│   ├── lib/
│   │   ├── passwordApi.ts                    # NEW — class PasswordApi
│   │   ├── passwordModel.ts                  # NEW — class PasswordModel
│   │   └── authModel.ts                      # CHANGED — delegates the policy
│   └── App.tsx                               # CHANGED — 2 routes
└── tests/
    ├── pages/{ForgotPasswordPage,ResetPasswordPage,LoginPage,AccountPage}.test.tsx
    ├── components/AccountPasswordForm.test.tsx
    ├── lib/{passwordApi,passwordModel}.test.ts
    └── e2e/password-recovery.spec.ts         # NEW
        └── helpers/mailLog.ts                # CHANGED — latestResetLink()
```

**Structure Decision**: The established two-app layout is used unchanged. The backend puts the
feature's *decisions* in one `PasswordService` (both routes share FR-008's token voiding and
FR-016's session revocation, so splitting them would duplicate the security-relevant half), the
feature's *rules* in form requests, and the two mechanical pieces — the policy rule set and the
sessions purge — in `Support/` as pure, directly testable classes, mirroring how `RememberMe` and
`SpaRoutes` already sit there. The account-page change is one method on the existing
`AuthController` rather than a fifth controller, because it edits the requester's own account
exactly as `updateProfile` does. On the frontend the two `lib/` additions are classes of statics
per the conventions, and both pages reuse `useAuthForm` + `AuthField` so the login, register,
recovery, and reset forms are literally the same form (FR-022).

## Complexity Tracking

> No Constitution Check violations. This table is intentionally empty.
