# Phase 0 Research — Sign In / Sign Up with a Google Account

**Feature**: `017-google-oauth-login` | **Date**: 2026-07-29 | **Spec**: [spec.md](./spec.md)

Every NEEDS CLARIFICATION from the Technical Context is resolved below. Decisions are
numbered D1–D17 and are referenced by `plan.md`, `data-model.md`, the contracts, and
`quickstart.md`.

---

## D1 — In-house flow, and it costs no new dependency

**Decision**: Implement the authorization-code flow by hand against Google's documented
endpoints, using Laravel's `Http` client. **No new Composer or npm package.**

**Rationale**: The spec already recorded this as a clarification, but it rested on an
unverified premise — "the HTTP client the stack already ships". Verified:

```
$ python -c "…json.load(open('composer.lock'))…"
PROD: ['guzzlehttp/guzzle', 'guzzlehttp/promises', 'guzzlehttp/psr7',
       'guzzlehttp/uri-template', 'psr/http-client']
DEV:  []
```

`guzzlehttp/guzzle` is in `composer.lock`'s **`packages`** array, not `packages-dev`, and
`backend/vendor/guzzlehttp/guzzle` exists. `deploy/php/Dockerfile` installs with
`composer install --no-dev`, so the `Http` facade is present in production, not just in dev.
The premise holds; the assumption is now a fact.

The whole exchange is two HTTP interactions: a `302` we compose ourselves, and one
`POST` to Google's token endpoint. That is not a package's worth of work.

**Alternatives rejected**:

- **`laravel/socialite`** — a multi-provider abstraction, its stateless/stateful session
  handling, and a transitive dependency graph, for one provider and one redirect. Principle I's
  "do not pull in a monolithic framework for one function" is exactly this case.
- **`google/apiclient`** — an order of magnitude larger again, and aimed at calling Google
  *APIs*, which this feature explicitly does not do (Out of Scope).
- **`firebase/php-jwt`** — would only be needed if we verified the ID token's signature.
  D5 shows we do not have to. See D5 for why that is sound rather than lazy.

---

## D2 — Where the routes live: `routes/web.php` under an `/api/` prefix

**Decision**: Register both endpoints in `backend/routes/web.php`, **above** the SPA shell
catch-all, inside `Route::prefix('api')`:

```
GET /api/auth/google/redirect   → GoogleAuthController@redirect
GET /api/auth/google/callback   → GoogleAuthController@callback
```

They therefore run under the **`web` middleware group** — `EncryptCookies`,
`AddQueuedCookiesToResponse`, `StartSession`, `ShareErrorsFromSession`, `ValidateCsrfToken`,
`SubstituteBindings` — unconditionally.

**Rationale — this is the single most consequential finding of Phase 0.** The obvious home is
`routes/api.php`, and it does not work. `bootstrap/app.php` calls `$middleware->statefulApi()`,
which fronts the `api` group with Sanctum's `EnsureFrontendRequestsAreStateful`. That middleware
applies the session/cookie/CSRF stack **only when `fromFrontend($request)` is true**, i.e. when
the request's `Origin`/`Referer` matches `SANCTUM_STATEFUL_DOMAINS`. The callback does not arrive
from our SPA — it arrives as a **top-level browser redirect from `accounts.google.com`**. Under
the `api` group there would be no session on that request, so:

- the `state` written before the redirect could not be read back (FR-003 unimplementable), and
- `Auth::login()` would write to a session that is never persisted (FR-006 silently broken).

Both failures are invisible to a unit test that fakes the request and would surface only in a
real browser. The `web` group starts the session for every request regardless of who referred it.

The `/api/` prefix is kept because `deploy/web/default.conf` routes
`location ~ ^/(api|up|sanctum)(/|$)` to php-fpm explicitly. That is the deterministic path to
Laravel in production. `routes/web.php`'s catch-all already excludes the `api` segment
(`^(?!(api|up|sanctum|storage)(/|$)).*$`), so an explicitly registered `/api/...` route cannot
collide with the shell.

**CSRF is not an obstacle**: both routes are `GET`, and `ValidateCsrfToken` only inspects unsafe
verbs. The OAuth `state` parameter *is* this flow's CSRF defence (D3).

**Alternatives rejected**:

