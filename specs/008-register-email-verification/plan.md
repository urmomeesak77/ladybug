# Implementation Plan: Registration Email Verification

**Branch**: `008-register-email-verification` | **Date**: 2026-07-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-register-email-verification/spec.md`

## Summary

Prove that a registrant controls the email address they gave. On successful
registration the account is created unverified and a verification email is sent;
its link — account-bound, tamper-evident, 24-hour-limited — lands on a frontend
page that calls the API to mark the account verified (`email_verified_at`).
Signed-in unverified users can resend the message (rate-limited 6/min) and see
their status on the account page. Verification gates nothing yet (FR-009).

Technical approach: **Laravel's built-in email-verification machinery**, exactly
as the prototype used it (`User implements MustVerifyEmail`, signed temporary
URLs, `throttle:6,1`), adapted to the decoupled SPA: the notification's URL is
rewritten to a frontend route (`/verify-email/{hash}?expires&signature`) via
`VerifyEmail::createUrlUsing`, and the SPA forwards the components to
`GET /api/email/verify/{hash}` validated with `signed:relative` +
`auth:sanctum`. The link exposes **no identifiers** — `{hash}` is a sha1 digest
of the recipient's own email, not a database id or public code; a small
in-house `VerifyEmailRequest` replaces the stock `EmailVerificationRequest`,
which assumes the user's DB id in the path (research D3). The notification is
dispatched directly in `register` inside a
try/catch so registration never fails on mail-transport errors (FR-011). Dev
and e2e keep the `log` mailer; the Playwright spec extracts the link from
`storage/logs/laravel.log` with a small in-house quoted-printable decoder — no
new package, no new container. **Zero new dependencies.**

## Technical Context

**Language/Version**: PHP 8.2+ (`declare(strict_types=1)`, PSR-12) on Laravel 12;
TypeScript ~5 (strict) on React 18.3 built with Vite.

**Primary Dependencies**: None added. Backend uses framework built-ins already
present: `MustVerifyEmail` contract, `Illuminate\Auth\Notifications\VerifyEmail`,
signed URLs, the mail subsystem (`log` transport in dev), Sanctum session auth,
the `throttle` middleware. Frontend uses native `fetch` and the existing
`react-router-dom`.

**Storage**: MySQL via Eloquent. **No schema change** — `users.email_verified_at`
(nullable timestamp) has existed since the 001 users migration and is exactly the
verification record the spec asks for. Pre-existing accounts have it `NULL`,
i.e. unverified, satisfying the migration-free edge case.

**Testing**: Backend PHPUnit on SQLite `:memory:` with `Notification::fake()` /
mail assertions; feature tests for the two new endpoints plus register-flow
changes, all under the ≥90% gate over `app/`. Frontend Vitest with coverage over
**all of `src/`** (the gate widened after 007), so the two new pages, guard and
provider edits, and lib additions each get mirrored tests. Playwright e2e drives
register → read link from the backend log → verify → account shows verified,
against the disposable `docker-compose.e2e.yml` stack.

**Target Platform**: Decoupled web app — Vite SPA (≈320px → wide desktop,
evergreen browsers) over JSON to the Laravel API; dev origins
`localhost:5173` (SPA) / `localhost:8000` (API), e2e `5174`/`8001`.

**Project Type**: Web application — `backend/` Laravel API + `frontend/` React
SPA. This feature touches **both** apps.

**Performance Goals**: Verification email is dispatched synchronously inside the
register request (well within SC-001's 1 minute); verify/resend are single small
requests; the whole register→verified path fits SC-002's 2 minutes.

**Constraints**: Zero new dependencies (Principle I); real shareable URLs for
notice/confirmation/failure pages that survive refresh — verification is
idempotent so re-firing on refresh is safe (Principle III, FR-005/FR-010);
status never conveyed by color alone, labeled controls, `aria-live` feedback
(Principle IV, FR-008); tamper-evident signed links, server-side validation,
rate-limited resend, secrets in env (Principle VI, FR-002/FR-004/FR-006);
≥90% coverage both stacks with mirrored tests (Principle VII); pages render in
the shared responsive shell (Principle VIII). Verification must not restrict
existing capabilities (FR-009) — no `verified` middleware anywhere.

**Scale/Scope**: 2 new backend endpoints + notification-URL customization +
resource/env edits; frontend 2 new pages, return-to support in the auth guard +
login, account-page status block, auth API/model extensions; mirrored tests on
both stacks plus one new Playwright spec and a log-reading e2e helper.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|-----------|------|--------|
| I. Minimal Dependencies | New deps need approval + rationale | **PASS** — zero new npm/Composer packages and zero new containers. Everything used (MustVerifyEmail, VerifyEmail notification, signed URLs, log mailer, throttle) ships with the Laravel already installed. Mailpit (the prototype's mail catcher) was considered and rejected as a new infra dependency; the log mailer + an in-house link extractor covers dev and e2e (research D7). |
| II. Coding Conventions | PSR-12/4-space/strict_types, PHP fns <30 lines; 2-space/semicolons/camelCase, TS fns <50 lines; braces on single-line bodies; comments explain *why* | **PASS (planned)** — a thin `EmailVerificationController` over framework calls; small pure additions to `lib/` classes; Pint + ESLint enforce. |
| III. Browser-Native Navigation | Real URLs, Back/Forward/Refresh restore, deep-linkable | **PASS** — `/verify-email` (notice) and `/verify-email/:hash` (link landing: confirmation/already/failure states) are real routes; refreshing the landing page re-calls the idempotent API and reproduces the same state; Back/Forward work as normal history entries (FR-010). |
| IV. Theme & Accessibility | `prefers-color-scheme`; color not sole signal; alt/labels/aria | **PASS** — pages use the shared themed layout; status is stated in text ("verified"/"not verified"), never color alone; resend is a labeled `<button>`; async feedback announced via the existing notice dialog / `aria-live` (FR-008). |
| V. Stable Meme Identifiers | 10-char code in meme URLs | **N/A** — no meme URLs. The verification link exposes **no identifier at all** (owner requirement): no DB id, no public code — only a sha1 digest of the recipient's own email, signed and auth-bound (research D3). |
| VI. Security & Input Validation | Server-side validation; parameterized; escape output; secrets in env | **PASS** — links are HMAC-signed against `APP_KEY` and expire after 24 h (FR-002); `signed:relative` + the in-house `VerifyEmailRequest` reject tampering, expiry, and cross-account use (403, no state change — FR-004, SC-003); verify and resend are `auth:sanctum` + `throttle:6,1` (FR-006); mail failure at register is caught and reported without leaking transport errors (FR-011); no secrets in code, `FRONTEND_URL` in env. |
| VII. Test Coverage & Organization | ≥90%; tests mirror source under `tests/` | **PASS (planned)** — backend: `EmailVerificationControllerTest` (valid/expired/tampered/mismatched/already-verified/throttled) + `AuthControllerTest` additions (notification sent; register survives mail failure); frontend: mirrored tests for both pages, guard/login/provider edits, and lib additions; e2e spec for the full loop. |
| VIII. Responsive Layout | Mobile→desktop, no horizontal scroll, fluid units, touch targets | **PASS** — both new pages are simple text+button views inside the existing responsive shell; controls reuse the auth form's touch-target sizing. |

**Initial gate: PASS** — no violations, Complexity Tracking stays empty.

**Post-Phase-1 re-check: PASS** — the designed contracts (two endpoints, signed
relative URLs, frontend landing pages, log-based e2e capture) introduce no
dependencies and uphold every gate above.

## Project Structure

### Documentation (this feature)

```text
specs/008-register-email-verification/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output (decisions D1–D9)
├── data-model.md        # Phase 1 output (verification state, link anatomy)
├── quickstart.md        # Phase 1 output (run + validation guide)
├── contracts/           # Phase 1 output
│   ├── verification-api.md      # verify + resend endpoints, changed user payloads
│   └── frontend.md              # routes, pages, guard/login/account changes, lib API
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── Http/Controllers/
│   │   ├── AuthController.php              # EDIT: register() dispatches the verification
│   │   │                                   #   notification in try/catch + report() (FR-011)
│   │   └── EmailVerificationController.php # NEW: verify (VerifyEmailRequest → mark verified),
│   │                                       #   send (resend or 409 when already verified)
│   ├── Http/Requests/VerifyEmailRequest.php # NEW: authorize = hash_equals(sha1(user email),
│   │                                       #   {hash}) — no ids in the URL (research D3)
│   ├── Http/Resources/UserResource.php     # EDIT: expose email_verified_at
│   ├── Models/User.php                     # EDIT: implements MustVerifyEmail
│   └── Providers/AppServiceProvider.php    # EDIT: VerifyEmail::createUrlUsing → frontend URL
│                                           #   from a relative signed route (research D3)
├── config/auth.php                         # EDIT: verification.expire = 1440 (24 h)
├── routes/api.php                          # EDIT: GET  /email/verify/{hash}
│                                           #         (auth:sanctum, signed:relative, throttle:6,1,
│                                           #          name: verification.verify)
│                                           #       POST /email/verification-notification
│                                           #         (auth:sanctum, throttle:6,1)
├── .env.example                            # EDIT: FRONTEND_URL=http://localhost:5173
├── .env.e2e                                # EDIT: FRONTEND_URL=http://localhost:5174, MAIL_MAILER=log
└── tests/
    └── Feature/Http/Controllers/
        ├── AuthControllerTest.php              # EDIT: notification sent on register; register
        │                                       #   still 201 when mail transport throws
        └── EmailVerificationControllerTest.php # NEW: happy/expired/tampered/mismatch/
                                                #   already-verified/anon/throttle cases

