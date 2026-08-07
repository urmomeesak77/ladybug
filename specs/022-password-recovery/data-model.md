# Phase 1 Data Model: Password Recovery and Change

**Feature**: 022-password-recovery | **Date**: 2026-08-07

**This feature adds no migration and no column.** Every table and field it uses already exists.
What follows records which of them it reads, which it writes, and the invariants that hold across
both routes.

---

## 1. `password_reset_tokens` — the Recovery request

The spec's **Recovery request** entity. Created by
`backend/database/migrations/0001_01_01_000000_create_users_table.php` and untouched since; owned
entirely by Laravel's `DatabaseTokenRepository`, which this feature drives through the `Password`
facade rather than querying directly.

| Column | Type | Role |
|---|---|---|
| `email` | `string` **PRIMARY KEY** | The address the permission was issued for. Being the primary key is what enforces "at most one outstanding per address" (spec, Key Entities) — structurally, not by convention. |
| `token` | `string` | **bcrypt hash** of the secret. The usable form exists only in the emailed link; a database read yields nothing that can be presented back (FR-018). |
| `created_at` | `timestamp` nullable | The moment of issue. Expiry (FR-007) and the resend interval (FR-009) are both derived from it; it is **not** a record of anything, and it is deleted on use (FR-034). |

**Lifecycle**

| Transition | Trigger | Mechanism |
|---|---|---|
| **created** | `POST /api/password/forgot` for a real, enabled account outside the resend interval | `DatabaseTokenRepository::create()` — deletes any existing row for the address first, so issuing supersedes (FR-008) |
| **suppressed** | a second request inside 60 s | `recentlyCreatedToken()` → the existing row stands, no mail, generic response (FR-009) |
| **consumed** | a successful `POST /api/password/reset` | `PasswordBroker::reset()` → `deleteToken()` after the callback commits (FR-014) |
| **voided** | a successful `PUT /api/user/password` | `PasswordService` calls `Password::broker()->deleteToken($user)` (FR-008, second half) |
| **expired** | 60 minutes elapse | Row remains but `tokenExpired()` refuses it (FR-007); not swept — see research D10 |
| **orphaned** | the account is deleted (013) or its address changes | The row is not FK-linked, so it survives — but the link's digest no longer resolves to an account, so it is refused identically (FR-015) |

**Not written by this feature**: nothing else. There is no status column, no use counter, no
"consumed at" — consumption is deletion.

---

## 2. `users` — the Account

| Column | Access | Notes |
|---|---|---|
| `email` | read | Matched on the request route (plaintext, as typed); passed to the broker, which keys the token row by it. |
| `email_sha1` | read | Indexed digest added by 008. The **only** account handle the emailed link carries; resolved via `UserService::findByEmailDigest` on the check and reset routes. Kept in step with `email` by `User::setEmailAttribute`. |
| `password` | **write** | The single credential this feature replaces. Nullable since 017 (`2026_07_29_000001`); a `null` value means "Google-only", which drives FR-031's two shapes of the account-page section and is already surfaced as `has_password` on `UserResource`. Hashed by the model's `hashed` cast — never assigned pre-hashed. |
| `remember_token` | **write** | Rotated on every successful change, defence in depth for FR-016 (research D6). |
| `disabled_at` | read | A non-null value excludes the account from recovery entirely — no mail (FR-006), no reset (FR-015) — invisibly to the requester (FR-004). |
| `id` | read | Used only as the `sessions.user_id` key for revocation and as the rate-limit key. Never leaves the server (Principle V). |
| `name`, `role`, `rating`, `email_verified_at`, `hash`, `disabled_by`, timestamps | **never written** | FR-017 and FR-020 in one line. Asserted field-by-field by test, per SC-007. |

**Relationships left alone**: `posts`, `comments`, `googleIdentity`. A Google-linked account
gaining a password adds a credential and removes none (FR-019); `user_identities` is not touched
by any code path in this feature.

---

## 3. `sessions` — the live-access record

Created by the same initial migration; the app runs `SESSION_DRIVER=database`.

| Column | Access | Notes |
|---|---|---|
| `id` | read | The acting session, preserved on the account-page route so the changing client stays signed in (FR-028). |
| `user_id` | read (indexed) | The delete predicate. Written by Laravel's `DatabaseSessionHandler`, not by this feature. |
| everything else | — | Untouched. |

`SessionRevoker::revoke($user, $keepSessionId)` is the only writer: `DELETE FROM sessions WHERE
user_id = ? [AND id != ?]`. Rows are deleted, never flagged — a deleted row is indistinguishable
from a session that never existed, so the next request from that client starts anonymous (FR-016).

---

## 4. State transitions, both routes

```
                    ┌──────────────────────────────────────────┐
                    │  password change succeeds (either route) │
                    └──────────────────────────────────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              ▼                        ▼                        ▼
   users.password := new     password_reset_tokens      sessions rows for
   users.remember_token      row for this address       this user deleted
        := rotated                 deleted              (keeping the acting
                                                         one, if any)
              │                        │                        │
              └──────────┬─────────────┴────────────────────────┘
                         ▼
        one database transaction — either all four land or none do
```

**Atomicity**: the three writes commit together. A partial application would leave the worst
possible state — a changed password with an outstanding link, or with live sessions that the
holder believes are dead — so the service wraps them in a single transaction, following the
pattern `ModerationService` established for 011's rating deltas.

**Ordering within the recovery route**: the broker validates the token *before* invoking the
callback, and deletes it *after* the callback returns. The password write and the revocations
therefore happen inside the broker's callback, and the token deletion closes the transaction —
which is why re-opening a spent link is refused (US2 scenario 6) rather than silently re-running.

---

## 5. Invariants

- **INV-1** — At most one `password_reset_tokens` row exists per address, at all times. Enforced
  by the primary key, not by application code.
- **INV-2** — No usable token exists in the database. The stored value is a bcrypt hash; the
  plaintext lives only in the email and, briefly, in the requester's URL fragment (FR-018).
- **INV-3** — A password change and the death of every credential that depended on it are
  simultaneous. There is no window in which the old password is dead but an old session is alive,
  or vice versa (FR-008, FR-016).
- **INV-4** — A disabled account can neither receive a link nor complete a reset, and no
  observable response distinguishes it from an address with no account at all (FR-004, FR-006).
- **INV-5** — No account field other than `password` and `remember_token` differs across a
  successful change by either route (FR-017, FR-020, SC-007).
- **INV-6** — The recovery route never establishes a session. `Auth::login` appears nowhere in
  `PasswordService` or `PasswordResetController` (FR-021).
- **INV-7** — No account detail — address, display name, role, verification state — appears in any
  response body or any URL in the recovery journey, on success or refusal (FR-011, FR-015).