- **`routes/api.php` + `->middleware('web')`** — stacks the `web` group *on top of* the `api`
  group. Sanctum's middleware still runs first and, for a request that genuinely is from the
  frontend (the *start* route, navigated from our own SPA), runs its own inner pipeline
  containing `EncryptCookies`, `ValidateCsrfToken` and `AuthenticateSession` — which the outer
  `web` group then runs a second time. Double cookie decryption, and different behaviour on the
  two routes of one flow. Rejected as fragile.
- **`/auth/google/*` with no `api` prefix** — works, but in production it would reach Laravel via
  nginx's `location /` → `try_files $uri @shell` fallback, i.e. through the SPA-shell path built
  by feature 016. An auth endpoint answering out of the shell route is a confusing place to put
  it, and it is a path that reaches `@shell` while deliberately *not* being an `SpaRoutes` entry.
- **A third route file** — extra `withRouting()` wiring for no behavioural gain.

---

## D3 — Flow state lives in the session, not in a table

**Decision**: One session key, `oauth.google`, holding an array:

| Key | Value |
|---|---|
| `state` | `bin2hex(random_bytes(32))` — 64 hex chars |
| `code_verifier` | PKCE verifier, see D4 |
| `expires_at` | Unix timestamp, now + 10 minutes |
| `redirect` | validated intended path, default `/` (D10) |

Consumed with `$request->session()->pull('oauth.google')` — a read-and-forget, which makes the
token **single-use** in one operation with no separate cleanup step.

**How this satisfies FR-003, clause by clause**:

| FR-003 clause | Mechanism |
|---|---|
| unguessable | 256 bits from `random_bytes` |
| single-use | `pull()` removes it; a replay finds nothing → `state` failure |
| time-limited | `expires_at`, checked on consumption |
| bound to the browser that started it | it lives in that browser's session cookie and nowhere else |
| reject missing / altered / mismatched | `hash_equals(stored, returned)` after the presence check |

The consumption happens **before** `Auth::login()` and `session()->regenerate()`, so session
regeneration can never race the state read.

**Alternatives rejected**:

- **An `oauth_states` table** — a migration, an index, a pruning command and a second source of
  truth, to reproduce what a session cookie already gives. The spec itself calls this entity
  "new, transient". Rejected.
- **A signed/encrypted stateless `state` (a self-describing token)** — removes the browser
  binding, which is precisely the property FR-003 asks for. Rejected.

---

## D4 — PKCE (S256) is included

**Decision**: Add PKCE. `code_verifier` = 64 random hex chars in the flow state;
`code_challenge` = `rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=')`
on the authorize URL with `code_challenge_method=S256`; the verifier is posted back at the token
exchange.

**Rationale**: about twelve lines, no dependency, and it binds the authorization code to the
browser that started the flow. Without it, a code that leaks anywhere between Google and our
server — a referrer header, shared-machine browser history, a logging proxy — is redeemable by
whoever holds it plus our client secret. With it, redemption also requires the verifier, which
never leaves the server-side session. Google supports PKCE for web-server clients.

This is defence in depth layered *on top of* the `state` check, not a replacement for it: `state`
protects the browser from a forged sign-in, PKCE protects the code from interception.

**Alternative rejected**: skipping PKCE because the client is confidential. Defensible, and it is
what the spec's assumption implicitly described — but the cost here is a hash and two session
fields, which is below the threshold where "minimal" is a real argument.

---

## D5 — Trust the ID token from the token-endpoint response; verify `iss`/`aud`/`exp`, not the signature

**Decision**: Read the identity claims (`sub`, `email`, `email_verified`, `name`) from the
`id_token` field of the **token-endpoint response**. Decode the JWT payload segment (base64url →
JSON) **without verifying the RS256 signature**, then hard-check:

- `iss` ∈ `{"accounts.google.com", "https://accounts.google.com"}`
- `aud` === our configured `client_id`
- `exp` > now (with no leeway)

Any failure → `provider` refusal. Nothing from the browser's query string is ever trusted beyond
`code` and `state`, and `code` is only ever redeemed server-side.

**Rationale (FR-004)**: OpenID Connect Core §3.1.3.7 and Google's own OAuth documentation both
state that a client which obtains the ID token **directly from the token endpoint over a TLS
channel it authenticated** (our `client_id` + `client_secret`) may skip signature validation —
the channel already establishes issuer authenticity, which is the only thing the signature adds.
This is exactly the property the spec's Assumptions relied on to justify hand-rolling the flow.

