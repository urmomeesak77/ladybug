# Contract: Account Password Change API (authenticated)

**Feature**: 022-password-recovery | Method: `App\Http\Controllers\AuthController::updatePassword`

One endpoint, for the account holder who still has a session. It lives on `AuthController` beside
`updateProfile` because it edits the requester's **own** account and takes no target parameter —
the session names the row, exactly as the display-name endpoint does.

---

## `PUT /api/user/password`

**Route name**: `api.auth.password.update` · **Middleware**: `auth:sanctum`, `throttle:password`

**Why `PUT` when its neighbour `updateProfile` is `PATCH /api/user`**: `PATCH` is right there
because that endpoint sends a partial account — one field of several, the others left alone.
This endpoint addresses **one credential at its own address** and replaces it whole; there is no
partial password. `PUT` is the honest verb for a total replacement of the resource named by the
URL, so the two verbs differ because the two requests differ, not by oversight. Named here so a
later reader does not "fix" the inconsistency into a lie.

The `throttle:password` limiter keys by the authenticated account id here (research D7), so the
cap is **per account** — a borrowed session cannot be used to brute-force the password it did not
come with (FR-030).

### Request

For an account that **has** a password:

```json
{
  "current_password": "OldPassw0rd",
  "password": "NewPassw0rd",
  "password_confirmation": "NewPassw0rd"
}
```

For a **Google-only** account (`users.password IS NULL`, i.e. `has_password: false` on
`UserResource`):

```json
{ "password": "NewPassw0rd", "password_confirmation": "NewPassw0rd" }
```

### Validation — `UpdatePasswordRequest`

| Field | Rules |
|---|---|
| `password` | `App\Support\PasswordPolicy::rules()` — the same rule set registration and recovery use (FR-029, research D9) |
| `current_password` | `['required', 'current_password']` **only when** `$this->user()->password !== null`; **absent from the rule set entirely** otherwise |

The conditional is written as a plain `if` building the array, not a rule callback (conventions:
prefer closure-free alternatives). When the account has no password the field is not merely
optional — it carries no rule at all, so a value sent for it is ignored rather than checked
(FR-031: "absent rather than present-and-optional, so there is nothing to leave blank or guess
at"; the live session is the proof).

Laravel's `current_password` rule compares via the guard's `Hash::check`, which fails closed on a
`null` stored hash — the behavioural guard 017 already relies on.

### Responses

| Status | Body | When |
|---|---|---|
| `200` | `UserResource` envelope — `{"data": {…, "has_password": true, "google_linked_at": …}}` | Success (FR-028) |
| `422` | `{"message": …, "errors": {"current_password": ["…"]}}` | Wrong current password — nothing changes, and no password field is echoed back (US3 scenario 3) |
| `422` | `{"message": …, "errors": {"password": ["…"]}}` | Policy failure or confirmation mismatch (FR-029) |
| `401` | `{"message": "Unauthenticated."}` | No session, or the session died between page load and submit (spec, Edge Cases) |
| `403` | `{"message": "This account is disabled."}` | The account was disabled between page load and submit — emitted by the existing `EnsureAccountEnabled` middleware, not by this method (feature 012) |
| `429` | `{"message": "Too Many Attempts."}` | Over the per-account cap (FR-030) |

**Why `UserResource` and not a message**: for a Google-only account the change flips
`has_password` from `false` to `true`, which is what the account page reads to decide between
FR-031's two shapes of the section and what `AuthModel.signInMethod` reads to say "Google and
email/password". Returning the refreshed profile lets the SPA update both without a second round
trip.

### Side effects on success — one transaction

Identical to the recovery route's, with one deliberate difference:

1. `users.password` := the new value (hashed by the model cast).
2. `users.remember_token` := rotated.
3. Every `sessions` row for the account is deleted **except the acting one**
   (`session()->getId()`), so the client that made the change stays signed in (FR-028) while
   every other device and every remembered sign-in stops working (FR-016, US5).
4. Any outstanding `password_reset_tokens` row for the account is deleted — **FR-008's second
   half**: an account holder who suspects their inbox is compromised shuts an attacker's
   outstanding link by changing their password here.

All four commit together or none do (INV-3). Both routes reach them through the same
`PasswordService` method, so neither can grow a gap the other lacks.

### Explicitly not done

- **The acting client is not signed out.** No `Auth::logout`, no session invalidation, no CSRF
  rotation on this path (FR-028).
- **The Google link is untouched.** `user_identities` is not read or written; an account that
  gains its first password afterwards signs in either way (FR-019, FR-031).
- **No other account field changes**, including `email_verified_at` (FR-017, FR-020, SC-007).
- **Nothing is recorded** — no audit row, no "password last changed" timestamp (FR-034).
- **No new address.** The section lives on the existing `/account` page; `SpaRoutes` gains nothing
  for it (FR-025).
