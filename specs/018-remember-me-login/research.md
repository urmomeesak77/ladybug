# Phase 0 Research — "Remember Me" Login Session Persistence

**Feature**: `018-remember-me-login` | **Date**: 2026-08-05 | **Spec**: [spec.md](./spec.md)

Every open question from the Technical Context is resolved below. Decisions are numbered
D1–D6 and are referenced by `plan.md`, `data-model.md`, the contracts, and `quickstart.md`.

---

## D1 — How today's session actually expires (baseline, verified)

**Finding**: `backend/config/session.php:23,37,39` — driver is `env('SESSION_DRIVER', 'database')`,
but both `backend/.env:41` and `.env.example:49` pin it to **`file`**. Lifetime is
`env('SESSION_LIFETIME', 120)` (`.env:42` = `120`, minutes), `expire_on_close` is `false`
(default, not overridden). So today, every session — regardless of this feature — already
slides: `FileSessionHandler` checks the session file's mtime against `now() - lifetime` on
every read, and Laravel rewrites the file (and reissues the session cookie's `Max-Age`) on
every response. A continuously-active user never hits the 120-minute idle limit; an idle one
does.

This matters because it means the "sliding expiration" *mechanism* Ladybug needs for
Remember Me already exists in the framework for the *default* duration — the feature is really
"make that same mechanism use a different number, only for sessions that opted in," not "invent
sliding expiration from nothing."

**A `sessions` DB table already exists** (baked into
`backend/database/migrations/0001_01_01_000000_create_users_table.php:37-44`, part of Laravel's
default combined migration) but sits unused while the driver is `file`. No migration is needed
to use it, but D3 concludes we don't need it for this feature either.

---

## D2 — Mechanism: a companion cookie that retunes `session.lifetime` per request, not Laravel's stock `remember_token` recaller

**Decision**: Do **not** pass a `$remember` flag to `Auth::attempt()` and do **not** engage
Laravel's built-in "remember me" (the `users.remember_token` column + `remember_web_*` recaller
cookie). Instead:

1. At login, when the checkbox was checked, bump `config(['session.lifetime' => 10080])`
   (7 days in minutes) for the current request and queue a second, small, boolean **flag
   cookie** (`Cookie::queue()`), independent of the session cookie, with the same 7-day
   lifetime.
2. On every subsequent request, a new early middleware checks for that flag cookie's
   *presence* and — if found — makes the same `config(['session.lifetime' => 10080])` call
   **before** the session is read, so the existing sliding-expiration machinery (D1) evaluates
   the session against 7 days instead of 120 minutes for that request.
3. A second, later middleware — running after the user is resolved — re-queues the flag cookie
   fresh (new 7-day `Max-Age`) on every authenticated request, so *it* slides too. Without this
   step the flag cookie (and therefore the extended lifetime) would only last 7 days from the
   moment of login, not 7 days from last activity, which would violate FR-004.
4. Logout (`AuthController::logout`) and the disabled-account teardown
   (`EnsureAccountEnabled`) both clear the flag cookie, so a signed-out or revoked session can
   never be re-extended.

No new column, no new table, no per-user server-side state at all — the flag cookie is the
entire "was this login remembered" record, and it is scoped to exactly the one browser/session
that set it (Edge Case: "no effect on other sessions").

**Rationale**: Laravel's stock recaller (`Auth::attempt($creds, true)`) is a *fixed*-duration
cookie (`SessionGuard::createRecaller()` calls the cookie jar's `forever()` helper — effectively
~5 years — with no built-in per-app config knob short of subclassing `SessionGuard`) that is
only re-issued when it is actually *exercised* (i.e., only when the underlying session had
already died and the recaller silently re-authenticates the user into a fresh one). A user who
stays continuously active never triggers a re-issue, so the recaller's own fixed expiry — set
once at login — would eventually lapse even during unbroken daily use, and a subsequent idle
gap would then log them out despite "last activity" being recent. That directly contradicts
FR-004 ("any authenticated request... resets the remaining 7-day allowance") and the spec's own
Key Entity, which models **one session with a variable expiration**, not "short session + a
separate long-lived side-channel token." The custom per-request lifetime override maps directly
onto that model; the stock recaller does not, and reimplementing it with a custom `SessionGuard`
subclass just to get sliding behavior would be strictly more code than the cookie-plus-two-
middleware approach above.

**Alternatives rejected**:

- **Laravel's built-in `remember_token` recaller**, customized via a `SessionGuard` subclass to
  shorten `forever()` to 7 days and to force a re-issue on every request. Rejected: still more
  moving parts (subclassing an internal Auth class, registering a custom guard driver) than the
  companion-cookie approach, for a mechanism that doesn't naturally slide anyway (see above). The
  unused `users.remember_token` column stays exactly as unused as it is today — this feature
  does not touch it.
- **A new `sessions`-table column** (e.g., `remember_until`) using the DB session driver.
  Rejected: would require switching `SESSION_DRIVER` from `file` to `database` in every
  environment (dev, e2e, prod) — a much larger blast radius than this feature needs — purely to
  gain a queryable column that a cookie already gives us for free. D1 already established the
  existing file-driver expiry check is per-request-config-driven, so no DB row is required.
- **Storing the remember flag inside the session payload itself**
  (`session()->put('remember_me', true)`) instead of a separate cookie. Rejected: circular — to
  decide *how long to consider the session still valid* Laravel must first *read* the session
  file, but the very thing that tells us how long to allow it to have been idle is what we're
  trying to read. A signal that exists outside the session (the companion cookie) is what breaks
  the cycle.

---

## D3 — Where the early middleware must sit in the pipeline (verified against Sanctum's source)