The `aud`/`iss`/`exp` checks remain mandatory and are three comparisons. They are what stops a
token minted for a *different* application from being replayed at ours.

**Note — `App\Utils\Base64` is not the tool for this.** It is an integer→string encoder for
minting public hashes (it walks a 64-character map with `bcmod`/`bcdiv`); it is **not** a byte
codec and cannot decode a JWT segment. Use PHP's built-in
`base64_decode(strtr($segment, '-_', '+/'))` with padding restored, wrapped in a new
`App\Utils\Jwt`.

**Alternatives rejected**:

- **A second call to `https://openidconnect.googleapis.com/v1/userinfo`** — an extra round trip
  and an extra failure mode on every single sign-in, for claims already in hand.
- **Full JWKS fetch + RS256 verification** — key fetching, caching and rotation. *This* is the
  part that would genuinely justify a package, and it buys nothing here because the token never
  traverses the browser. Recorded in `plan.md` → Complexity Tracking so it is not re-litigated.

---

## D6 — `users.password` becomes nullable; FR-020 is proved, not assumed

**Decision**: A migration changes `users.password` to `nullable()`. Google-created accounts store
`null`. Laravel 11+ modifies columns natively, so `->change()` needs no `doctrine/dbal`
(Principle I is untouched).

**Why FR-020 already holds, and why we still test it explicitly**: `Auth::attempt()` reaches
`EloquentUserProvider::validateCredentials()` → `Hash::check($plain, $user->getAuthPassword())`,
and `AbstractHasher::check()` returns `false` immediately when the stored hash is `null` or `''`.
The framework fails closed. But FR-020 and SC-008 are security requirements, and a security
requirement that rests on an unasserted framework internal is one upgrade away from being false.
So the design adds:

1. `LoginRequest` keeps `password` **required** — a missing password is a `422`, never an attempt.
2. A feature test: an account with `password === null` fails login with a `401` whose body is
   **byte-identical** to the wrong-password `401` (SC-008 — the form must not become an oracle
   for which accounts are Google-only).
3. A unit test asserting `Hash::check('', null) === false` and `Hash::check('', '') === false`.

**Rollback honesty**: the migration's `down()` restores `NOT NULL`. On an empty schema (which is
what `MigrationReversibilityTest` exercises) that is clean. On a live database that already holds
passwordless accounts, MySQL would either error under strict mode or coerce `NULL` to `''` — so
rolling this migration back in production is a **runbook step, not a one-liner**, and is written
down in `quickstart.md` §6 rather than papered over in code.

---

## D7 — `user_identities`: both directions of FR-012 are database constraints

**Decision**: One new table.

```
user_identities
  id                bigint PK
  user_id           FK → users.id, cascadeOnDelete      (FR-032)
  provider          string(32)                          ('google')
  provider_user_id  string(255)                         (Google `sub`)
  created_at        timestamp                           ("when the link was made")
  updated_at        timestamp
  UNIQUE (provider, provider_user_id)                   one Google acct → ≤1 Ladybug acct
  UNIQUE (user_id, provider)                            one Ladybug acct → ≤1 Google acct
```

**Rationale**: FR-012 is stated as a bidirectional invariant, so it is expressed as two unique
indexes rather than as two `if` statements. Application code can be raced; an index cannot. The
service still checks explicitly (to produce the right message), but a lost race degrades to a
`UniqueConstraintViolationException` that the service handles (D8) instead of to a duplicate link.

`cascadeOnDelete` implements FR-032 directly and is the **opposite** of the `nullOnDelete` used
for `trashposts.user_id` and `comments.user_id` in feature 013. That difference is intentional and
is the reason the spec's Key Entities section spells it out: an orphaned meme is still a meme, but
an ownerless link is unmatchable garbage that would make the one-to-one rule refuse its own person
forever.

Index width check: `(32 + 255) × 4` bytes utf8mb4 = 1148 < InnoDB's 3072-byte limit on DYNAMIC
row format. No prefix lengths needed. Google's `sub` is currently 21 digits.

**`provider_user_id` is never serialized** — it appears in no resource, no route parameter and no
API response (FR-022, SC-009), exactly like the database id.

**Alternative rejected**: two nullable columns on `users` (`google_id`, `google_linked_at`).
Cheaper today, but it hard-codes "one provider forever" into the schema the moment a second
provider is considered, and it cannot express the `(provider, provider_user_id)` uniqueness that
FR-012 needs. The spec's Assumptions explicitly keep the door open for a later provider.

