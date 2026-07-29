# Contract — Google sign-in endpoints

**Feature**: `017-google-oauth-login` | **Research**: [../research.md](../research.md) D2, D3, D4, D10, D11

Two browser-facing endpoints. **Neither ever returns JSON** — both are reached by a top-level
navigation, so every exit is a `302` to a real SPA page (FR-007, SC-005).

Registered in `backend/routes/web.php`, above the SPA shell catch-all, inside
`Route::prefix('api')`. They run under the **`web` middleware group**, not the `api` group —
research D2 explains why that is not a stylistic choice.

---

## `GET /api/auth/google/redirect`

Starts the flow. Name: `api.auth.google.redirect`.

### Query parameters

| Name | Required | Rules |
|---|---|---|
| `redirect` | no | The SPA path to return to on success. Must match `#^/(?![/\\])[^\s]*$#` and be ≤512 chars. **Anything else silently becomes `/`** — never an error, never echoed back. |

The regex rejects `//evil.com`, `https://evil.com`, `/\evil.com`, and whitespace-smuggling
variants. The stored value is appended to `FRONTEND_URL`; it is never treated as a whole URL.

### Behaviour

| Order | Condition | Result |
|---|---|---|
| 1 | already authenticated | `302 → {FRONTEND_URL}/` — **no flow started, nothing written** (FR-031, research D9) |
| 2 | over the per-IP rate limit | `302 → {FRONTEND_URL}/login?error=rate_limited` (FR-008, research D11) |
| 3 | `client_id` or `client_secret` unconfigured | `302 → {FRONTEND_URL}/login?error=provider` |
| 4 | otherwise | mint flow state, `302 → {authorize_url}?…` |

Order is load-bearing: the authenticated check runs **before** the limiter, so a signed-in
visitor's stray click cannot consume another visitor's IP budget.

### The authorize URL

| Parameter | Value |
|---|---|
| `response_type` | `code` |
| `client_id` | `services.google.client_id` |
| `redirect_uri` | `services.google.redirect_uri` — must byte-match a URI registered in the Google console |
| `scope` | `openid email profile` — the minimum FR-002 permits |
| `state` | the 64-hex-char flow token |
| `code_challenge` | base64url(SHA-256(`code_verifier`)), unpadded |
| `code_challenge_method` | `S256` |
| `access_type` | `online` — **Google issues no refresh token at all**, so FR-021 has nothing to discard |
| `prompt` | `select_account` |

### Session written

`oauth.google` = `{state, code_verifier, expires_at, redirect}` — see
[../data-model.md](../data-model.md) §4. Replaces any earlier flow in this browser.

---

## `GET /api/auth/google/callback`

Google's return trip. Name: `api.auth.google.callback`.

### Query parameters (all from the browser — **untrusted**)

| Name | Use |
|---|---|
| `code` | redeemed server-side at the token endpoint; never inspected client-side |
| `state` | compared with `hash_equals` against the consumed session value |
| `error` | Google's own error, e.g. `access_denied` |

**No other parameter is read.** In particular no identity attribute arriving on this URL is ever
trusted (FR-004) — identity comes only from the token-endpoint response (research D5).

### Outcomes

Every row below is a `302`. The session state is consumed with `pull()` at step 2, so it is gone
whichever way the request ends.

| # | Condition | Location | Written |
|---|---|---|---|
| 1 | over the per-IP rate limit | `/login?error=rate_limited` | nothing |
| 2 | `error=access_denied` present | `/login?error=cancelled` | nothing |
| 3 | any other `error` present | `/login?error=provider` | nothing |
| 4 | state missing, mismatched, expired, or already consumed | `/login?error=state` | nothing |
| 5 | `code` missing | `/login?error=state` | nothing |
| 6 | token exchange failed, timed out, or returned no `id_token` | `/login?error=provider` | nothing |
| 7 | `id_token` fails `iss` / `aud` / `exp`, or a claim fails validation | `/login?error=provider` | nothing |
| 8 | no `email` claim, or `email_verified` not true | `/login?error=unverified_email` | nothing |
| 9 | resolved account is disabled | `/login?error=disabled` | **nothing** |
| 10 | matched account already linked to a different Google account | `/login?error=already_linked` | nothing |
| 11 | success | `{FRONTEND_URL}{redirect}` | see below |

