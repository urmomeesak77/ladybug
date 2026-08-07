# Phase 0 Research: Password Recovery and Change

**Feature**: 022-password-recovery | **Date**: 2026-08-07

No `NEEDS CLARIFICATION` markers survived Technical Context — the spec's five clarifications
(2026-08-07) already settled the open behavioural questions, and every technical unknown resolved
against code that is already in the repository. What follows are the decisions that shape the
implementation, each with what was rejected and why.

---

## D1 — Use Laravel's password broker and the table that already exists

**Decision**: Build on `Illuminate\Auth\Passwords\PasswordBroker` (the `Password` facade) and the
`password_reset_tokens` table created by `backend/database/migrations/0001_01_01_000000_create_users_table.php`.
**No migration is added by this feature.**

**Rationale**: Four functional requirements are already satisfied by framework code the project
carries:

| Requirement | Framework mechanism |
|---|---|
| FR-007 — bounded validity, default 60 min | `config('auth.passwords.users.expire') = 60`; `DatabaseTokenRepository::tokenExpired()` |
| FR-008 (first half) — a new link voids the previous one | `DatabaseTokenRepository::create()` calls `deleteExisting()` before inserting; `email` is the table's PRIMARY KEY, so one row per address is structural |
| FR-009 — at most one send per address per 60 s | `config('auth.passwords.users.throttle') = 60`; `recentlyCreatedToken()` → `RESET_THROTTLED` |
| FR-018 — a database read yields no usable link | `DatabaseTokenRepository::create()` stores `$this->hasher->make($token)`; verification is `Hash::check` |

`App\Models\User` already implements `CanResetPasswordContract` (it extends
`Illuminate\Foundation\Auth\User`, which uses the `CanResetPassword` trait), so no model change is
needed either. The prototype at `C:\projects\trash` reached the same conclusion — its
`ForgotPasswordController` / `ResetPasswordController` are the stock `SendsPasswordResetEmails` /
`ResetsPasswords` traits and nothing else.

**Alternatives considered**:

- *A hand-rolled `recovery_requests` table + service.* Rejected. It would re-implement hashed
  token storage, expiry, the single-outstanding rule, and the resend interval — four chances to
  get a security-sensitive detail wrong — to gain nothing the broker does not already give.
  Principle I's "reach for the existing stack before reaching outward" is decisive.
- *Laravel Fortify / a starter kit.* Rejected outright: a new Composer dependency (Principle I)
  that would bring Blade views, its own routes, and its own opinions about redirects into a
  JSON-API-plus-SPA application.

**Consequence**: `config/auth.php`'s `expire` and `throttle` values become the feature's tunables.
The spec calls both "configuration, not hard-coded behaviour" (Assumptions), which is exactly what
they are.

---

## D2 — Link shape: an address digest in the path, the token in the fragment

**Decision**: The emailed link is

```
{FRONTEND_URL}/reset-password/{sha1(email)}#token={token}
```

built by registering `ResetPassword::createUrlUsing(...)` in `AppServiceProvider::boot`, beside
the `VerifyEmail::createUrlUsing` call that is already there.

**Rationale — the path segment**: `sha1(email)` is the handle feature 008's verification links
already carry, resolvable without a session through the indexed `users.email_sha1` column and
`UserService::findByEmailDigest`. Using it means **no page in the journey prints an account
detail** (FR-011) — not in the body, and not in the address bar either, which a plaintext `?email=`
would.

**Rationale — the fragment**: FR-018 requires the token to "never appear in the site's own logs".
A URL fragment is never transmitted to any server, never written to an access log, and never sent
in a `Referer`. That matters concretely here rather than theoretically:

- In production, `deploy/web/default.conf`'s `location /` sends **every** SPA address that is not
  a real file to `@shell` → fastcgi → Laravel's `ShellController`. A token in the path or the
  query would therefore be logged by nginx *and* arrive in PHP's request data.
- The same is true in dev and e2e through `nginx-dev` and the Vite dev server.

The fragment makes FR-018 a property of the code rather than of three separate server
configurations that would each have to be remembered and kept in step.

**Alternatives considered**:

- *Laravel's default `/reset-password/{token}?email=…`.* Rejected on two counts: it prints the
  account's address in the address bar (FR-011) and puts the token through every log described
  above (FR-018).
- *Token in the path, `access_log off` for `/reset-password/`.* Rejected. It is a deployment
  guarantee, not a code one; it would have to be repeated in the prod, dev, and e2e nginx configs;
  and it still hands the token to PHP.
- *A signed URL like the verification link's `?expires=&signature=`.* Rejected: a signed URL is
  stateless, so it could not be *consumed* on use (FR-012/FR-014 require single use) and could not
  be voided by an account-page password change (FR-008). Statefulness is the point here, which is
  precisely the difference between verifying an address and replacing a credential.

---

## D3 — The fragment is read on every mount and never stripped

**Decision**: `ResetPasswordPage` reads `useLocation().hash` on mount and leaves it in place. It
does **not** call `history.replaceState` to clean the URL.

**Rationale**: FR-024 requires Refresh to restore the correct view. Stripping the token would
turn a perfectly live link into a dead one the moment the user reloaded — the failure mode would
look exactly like an expired link and be impossible for the user to distinguish. Keeping the
fragment costs nothing: it is on the holder's own screen, and it is already the only copy of a
secret they received by email.

---

## D4 — Non-enumeration is collapsed once, in the service, not per-branch in the controller

**Decision**: `PasswordService::sendRecoveryLink(string $email): void` returns `void`. Every
non-sendable case — no such account, disabled account (FR-006), broker `RESET_THROTTLED`
(FR-009), and a mail transport failure (FR-032) — exits through the same `return`, and the
controller unconditionally answers one 200 with one message.

**Rationale**: FR-004 and SC-003 demand that the response be identical across states. A controller
that switched on the broker's return codes would have four branches that must each be mapped to
the same output, and one missed branch is an account-existence oracle. Making the *type system*
carry the requirement — there is no value to switch on — means the oracle cannot be reintroduced
by a later edit. The paired tests in SC-003 then assert the property rather than the branch.

The disabled-account check must live above the broker regardless: `EloquentUserProvider::retrieveByCredentials`
knows nothing about `disabled_at`, so the broker would happily mail a revoked account.

**Alternatives considered**: *Returning the broker's status string and mapping it in the
controller.* Rejected as above. *Overriding the broker via a custom `UserProvider` that hides
disabled accounts.* Rejected: it would also change how `Auth::attempt` behaves at login, silently
undoing 012's deliberate decision that a disabled account gets a *distinct* 403 after its
credentials verify.

---

## D5 — A mail failure is reported and swallowed, exactly as registration already does

**Decision**: The `sendPasswordResetNotification` call is wrapped in `try { … } catch (Throwable
$e) { report($e); }`, and the generic confirmation is returned either way (FR-032).