---

## D8 — The resolution algorithm, and why its order is load-bearing

**Decision**: one method, one transaction, this exact order:

```
1  reject unless email present AND email_verified true      → 'unverified_email'   FR-005
   ── open transaction ──
2  identity ← UserIdentity(provider=google, sub) lockForUpdate
3  if identity found:
       user ← identity.user
       if user disabled → refuse 'disabled', write nothing                        FR-017
       return user                                                          FR-009 / US2
4  user ← User(email = claim email) lockForUpdate
5  if user found:
       if user disabled  → refuse 'disabled', write nothing            FR-017 / US5 AS4
       if user already has a google identity → refuse 'already_linked'  FR-012 / US3 AS6
       attach link;  markEmailAsVerified() if not already verified      FR-011 / FR-014
       return user
6  create user (no password, verified now, member role, fresh 10-char hash)
   + attach link                                                 FR-010 / FR-013 / FR-014
   ── commit ──
```

**Why the order is not negotiable**:

- **Step 1 before everything** — FR-005 is the load-bearing guard under the auto-link. An address
  Google has not confirmed must never reach step 5. Putting it anywhere later would make US3 AS5
  false.
- **Disabled checked at steps 3 *and* 5, before any write** — the 2026-07-29 clarification
  ("refuse first, write nothing") and US5 AS4. A disabled account must not silently acquire a link
  on a sign-in it was always going to refuse; SC-006 requires the account be left byte-for-byte
  unchanged. Two separate checks, because the disabled account can be reached by either path.