Rows 9 and 10 are the security core: the refusal precedes the first write, so a refused sign-in
leaves the account byte-for-byte unchanged (FR-017, FR-012, SC-006, INV-9).

Row 4 collapses five distinct failures into one code deliberately — distinguishing them tells an
attacker which half of the guard they beat (research D10).

### On success (row 11)

In this order:

1. `Auth::login($user)` — the `web` guard, the same session Sanctum SPA auth reads (FR-006).
2. `$request->session()->regenerate()` — session-fixation rotation, matching
   `AuthController::register`/`login`.
3. `302 → {FRONTEND_URL}{redirect}`.

The established session is **indistinguishable** from a password-login session: same guard, same
cookie, same lifetime, same `EnsureAccountEnabled` enforcement on subsequent API calls, same
`POST /api/logout` (FR-006, FR-018, FR-019).

### Token exchange (server-to-server)

```
POST {services.google.token_url}
Content-Type: application/x-www-form-urlencoded

code, client_id, client_secret, redirect_uri,
grant_type=authorization_code, code_verifier
```

Timeout **10 s**, no retry — a hung provider must not hold a php-fpm worker, and a retry would
fail anyway because Google's authorization codes are single-use.

Of the response, **only `id_token` is read**. `access_token`, `expires_in`, `token_type` and
`scope` are ignored and never stored (FR-021 — nothing to retain, so nothing can leak).

### ID-token checks (FR-004)

Payload decoded from base64url without signature verification — sound because the token arrived
directly from the token endpoint over TLS authenticated with our client secret (research D5).
Then, all mandatory:

| Claim | Rule |
|---|---|
| `iss` | ∈ `{"accounts.google.com", "https://accounts.google.com"}` |
| `aud` | `=== services.google.client_id` |
| `exp` | `> time()`, no leeway |
| `sub` | non-empty, ≤255 |
| `email` | `FILTER_VALIDATE_EMAIL`, ≤255 |
| `email_verified` | `true` (or `"true"` / `1`); anything else → row 8 |

---

## Account resolution

Normative order in [../research.md](../research.md) D8. Restated as outcomes:

| Prior state | Result | Requirement |
|---|---|---|
| link exists for this `sub` | sign in as that account; nothing written | FR-009, US2 |
| link exists, account disabled | row 9 | FR-017 |
| no link, no account on this address | create one account + link; verified, member, rating 0, fresh 10-char hash, `password = NULL` | FR-010, FR-013, FR-014 |
| no link, an account holds this address | attach link to it, sign in; verify it if unverified; **password/role/rating/posts/comments untouched** | FR-011, FR-014, FR-015, US3 |
| no link, matching account is disabled | row 9, nothing written | FR-017, US5 AS4 |
| no link, matching account already linked to another `sub` | row 10 | FR-012, US3 AS6 |
| account hard-deleted mid-flow | falls through to "create" — the link cascaded with it | FR-032, US5 AS3 |

Steps run in one `DB::transaction` with `lockForUpdate()` on both lookups; the two unique indexes
are the backstop, and a `UniqueConstraintViolationException` triggers exactly one re-resolution,
which then takes the returning-visitor path. At most one account, at most one session (US4 AS5).

---

## Rate limiting (FR-008)

Both endpoints, checked **in the controller** so the refusal is a redirect rather than Laravel's
HTML 429 page (research D11):

```
key   = 'google-oauth:' + request IP
limit = config('app.auth_throttle')   // the same cap POST /api/login uses
```

`RateLimiter::hit()` after the check, so a refused request does not deepen its own hole.

---

## What this contract does **not** add

- **No SPA route.** The callback lands on `/login`, which already exists in both
  `frontend/src/App.tsx` and `App\Support\SpaRoutes` — the hand-mirrored table from feature 016 is
  untouched. Deliberate (research D10).
- **No JSON API surface.** `GET /api/user`, `POST /api/login`, `POST /api/logout` and every admin
  endpoint are unchanged in shape and behaviour, except that `UserResource` gains `has_password`
  and `google_linked_at` (see [../data-model.md](../data-model.md) §6).
- **No change to `EnsureAccountEnabled`, `EnsureRole`, `verified`, or any existing middleware.**
  A Google session meets them all identically (FR-018).