**Finding**: `backend/bootstrap/app.php:21` calls `$middleware->statefulApi();`, which prepends
Sanctum's `EnsureFrontendRequestsAreStateful` to the `api` group. Reading
`vendor/laravel/sanctum/src/Http/Middleware/EnsureFrontendRequestsAreStateful.php:23-28,48-56`:
that single middleware builds and runs its **own inner pipeline** —
`EncryptCookies → AddQueuedCookiesToResponse → StartSession → VerifyCsrfToken` — and only calls
the *rest* of the app's middleware/route handling (via `$next($request)`) from inside that inner
pipeline, after `StartSession` has already started (and, for an existing session, already read)
the session.

**Decision**: The new early middleware (`ApplyRememberMeLifetime` in D2 step 2) must be
registered so it runs **before** `EnsureFrontendRequestsAreStateful`, i.e. outside and ahead of
Sanctum's inner pipeline — otherwise the config change happens too late to affect that request's
session read. Concretely: `$middleware->prependToGroup('api', ApplyRememberMeLifetime::class)`
called **after** `$middleware->statefulApi()` in `bootstrap/app.php` (each `prependToGroup` call
inserts at the front, so calling it second puts it ahead of Sanctum's own prepended entry).

Because this middleware runs *before* `EncryptCookies`, it cannot rely on the flag cookie's
*decrypted value* — only Laravel's `EncryptCookies` (which runs later, inside Sanctum's inner
pipeline) can decrypt it. This is not a problem: the middleware only needs to know the cookie is
*present* (`$request->hasCookie(...)`), never what it contains, so it works identically whether
the value it sees is plaintext or still-encrypted ciphertext. The cookie carries no
authentication authority of its own — it only tunes a lifetime number for whichever session
cookie is also present — so nothing sensitive is ever read from it pre-decryption.

The second, later middleware (D2 step 3, re-queueing the cookie so it slides) runs after the
user is resolved, so it's appended to the `api` group the ordinary way, after the existing
`EnsureAccountEnabled` (`bootstrap/app.php:26`) — that ordering means a request that
`EnsureAccountEnabled` already rejected (disabled account) never gets its flag cookie renewed.

**Verified as safe for a stateless PHP-FPM app**: `composer.json` has no `laravel/octane` /
`swoole` dependency, so each request boots a fresh application container; a runtime
`config(['session.lifetime' => ...])` mutation made mid-request cannot leak into any other
request.

---

## D4 — Login endpoint contract: one new optional boolean field

**Decision**: `LoginRequest` (`backend/app/Http/Requests/LoginRequest.php:27-32`) gains
`'remember' => ['sometimes', 'boolean']` — optional, defaults to falsy when absent, matching
FR-001's "unchecked by default." `AuthController::login()`
(`backend/app/Http/Controllers/AuthController.php:54-71`) reads it with
`$request->boolean('remember')` **after** the existing disabled-account check (line 59), so a
disabled account's login attempt is refused exactly as it is today regardless of the checkbox —
the remember-handling only runs on the success path. `register()` is untouched: there is no
"remember me" checkbox on the registration form per the spec (login-only feature).

---

## D5 — Frontend: `remember` is a plain boolean, kept out of `useAuthForm`

**Finding**: `useAuthForm<T extends Record<string, string>>` (`frontend/src/hooks/useAuthForm.ts:12`)
is generically typed over **string-valued** fields only (it drives blur-validation and
server-error mapping keyed by string values), and `AuthField`
(`frontend/src/components/AuthField.tsx`) renders a single text/email/password `<input>` with a
visually-hidden label — there's no checkbox variant and no error state a checkbox would ever
need.

**Decision**: Do not add `remember` to `LoginPage`'s `LoginValues`/`useAuthForm` state. Instead:
`LoginPage` (`frontend/src/pages/LoginPage.tsx`) gets its own `useState(false)` for `remember`,
a plain checkbox rendered directly in the form (visible `<label>` wrapping the input — a real
label, not `sr-only`, since "Remember me" is meant to be read, per Principle IV) below the
password field, and `handleSubmit` calls `login({ ...form.values, remember })`
(`LoginPage.tsx:68`). `AuthApi.LoginInput` (`frontend/src/lib/authApi.ts:41`) gains
`remember: boolean`, passed straight through to the JSON body
(`AuthApi.login`, `authApi.ts:100-107`) exactly like every other field already is — no new
mapping logic needed there. `useAuth`'s `login` signature is generic over `LoginInput`
(`frontend/src/hooks/useAuth.ts:13`) so no change is needed in `AuthProvider.tsx`.

Per spec Assumption/Edge Case, the checkbox is never pre-filled from a prior visit — trivially
satisfied since `useState(false)` resets on every mount and nothing persists it client-side.

---

## D6 — Cookie naming and lifetime constant

**Decision**: New `backend/config/remember.php`, mirroring `config/session.php`'s own pattern
(`session.php:132-135`) for the cookie name:

```php
return [
    'lifetime' => (int) env('REMEMBER_ME_LIFETIME', 60 * 24 * 7), // minutes; 7 days
    'cookie' => env('REMEMBER_ME_COOKIE', Str::slug((string) env('APP_NAME', 'laravel')).'-remember'),
];
```

With `APP_NAME=Online-Trash` (`.env:1`), the real cookie name is `online-trash-remember`,
alongside the existing `online-trash-session`. `REMEMBER_ME_LIFETIME` gives an env-level escape
hatch symmetric with `SESSION_LIFETIME`, without hardcoding the number in code — useful for
manual verification (`quickstart.md` shortens it temporarily rather than waiting 7 real days).
No new dependency: this is one small config file plus two small classes, matching Principle I.