**Rationale**: This is the identical shape `AuthController::register` already uses for the
verification mail (008's FR-011), for the identical reason: a transport failure must reach the
operator through ordinary error reporting without becoming a signal to whoever is at the form. Not
catching it would produce a 500 for a real account and a 200 for an unknown one — the sharpest
enumeration oracle the feature could possibly ship.

Note that `Illuminate\Auth\Notifications\ResetPassword` does not implement `ShouldQueue`, so the
send is synchronous and a failure is genuinely throwable at this point. The project runs no queue
worker, so this stays true.

---

## D6 — "End every other session" is a delete on the `sessions` table

**Decision**: `App\Support\SessionRevoker::revoke(User $user, ?string $keepSessionId)` deletes the
account's rows from the `sessions` table, optionally keeping one id. `PasswordService` calls it
with `null` on the recovery route (FR-021 — there is no session to keep) and with
`session()->getId()` on the account-page route (FR-028 — the acting client stays signed in). The
account's `remember_token` is rotated in the same transition.

**Rationale**: `config/session.php` sets `'driver' => env('SESSION_DRIVER', 'database')`, and
Laravel's `DatabaseSessionHandler` writes the authenticated `user_id` onto every row, so the rows
to delete are identifiable by an indexed column. This is a single, deterministic statement that
behaves the same for both routes.

Feature 018's "remember me" is a *session-lifetime extension plus a flag cookie*
(`App\Support\RememberMe`), not Laravel's `remember_token` cookie — so deleting the session rows
is what actually invalidates a remembered sign-in (FR-016), and the leftover flag cookie grants
nothing on its own. `remember_token` is rotated anyway as defence in depth, since the column
exists and a future change could start using it.

**Alternatives considered**:

- *`Auth::logoutOtherDevices($password)`.* Rejected on two independent grounds: it requires the
  user's plaintext password, which the recovery route never has, and it only takes effect through
  the `AuthenticateSession` middleware, which this application does not run.
- *Rotating a `password_changed_at` column and checking it per request.* Rejected: it adds a
  column, adds a middleware to the hot path of every request, and FR-034 explicitly forbids
  recording when a password changed.

---

## D7 — One new named limiter, `password`, capped by the existing sign-in config

**Decision**: `RateLimiter::for('password', …)` in `AppServiceProvider`, keyed by
`$request->user()?->getAuthIdentifier() ?? $request->ip()`, capped at `config('app.auth_throttle')`
(default 5/min). Applied to all four new routes.

**Rationale**: FR-010, FR-030 and FR-033 each ask for a limit "consistent with the existing
sign-in limit". Reusing the *config value* rather than the *limiter* gives the same cap while
keeping a separate bucket, which matters: sharing `throttle:auth` would mean five failed reset
attempts lock the same visitor out of logging in with the password they just successfully set.

The key expression is the one `uploadLimit` and `commentLimit` already use, and it resolves to the
two things the spec asks for without a second limiter: the anonymous recovery routes key by IP
("per requester", FR-010/FR-033) and the authenticated account-page route keys by account id
("per account", FR-030).

Reusing `app.auth_throttle` also means `backend/.env.e2e`'s existing
`AUTH_THROTTLE_PER_MINUTE=1000` already covers the new endpoints — the e2e stack needs no new
override, and no new env var enters `.env.example`.

**Consequence**: a 429 is observably different from the generic 200. This is not an enumeration
leak: the bucket is keyed by requester, never by the submitted address, so its state tells an
attacker only about their own traffic. FR-010 anticipates exactly this.

---

## D8 — A read-only `check` endpoint, so a dead link is refused on open

**Decision**: `POST /api/password/reset/check` with body `{hash, token}` → `204` when the link is
live, `403` when it is not. `ResetPasswordPage` calls it once on mount.

**Rationale**: US4 scenario 1 says a dead link must be refused *when it is opened* — not after the
user has typed and retyped a new password. FR-012 says opening must not consume the link. A
read-only endpoint satisfies both: `DatabaseTokenRepository::exists()` is a pure comparison, and
`deleteToken` runs only on a successful reset.

It is a **POST with a body**, not a `GET` with a query, for the same reason as D2: a `GET
/api/password/reset/check?token=…` would put the token straight back into nginx's access log, one
layer below the fragment that was chosen to keep it out. POST-as-a-read is already the shape this
codebase uses for `activate`/`deactivate`/`hide`.

**Cost accepted**: the check consumes one unit of the D7 budget, so a page load plus two failed
policy attempts is three of five per minute. That is comfortable for a human and still bounds
bulk token guessing, which is what FR-033 asks for. Deliberately, the SPA checks **on mount only**
— it does not re-check after a 422, because a policy failure leaves the link untouched (FR-013).

---

## D9 — The password policy is stated once per side, not once per form

**Decision**: `App\Support\PasswordPolicy::rules(): array` returns
`['required', 'string', 'confirmed', Password::min(8)->mixedCase()->numbers()]`.
`RegisterRequest`, `ResetPasswordRequest` and `UpdatePasswordRequest` all use it. On the client,
`AuthModel`'s private `passwordPolicyErrors` moves to `PasswordModel.policyErrors` as a public
static, and `AuthModel` delegates to it.

**Rationale**: the policy is currently written twice (server `RegisterRequest`, client
`AuthModel`). This feature adds two server forms and two client forms; left alone that would be
six statements of one rule, and the spec is explicit that "recovery does not introduce a stricter
or looser rule" (Assumptions, FR-013, FR-029). Extraction makes drift impossible rather than
merely discouraged, and it is a net reduction in duplication, not an addition.

**Alternatives considered**: *A custom `Rule` object.* Rejected as heavier than a static rule
array for no gain — `Illuminate\Validation\Rules\Password` already is the rule object.

---

## D10 — Nothing is recorded, and no column is added

**Decision**: No migration, no `password_changed_at`, no audit table, no security-event log.

**Rationale**: FR-034 is explicit, and it names its precedent — feature 013's deliberate
no-audit-trail choice for account deletion. The token row's `created_at` exists only to drive
expiry and the resend interval and is deleted on use, so it is not a record of anything. Ordinary
request logs never carry the token (D2). An operator-facing history is a separate feature if one
is ever wanted.

A consequence worth stating: expired token rows are not swept by this feature. Laravel ships
`php artisan auth:clear-resets` for that; it is noted in `quickstart.md` as an optional operations
step, not wired into a scheduler the project does not run.

---

## D11 — Neither recovery view is behind `RequireAnon`

**Decision**: `/forgot-password` and `/reset-password/:hash` are registered as unguarded routes in
`App.tsx`, unlike `/login` and `/register`.

**Rationale**: the spec's Edge Cases require that a signed-in person opening a recovery link has
it "honoured for the account it names, not for the signed-in one" — `RequireAnon` would bounce
them to `/` instead, breaking a case the spec calls out by name. FR-002 asks only that the request
view be *usable by* signed-out visitors, which an unguarded route is. Both addresses are marked
non-indexable in `SpaRoutes::STATIC_ROUTES` / `DYNAMIC_ROUTES` and added to `disallowedPaths()`,
matching how `/login`, `/register` and `/verify-email` are treated (FR-018's indexing clause).

Because the reset route is session-free on the server too, the honoured account is always the
link's account: `PasswordService` resolves it from the digest and never consults
`$request->user()`.

---

## D12 — Non-enumeration is a property of the *response*, not of the clock

**Decision**: FR-004's guarantee covers status, body, wording and headers. It does **not** cover
wall-clock timing, and no artificial delay or dummy work is added to equalise it. The spec was
amended to say so outright (2026-08-07) after its original phrase "same observable timing class"
was found to be undefined, unmeasured, and quietly contradicted by D4.

**Rationale**: D4's single early `return` is what makes the response impossible to vary — and it
is also what makes the *timing* vary. An eligible request mints a 64-hex token, bcrypt-hashes it,
writes a row, and hands a message to a synchronous mailer (D5, no queue worker). An unknown or
disabled address does an indexed `SELECT` and returns. The eligible path is therefore measurably
slower, and no amount of test assertion on status and body changes that.

Equalising it would mean one of two things, both rejected:

- *Dummy work on the ineligible path* — bcrypt-hash a discarded token so the two paths cost the
  same. Rejected: it burns a deliberate CPU cost on an unauthenticated endpoint for every request
  an attacker cares to send, which converts an enumeration nuisance into a cheap
  amplification lever. The endpoint's rate limit (D7) bounds the attacker either way.
- *A fixed response floor* — sleep to a constant total duration. Rejected: it holds a php-fpm
  worker per request (the pool is finite and shared with the whole site), and the floor has to
  exceed the slowest eligible request including a mail transport that D5 already assumes can hang
  before it throws. A floor that a slow mail server can exceed is not a floor.

**What the limit actually costs**: an attacker who can measure a reliable few-millisecond
difference across the network, under the 5/min per-IP cap, learns whether a *guessed* address has
an account — one address per attempt, ~5 per minute. That is the same fact the registration form
already discloses outright by design (spec, Assumptions: registration "deliberately reveals a
taken address"). Spending a CPU-amplification vector or a worker-holding sleep to defend a fact
another form gives away for free is not a trade worth making.

**Consequence**: SC-003's evidence is 20 paired attempts compared on status, body and headers —
never on duration. A future change may revisit this, but it should revisit registration's
disclosure first, since that is the cheaper oracle.