- **Step 2 before step 4** — FR-009 and US3 AS3: once linked, recognition is by `sub` and the
  email collision path is never re-entered. This is what makes SC-003 ("still the same account
  after they change their email at Google") true.
- **Step 5 never touches password, role, rating, uploads, comments or disabled state** — FR-015.
  The only writes are the `user_identities` insert and, conditionally, `email_verified_at`.

**Concurrency (US4 AS5 — double-click / reloaded return URL)**: steps 2–6 run inside one
`DB::transaction` with `lockForUpdate()` on both lookups. The second request blocks until the
first commits, then finds the link at step 2 and takes the returning-visitor path. If a race still
slips through (different connections, no row to lock at step 2), the unique indexes from D7 raise
`UniqueConstraintViolationException`; the service catches it and re-runs the resolution **once**,
which now finds the link. Net effect: at most one account, at most one session.

The single-use `state` (D3) makes the common case moot — a reloaded return URL fails the state
check before reaching any of this — but the transaction is what covers two flows started in two
tabs.

**US5 AS3 (account hard-deleted mid-flow)**: `cascadeOnDelete` already removed the link, so step 2
finds nothing and step 4 finds nothing, and the visitor lands on step 6 as a new visitor. The
`identity.user === null` branch at step 3 is unreachable belt-and-braces and is written as such.

---

## D9 — The already-authenticated no-op (FR-031)

**Decision**: `redirect()` returns before minting any state:

```php
if ($request->user() !== null) {
    return redirect()->away(config('app.frontend_url') . '/');
}
```

**Rationale**: On a `web`-group route `$request->user()` resolves through the default `web` guard
from the session — which **is** the session Sanctum SPA auth uses, so a visitor signed in through
the SPA is seen as signed in here. No flow starts, no state is written, no link can be attached,
and which account is signed in cannot be swapped. The home feed is the destination `RequireAnon`
already sends a signed-in visitor to from `/login`, so the two guards agree.

---

## D10 — Every exit is a `302` to a real SPA page, carrying one of a closed set of error codes

**Decision**: The callback **never** returns JSON. The visitor is mid-navigation in their browser,
so both outcomes are redirects:

- success → `{FRONTEND_URL}{intended path}`
- failure → `{FRONTEND_URL}/login?error={code}`

Closed code set — the SPA maps each to a sentence, and an **unrecognised code falls back to the
generic retryable message**, so a future backend code can never render a blank alert:

| `error=` | Cause | Class |
|---|---|---|
| `cancelled` | Google returned `error=access_denied` | neutral |
| `state` | state missing, altered, mismatched, expired, **or already used** | neutral |
| `unverified_email` | no email claim, or `email_verified` false | terminal |
| `already_linked` | FR-012 refusal | terminal |
| `disabled` | FR-017 refusal | terminal |
| `rate_limited` | FR-008 refusal (D11) | retryable |
| `provider` | token exchange failed, timed out, or returned an unusable token | retryable |

**One code for five state failures is deliberate**: distinguishing "expired" from "mismatched"
from "replayed" tells an attacker which half of the guard they beat. US4 AS2 and AS3 both require
only that the return be rejected and nobody signed in.

**Why `/login` and not a dedicated callback page**: FR-030. The callback URL is consumed by a
`302`, so the browser's history entry for it is replaced — Back from `/login?error=…` lands
wherever the visitor was before, never re-entering the flow, and Refresh re-renders a plain login
page. It also means **this feature adds no SPA route**, so `App\Support\SpaRoutes` and
`frontend/src/App.tsx` (the hand-mirrored table from feature 016) are untouched. That is a design
goal, not a coincidence.

**Open-redirect guard (Principle VI)**: the intended path arrives as `?redirect=` on the start URL
because a full-page navigation destroys the React `location.state.from` that `LoginPage` uses
today. It is validated **server-side before being stored** in the flow state: it must match
`#^/(?![/\\])[^\s]*$#` and be ≤512 characters. Anything else silently becomes `/`. This rejects
`//evil.com`, `https://evil.com`, `/\evil.com` and backslash-prefixed variants. The stored value is
appended to `FRONTEND_URL`, never used as a whole URL.

---

## D11 — Rate limiting inside the controller, not as `throttle:` middleware

**Decision**: Check the limiter in the controller with the same per-IP cap the password login
uses (`config('app.auth_throttle')`, the `auth` limiter's value):

```php
$key = 'google-oauth:' . $request->ip();
if (RateLimiter::tooManyAttempts($key, (int) config('app.auth_throttle'))) {
    return $this->failure('rate_limited');
}
RateLimiter::hit($key);
```

**A separate bucket, the same cap — and why that is not a bypass.** The key is
`google-oauth:{ip}`, distinct from the `auth` limiter's `{ip}` bucket
(`AppServiceProvider::configureRateLimiting`), so one IP gets the cap at the password door *plus*
the cap at the Google door rather than one shared allowance. FR-008 asks that the Google entry
point "not be used to bypass that limit or to create accounts in bulk", and a separate bucket
satisfies both readings: the Google door cannot be used to guess a password at all (there is no
credential to submit), so it is not an alternative route into the password limiter's threat model;
and account creation is capped at the same per-IP rate as registration. Sharing one key would also
mean a flood of forged callbacks could lock legitimate visitors out of the *password* form, which
is the opposite of FR-007's "the email/password form remains available". Recorded here so the
doubled total is a decision, not an oversight.

**Rationale**: `throttle:auth` as route middleware throws `ThrottleRequestsException`, which on a
**web**-group route renders Laravel's HTML 429 page — a raw error, which is exactly what FR-007
forbids and SC-005 counts ("zero blank pages, raw errors"). Doing the check inline routes the
refusal through the same `302 → /login?error=` path as every other failure, and makes
"every exit from this controller is a redirect to a real page" a structural property rather than a
review note. Six lines. Applied to **both** routes — a flood of forged callbacks is the same abuse
surface as a flood of starts.

**Alternative rejected**: `throttle:auth` middleware plus a `withExceptions()` renderable that
converts `ThrottleRequestsException` to a redirect. That reaches into the global exception handler
to fix a two-route problem, and would have to distinguish these routes from every other throttled
route in the app.

---

## D12 — Frontend surface: one component, one pure lib class, no new route

**Decision**:

- `frontend/src/lib/googleAuth.ts` — `class GoogleAuth` of static methods:
  `startUrl(redirectTo)` (pure, unit-testable with no browser), `start(redirectTo)`
  (`window.location.assign`), and `errorMessage(code)` (the closed map from D10, unknown → generic).
- `frontend/src/components/GoogleSignInButton.tsx` — a real `<button type="button">`, not an
  anchor: it is an action, and a button is what gets Space as well as Enter for free. Accessible
  name "Continue with Google" (FR-027). It sets local `pending` and disables itself on click, so a
  double-click cannot fire the navigation twice (FR-027, US4 AS5). Reuses `BusyButton`'s
  established pending pattern.
- The Google "G" mark is an **inline SVG**, `aria-hidden="true"`. No third-party script, no remote
  image, no font — Principle I *and* Principle VI (nothing external is loaded into the page), and
  it keeps the button themable alongside the rest of the site.
- `LoginPage` / `RegisterPage` gain a separator block whose divider carries a **text** label
  ("or") — FR-026 requires the separation be conveyed by text, not by a rule or by position.
- Both pages read `?error=` via `useSearchParams()` and render it through an `auth-form__error`
  element carrying `role="alert"`. **`LoginPage` has one; `RegisterPage` does not** — that element
  appears only in `LoginPage.tsx` and `UploadPage.tsx` today, so the register page gains one,
  written to match. Checked against the source rather than assumed by symmetry.
- The button takes an optional `redirectTo` prop. `LoginPage` feeds it `location.state.from` — the
  same router state the password path already returns to — because a full-page navigation to Google
  destroys that state, so the intended path must travel as `?redirect=` (D10). Without the prop,
  FR-006 quietly degrades to always landing on `/` while every backend test still passes.
- `GoogleAuth.startUrl()` builds on `Api.base()`, the existing `VITE_API_BASE_URL` accessor — an
  absolute origin, because in dev the SPA is on `:5173` and the API on `:8000`.
- `AccountPage` gains a `Sign-in method` row (FR-029) reading `Google`, `Email and password`, or
  `Google and email/password`.

**No route is added to `App.tsx`** — see D10.

**Alternative rejected**: rendering the button only when the backend reports Google is configured.
That means a new flag on `GET /api/user` or a build-time `VITE_` variable duplicated across two
stacks — config drift waiting to happen, for a state (unconfigured credentials) that exists only
on a developer machine that has not set them up. An unconfigured backend answers `?error=provider`
and the visitor sees the retryable message. It is also what lets the Playwright specs assert the
button's presence, label, keyboard reachability and theming without a stub provider (D16).

---

## D13 — A display name is always produced (FR-016), and everything from Google is bounded (FR-024)

**Decision**, in `GoogleIdentity`:

1. Strip Unicode control characters (`\p{C}`) from the `name` claim, trim it. Non-empty →
   `mb_substr($name, 0, 255)` (the `users.name` column limit).
2. Otherwise the email's local part (before `@`), same cleaning and cap.
3. Otherwise the literal `Ladybug user`. Unreachable given FR-005 guarantees an email, but the
   method is total by construction rather than by argument.

Also validated before anything is stored (FR-024): `sub` non-empty and ≤255; `email` passes
`filter_var(FILTER_VALIDATE_EMAIL)` and is ≤255. A failure is a `provider` refusal, not an
exception reaching the visitor.

**No HTML escaping at storage.** The name is stored raw and escaped on output — React renders it
as a text child and the codebase never uses `dangerouslySetInnerHTML`. This is the identical
treatment comment bodies get in feature 015; escaping at write time would double-escape and
corrupt legitimate names containing `&` or `'`.

---

## D14 — Configuration and secrets (FR-023)

**Decision**: `config/services.php` gains a `google` block:

```php
'google' => [
    'client_id'     => env('GOOGLE_CLIENT_ID'),
    'client_secret' => env('GOOGLE_CLIENT_SECRET'),
    'redirect_uri'  => env('GOOGLE_REDIRECT_URI'),
    'authorize_url' => env('GOOGLE_AUTHORIZE_URL', 'https://accounts.google.com/o/oauth2/v2/auth'),
    'token_url'     => env('GOOGLE_TOKEN_URL', 'https://oauth2.googleapis.com/token'),
],
```

Placeholders (empty values) go in `backend/.env.example`, `deploy/backend.env.example` and
`backend/.env.e2e`. **No real credential is ever committed** — the repository is public.

Authorize-URL parameters: `response_type=code`, `client_id`, `redirect_uri`, `state`,
`scope=openid email profile` (the minimum FR-002 names), `code_challenge` +
`code_challenge_method=S256`, `prompt=select_account`, and **`access_type=online`**.

`access_type=online` is the strongest possible form of FR-021: Google never issues a refresh token
at all, so there is nothing to discard. The `access_token` that does come back is **read by
nothing** — only `id_token` is used — so no provider credential is ever written anywhere.

The two URL overrides exist so a disposable stack can point at a local stub; production sets
neither. Registered redirect URIs: `http://localhost:8000/api/auth/google/callback` (dev — Google
permits `http://localhost` on any port) and
`https://online-trash.com/api/auth/google/callback` (production).

---

## D15 — The session cookie survives the Google round trip with no config change

**Decision**: no change to `config/session.php`, `config/sanctum.php` or `config/cors.php`.

**Verified reasoning**:

- `session.same_site` is `lax`. Both hops — SPA → our start route, and Google → our callback —
  are **top-level `GET` navigations**, which `Lax` permits. (A `POST` callback would need
  `SameSite=None; Secure`; ours is a `GET`, so it does not.)
- Production: `SESSION_DOMAIN=online-trash.com`, and the callback is on that host. Same cookie.
- Dev: `SESSION_DOMAIN=null` → a host-only cookie for `localhost`. Cookies ignore port, so the
  session set by `localhost:8000` is presented back to `localhost:8000` even though the SPA lives
  on `localhost:5173`.
- CORS does not apply: both hops are navigations, not XHR.

**Do not set `SESSION_SAME_SITE=none`.** It would require `Secure` (breaking plain-HTTP dev) and
would weaken the CSRF posture of every other route in the app to solve a problem this flow does
not have.

---

## D16 — Test strategy, and one honest gap

**Backend (PHPUnit, sqlite `:memory:`)**: `Http::fake()` intercepts the token endpoint. Tests
synthesize an `id_token` as three base64url segments with an arbitrary signature segment — which
doubles as the assertion that D5's design is what is implemented: the payload is read, the
signature is ignored, and rejection comes from the `aud`/`iss`/`exp` checks. Dedicated cases for a
wrong `aud`, a wrong `iss` and a past `exp`.

Session-carrying flow in a feature test: `$this->get('/api/auth/google/redirect')` then read the
state out of the test session and feed it to `$this->get('/api/auth/google/callback?...')` —
Laravel's test client persists the session across calls within one test.

**Frontend (Vitest + Testing Library)**: `GoogleAuth` is pure and tested directly (URL building,
the full error-code map, the unknown-code fallback). `GoogleSignInButton` is tested for accessible
name, keyboard activation, and that a second click while pending does not navigate again.
`LoginPage`/`RegisterPage` for button presence and `?error=` rendering into the alert region, plus
`LoginPage` for `location.state.from` reaching the start URL as `?redirect=`.
`AccountPage` for all **four** sign-in-method outcomes — the three reachable strings and the
`googleLinkedAt === null && !hasPassword` total fallback (data-model.md §6).

**E2E (Playwright)**: presence, accessible name, keyboard reachability, light/dark, and 320px →
desktop reflow, on both pages. **The round trip is not e2e-tested** — there is no Google in CI and
building a fake IdP would be a larger artifact than the feature. This is a real gap and is named
as one, covered by the manual verification steps in `quickstart.md` **§4** against a real Google
client (§5 is the disposable e2e stack). D12's "always render the button" decision is what makes the presence/a11y specs possible
without any stub.

Coverage stays ≥90% on both stacks (Principle VII, SC-011).

---

## D17 — Class inventory, sized against the conventions

`docs/CODING_CONVENTIONS.md` caps PHP functions at 30 lines. The split below exists to meet that
cap, not for its own sake:

| Class | Responsibility | Why separate |
|---|---|---|
| `Http/Controllers/GoogleAuthController` | two actions; every exit a redirect | no domain logic |
| `Services/GoogleOAuthService` | authorize URL, code exchange, claims → `GoogleIdentity` | talks to Google; **touches no database** |
| `Services/IdentityLinkService` | D8's resolution, in one transaction | touches the database; **never talks to Google** |
| `Support/GoogleIdentity` | readonly value object + `displayName()` (D13) | pure, trivially testable |
| `Support/OAuthFlowState` | mint / validate / consume the session state + PKCE | pure given a session store |
| `Utils/Jwt` | base64url payload decode + `iss`/`aud`/`exp` checks | pure; sits beside `Base64`, `Json`, `Str` |
| `Models/UserIdentity` | the link row | — |
| `Exceptions/OAuthFailure` | typed failure carrying one D10 code | keeps the controller's error path a `catch`, not a chain of `if`s |

The `GoogleOAuthService` / `IdentityLinkService` split is the one that matters: it is what lets
every account-resolution rule in D8 be unit-tested with no HTTP at all, and every HTTP behaviour
be tested with no database.
