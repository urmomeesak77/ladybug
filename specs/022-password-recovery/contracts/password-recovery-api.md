# Contract: Password Recovery API (anonymous)

**Feature**: 022-password-recovery | Controller: `App\Http\Controllers\PasswordResetController`

Three session-free endpoints. All three are registered in `backend/routes/api.php` under
`throttle:password` (research D7 — cap `config('app.auth_throttle')`, default 5/min, keyed by IP
for anonymous callers). None of them reads `$request->user()`: the account in play is always the
one the submitted address or digest names, never the signed-in one.

---

## 1. `POST /api/password/forgot` — ask for a link

**Route name**: `api.password.forgot` · **Middleware**: `throttle:password`

### Request

```json
{ "email": "someone@example.com" }
```

Validated by `ForgotPasswordRequest`: `email` → `['required', 'email', 'max:255']`. Deliberately
**no** `exists:users,email` rule — that would make validation itself the oracle FR-004 forbids.

### Responses

| Status | Body | When |
|---|---|---|
| `200` | `{"message": "If an account exists for that address, a password recovery link is on its way."}` | **Every** well-formed address (FR-004) |
| `422` | `{"message": …, "errors": {"email": ["…"]}}` | Missing or malformed address (FR-003) — nothing is sent |
| `429` | `{"message": "Too Many Attempts."}` | Requester over the cap (FR-010) |

### The 200 is unconditional

The identical body, status, and headers are returned when the address belongs to a real enabled
account, to **no account at all**, to a **disabled** account (FR-006), when the broker suppresses
the send inside its 60-second interval (FR-009), and when the mail transport **fails** (FR-032).
`PasswordService::sendRecoveryLink()` returns `void`, so the controller has no value to branch on
(research D4).

Two exclusions, both deliberate and both stated in FR-004:

- **Rate-limit headers vary and are excluded.** `throttle:password` emits `X-RateLimit-Limit` and
  `X-RateLimit-Remaining`, and `Retry-After` on a 429. They count the **caller's own** traffic and
  are keyed by IP, never by the submitted address, so they say nothing about any account. Any
  paired comparison must exclude them, or it is asserting the throttle's counter rather than the
  feature's non-enumeration.
- **Timing is excluded.** The eligible path hashes a token and sends mail synchronously; the
  ineligible paths return after one indexed `SELECT`. No delay or dummy work masks the difference
  (research D12).

### Side effects — only in the one eligible case

The address resolves to an account that is **not disabled**, and no token for it was created
within `config('auth.passwords.users.throttle')` seconds:

1. `Password::sendResetLink(['email' => $email])` mints a token, deletes any previous row for the
   address (FR-008), and stores the bcrypt hash.
2. One `ResetPassword` notification is mailed, carrying exactly one link and no password (FR-005).
   See `recovery-link.md`.
3. A transport failure is caught and passed to `report()`; the response does not change (FR-032).

Google-only accounts (`password IS NULL`) are eligible on the same terms as any other (FR-019) —
the broker resolves the account by address and never inspects the stored credential, so a null
password neither blocks the send nor changes the message. Completing the journey then *adds* the
password credential (§3). Both halves are asserted by test, not assumed: the send in
`PasswordServiceTest`, the completion in `PasswordResetControllerTest`. Unverified accounts are
eligible (spec, Edge Cases) and their verification state is not altered (FR-020).

---

## 2. `POST /api/password/reset/check` — is this link still alive?

**Route name**: `api.password.reset.check` · **Middleware**: `throttle:password`

A **read**. Called once by `ResetPasswordPage` on mount so a dead link is refused when it is
opened (US4 scenario 1) rather than after the user has typed a password. It is a POST with a body,
not a GET with a query, so the token never enters a URL and therefore never enters an access log
(research D2/D8).

### Request

```json
{ "hash": "<sha1 of the account's email>", "token": "<64-char token from the link fragment>" }
```

Validated by `CheckResetTokenRequest`: both `['required', 'string']`.

### Responses

| Status | Body | When |
|---|---|---|
| `204` | *(empty)* | Digest resolves to an enabled account and the token matches an unexpired row |
| `403` | `{"message": "This password recovery link is no longer valid."}` | Everything else |
| `422` | validation envelope | `hash` or `token` missing |
| `429` | `{"message": "Too Many Attempts."}` | Over the cap (FR-033) |

The `403` is one message for expired, already-consumed, altered-token, altered-digest,
unknown-account, deleted-account and disabled-account alike — it names no account detail and gives
no hint which part was wrong (FR-015, INV-7).

### Guarantee

**This endpoint has no side effects.** It does not create, refresh, consume, or expire the token
(FR-012). `DatabaseTokenRepository::exists()` is a `Hash::check` against a `SELECT`; nothing is
written. An inbox scanner or email preview that opens the link leaves it fully usable.

---

## 3. `POST /api/password/reset` — set the new password

**Route name**: `api.password.reset` · **Middleware**: `throttle:password`

### Request

```json
{
  "hash": "<sha1 of the account's email>",
  "token": "<token from the link fragment>",
  "password": "NewPassw0rd",
  "password_confirmation": "NewPassw0rd"
}
```

Validated by `ResetPasswordRequest`:

| Field | Rules |
|---|---|
| `hash` | `['required', 'string']` |
| `token` | `['required', 'string']` |
| `password` | `App\Support\PasswordPolicy::rules()` → `['required', 'string', 'confirmed', Password::min(8)->mixedCase()->numbers()]` |

The policy is byte-identical to registration's, by construction (research D9, FR-013).

### Responses

| Status | Body | When |
|---|---|---|
| `200` | `{"message": "Your password has been changed. Please log in."}` | Success (FR-014) |
| `422` | `{"message": …, "errors": {"password": ["…"]}}` | Policy failure or confirmation mismatch — **the link is untouched and remains usable** (US2 scenarios 3 & 4) |
| `403` | `{"message": "This password recovery link is no longer valid."}` | Dead, spent, tampered, unknown, or disabled — identical to the check endpoint's refusal (FR-015) |
| `429` | `{"message": "Too Many Attempts."}` | Over the cap (FR-033) |

The 422/403 split is load-bearing: a rejected *password* must leave the link alive, a rejected
*link* must change nothing. Form-request validation runs before the broker, so the ordering is
structural.

### Side effects on success — one transaction

1. `users.password` := the new value (hashed by the model cast).
2. `users.remember_token` := rotated.
3. Every `sessions` row for the account is deleted — **all** of them; there is no acting session
   to keep (FR-016, FR-021).
4. The `password_reset_tokens` row is deleted (FR-014).

All four commit together or none do (INV-3).

### Explicitly not done

- **No session is established.** `Auth::login` appears nowhere on this path. The response tells
  the caller to sign in, and the SPA sends them to `/login` (FR-021, INV-6).
- **No other account field changes** — not `email_verified_at` (FR-020), not `role`, `rating`,
  `name`, `disabled_at`, posts, comments, or the Google link (FR-017, FR-019).
- **Nothing is recorded** — no audit row, no timestamp (FR-034).
- **No account detail is returned.** The response is a message and nothing else (FR-011, INV-7).