frontend/
├── src/
│   ├── lib/
│   │   ├── authApi.ts                      # EDIT: AuthUser.emailVerifiedAt; verifyEmail(),
│   │   │                                   #   resendVerification() with typed outcomes
│   │   └── authModel.ts                    # EDIT: verification outcome→view-state mapping,
│   │                                       #   link-param parsing/validation helpers
│   ├── hooks/useAuth.ts                    # EDIT: context gains refresh() (re-probe /api/user
│   │                                       #   so emailVerifiedAt updates after verifying)
│   ├── components/
│   │   ├── AuthProvider.tsx                # EDIT: implement refresh()
│   │   └── RequireAuth.tsx                 # EDIT: pass the blocked location to /login
│   │                                       #   (router state) so login can return (scenario 4)
│   ├── pages/
│   │   ├── LoginPage.tsx                   # EDIT: navigate to state.from ?? '/' on success
│   │   ├── RegisterPage.tsx                # EDIT: navigate to /verify-email (FR-007)
│   │   ├── AccountPage.tsx                 # EDIT: verification status + resend (FR-008)
│   │   ├── VerifyEmailNoticePage.tsx       # NEW: "check your inbox at {email}" + resend
│   │   └── VerifyEmailPage.tsx             # NEW: link landing — calls API; verifying/
│   │                                       #   confirmed/already-verified/invalid-or-expired
│   ├── styles/theme.css                    # EXTEND: verification status + notice styles
│   └── App.tsx                             # EDIT: /verify-email + /verify-email/:hash
│                                           #   routes (both RequireAuth-wrapped)
├── e2e/
│   ├── helpers/mailLog.ts                  # NEW: read laravel.log, decode quoted-printable,
│   │                                       #   extract the newest verification URL (in-house)
│   └── verify-email.spec.ts                # NEW: register → link from log → verified account
└── tests/                                  # mirrors src/ (Principle VII)
    ├── lib/{authApi,authModel}.test.ts     # EDIT: new methods/outcomes
    ├── hooks/useAuth.test.tsx              # EDIT: refresh()
    ├── components/{AuthProvider,RequireAuth}.test.tsx  # EDIT
    └── pages/{LoginPage,RegisterPage,AccountPage,VerifyEmailNoticePage,VerifyEmailPage}.test.tsx
```

**Structure Decision**: Backend keeps the thin-controller pattern — the new
`EmailVerificationController` is glue over the in-house `VerifyEmailRequest`
(sha1-of-email authorization, no ids in the URL) and
`sendEmailVerificationNotification()`, with the URL customization isolated
in `AppServiceProvider`. Frontend follows the established split: typed outcomes
and pure logic in `lib/` classes, thin pages/guards over them, every touched
module with a mirrored test (the Vitest gate now spans all of `src/`). E2e mail
capture stays inside the existing disposable stack by parsing the log mailer's
output instead of adding a mail-catcher service.

## Complexity Tracking

> No constitutional violations — table intentionally empty.
