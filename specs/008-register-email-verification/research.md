# Research: Registration Email Verification

**Feature**: 008-register-email-verification | **Date**: 2026-07-07

The spec's input line — "check prototype how validating by email is implemented" —
made the prototype (`C:\projects\trash`) the primary research subject. Findings
below; each decision records what was chosen, why, and what was rejected.

## D1 — Verification mechanism: Laravel's built-in machinery (prototype parity)

**Decision**: Use the framework's stock email-verification stack, as the
prototype does: `User implements MustVerifyEmail`, the built-in
`Illuminate\Auth\Notifications\VerifyEmail` notification, temporary signed URLs,
`markEmailAsVerified()` + the `Verified` event to record verification, and
`throttle:6,1` on verify/resend. One deliberate deviation: the stock
`EmailVerificationRequest` is replaced by a small in-house `VerifyEmailRequest`
because the stock request requires the user's DB id in the URL, which the owner
does not want exposed (D3).

**Prototype evidence**:
- `app/Models/User.php` — `class User extends Authenticatable implements MustVerifyEmail`.
- `routes/web.php` — `GET /email/verify/{id}/{hash}` with `['auth', 'signed']`,
  fulfilled via `EmailVerificationRequest`; `GET /email/verify` notice view.
- `app/Http/Controllers/Auth/VerificationController.php` — `VerifiesEmails`
  trait with `signed` on verify and `throttle:6,1` on verify + resend.
- `app/Services/UserService.php:21` — `event(new Registered($user))` after
  create, which triggers `SendEmailVerificationNotification`.

**Rationale**: The built-in flow is exactly the spec's "verification link"
entity — account-bound (`{id}` + `sha1(email)` hash), tamper-evident (HMAC
signature over the URL against `APP_KEY`), time-limited (signature expiry) and
idempotent (`fulfill()` no-ops when already verified). Zero new code for token
generation/storage, zero new dependencies (Principle I).

**Alternatives considered**:
- *Custom token table* (random token column + lookup): more code, a migration,
  and hand-rolled expiry/tamper logic the framework already provides. Rejected.
- *Laravel Fortify*: brings the whole headless-auth surface for one feature and
  is a new Composer dependency. Rejected (Principle I).

## D2 — Verification record: reuse `users.email_verified_at`, no migration

**Decision**: The nullable `email_verified_at` timestamp created by the 001
users migration is the verification state: `NULL` = unverified, a timestamp =
verified at that moment (FR-001/FR-003). The `datetime` cast already exists on
the model.

**Rationale**: Nothing to migrate; pre-existing accounts (007-era, seeded) are
`NULL` and therefore correctly "treated as unverified, recoverable via resend"
(spec edge case) with no data work at all.

**Alternatives considered**: a separate `email_verifications` table — needless
normalization for a single nullable column that already exists. Rejected.

## D3 — SPA link shape: frontend URL carrying a *relative* signed API route

**Decision**: Customize the notification URL once, in
`AppServiceProvider::boot()`, via `VerifyEmail::createUrlUsing`:

1. Build a **relative** temporary signed URL for the API route
   `verification.verify` (`GET /api/email/verify/{hash}`, where `{hash}` is
   `sha1` of the recipient's email), expiring per
   `config('auth.verification.expire')`.
2. Emit it in the email as
   `{FRONTEND_URL}/verify-email/{hash}?expires=…&signature=…`.
3. The SPA landing page forwards `{hash, expires, signature}` back to the
   API URL; the route validates with the `signed:relative` middleware variant,
   so scheme/host/port differences between the two origins (5173 vs 8000 dev,
   5174 vs 8001 e2e) never break the signature.

A new `FRONTEND_URL` env var (in `.env.example` and `.env.e2e`) tells the
backend where the SPA lives; dev default `http://localhost:5173`.

**Rationale**: The email must open a *site* page (FR-007/FR-010 want real,
refresh-safe frontend URLs and the spec's confirmation/failure pages), while
signature validation must happen server-side. Signing the relative URL is the
one arrangement where the same signature is valid no matter which origin the
browser used, and it keeps the API contract identical across dev/e2e/prod.

**No identifiers in the link** (owner requirement, 2026-07-07): Laravel's
convention is `/email/verify/{id}/{hash}` with `{id}` = the user's DB
auto-increment key; the owner does not want any ids exposed to users. The id
segment is dropped entirely rather than swapped for the public account code:
the route is `auth:sanctum`-gated and always operates on the *authenticated*
user, so `hash_equals(sha1(currentUser.email), {hash})` alone binds the link to
the account — a different signed-in user fails the digest check (403), which is
exactly the cross-account edge case in the spec. `{hash}` reveals nothing: it
is a one-way digest of the recipient's own address, delivered to that address.

**Amendment (2026-07-08)**: the owner requires the link to verify in a
logged-out browser too, so the `auth:sanctum` gate is gone. The URL shape is
unchanged; the account is now resolved from the digest itself via an indexed
`users.email_sha1` column (kept in step by the `User` email mutator; computed
in PHP because SQLite — the test database — has no `sha1()` SQL function). A
session, when present, still only adds the cross-account refusal above.
Cost: the stock `EmailVerificationRequest` (hard-wired to `route('id')`) is
replaced by an in-house `VerifyEmailRequest` (~15 lines: authorize via the
digest comparison; the controller marks verification with
`markEmailAsVerified()` + `event(new Verified($user))`).

*Alternatives considered*: keeping the stock `{id}` (rejected — exposes the DB
primary key, the very thing the owner excluded); substituting the user's public
10-char code (rejected — still an identifier in the URL, still needs the custom
request, and buys nothing the auth session + digest don't already provide).

**Alternatives considered**:
- *Email links straight to the backend route, redirect to SPA after fulfill*
  (Laravel Breeze API-stack pattern): breaks spec scenario 4 — an anonymous
  browser hitting an `auth:sanctum` API route gets a bare 401 JSON, and after
  logging in on the SPA the user would have to reopen the email. The SPA
  landing page + return-to login preserves the link across sign-in. Rejected.
- *Absolute signed URL + APP_URL host-matching*: fragile across the port-shifted
  e2e stack and any future domain split. Rejected in favor of `signed:relative`.

## D4 — Dispatch: direct send in try/catch at register (FR-011)

**Decision**: `AuthController::register()` calls
`$user->sendEmailVerificationNotification()` inside `try/catch` after
`UserService::create()`; a transport failure is `report()`-ed and registration
still returns 201. The resend endpoint gives the user their recovery path.

**Rationale**: The prototype fires `event(new Registered($user))` and lets the
framework listener send. That couples dispatch to the event pipeline, where a
synchronous transport exception would bubble up and fail registration —
exactly what FR-011 forbids. A direct, guarded call is smaller, makes the
failure path explicit, and is trivially testable (`Notification::fake()`, and a
faked transport that throws).

**Alternatives considered**: queueing the notification — there is no queue
worker in this project's runtime and adding one is out of scope. Rejected.

## D5 — Link lifetime: 24 h via `auth.verification.expire`

**Decision**: Set `verification.expire => 1440` (minutes) in `config/auth.php`.
The built-in notification reads exactly this key when creating the temporary
signed URL, so the clarified 24-hour lifetime (spec, FR-002) is one config line.
Framework default is 60 minutes — too short per the clarification.

## D6 — Resend rate limit: `throttle:6,1` per user

**Decision**: Both new routes get `throttle:6,1` (6/min), matching the
prototype's `VerificationController` and the spec assumption. Keyed by
authenticated user (Laravel's default for signed-in requests). 429 responses
surface in the SPA as a clear "try again in a minute" message (SC-005).

**Alternatives considered**: a named limiter in `AppServiceProvider` like
`throttle:auth` — worthwhile only if limits need env tuning; the spec fixes the
rate, and inline `6,1` is what the prototype ships. Kept simple.

## D7 — Dev/e2e mail capture: `log` mailer + in-house link extraction

**Decision**: Keep `MAIL_MAILER=log` (already the `.env.example` default) in
dev and e2e. The rendered email lands in `storage/logs/laravel.log`. For the
Playwright e2e, a small helper (`frontend/e2e/helpers/mailLog.ts`) reads the
log from the host (the e2e backend bind-mounts `./backend:/app`, so the file is
`backend/storage/logs/laravel.log`), decodes the MIME quoted-printable body
(`=3D`, soft line breaks), and extracts the newest verification URL. Manual dev
verification reads the same log (see quickstart).

**Rationale**: Zero new anything. The prototype used Mailpit
(`MAIL_HOST=mailpit:1025`), which is the nicer inbox UX but means a new
container image in the compose stacks — a dependency decision under
Principle I's spirit for no automated-test benefit the log file doesn't already
provide. Quoted-printable decoding is ~10 lines of TypeScript.

**Alternatives considered**:
- *Mailpit service + REST API*: rejected as above (may be revisited for DX
  later, with the explicit approval Principle I requires).
- *A test-only backend endpoint exposing the last link*: test scaffolding in
  production routing. Rejected.

## D8 — Post-registration landing: dedicated `/verify-email` notice route

**Decision**: `RegisterPage` stops navigating to `/` and instead navigates to
`/verify-email`, a `RequireAuth`-wrapped notice page showing "check your inbox
at {email}" (the address comes from auth context) plus the resend button
(FR-007, clarified in spec). The link-landing route is
`/verify-email/:hash`; its confirmation / already-verified /
invalid-or-expired states all live at that same real URL, driven by the
server's idempotent answer, so refresh/Back/Forward reproduce them (FR-010).

**Rationale**: Distinct real URLs with server-derived state is the smallest
design satisfying FR-007 + FR-010; wrapping both routes in `RequireAuth` gives
spec scenario 4 (sign in → verification completes) for free once the guard
learns return-to (D9).

## D9 — Return-to after login (spec scenario 4)

**Decision**: `RequireAuth` passes the blocked location to `/login` via router
state (`<Navigate to="/login" state={{ from: location }} />`); `LoginPage`
navigates to `state.from ?? '/'` on success. Opening a verification link while
signed out therefore lands on login and returns to the link URL, which then
verifies — the link is never lost.

**Rationale**: Router state survives the redirect without polluting the URL,
works for any future protected route, and is the idiomatic react-router
pattern. `RequireAnon`'s redirect-authed-to-`/` behavior is unchanged (login
page itself was never the destination).

**Amendment (2026-07-08)**: the verification landing page is no longer behind
`RequireAuth` — the link verifies session-free (see the D3 amendment) — so
scenario 4 no longer relies on this return-to path. The mechanism itself stays:
it still serves every other guarded route (e.g. `/account`, `/upload`).

**Alternatives considered**: a `?next=` query param — visible, shareable, and
needs open-redirect guarding. Router state avoids all three. Rejected.
