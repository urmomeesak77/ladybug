# Phase 1 Data Model — Sign In / Sign Up with a Google Account

**Feature**: `017-google-oauth-login` | **Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

One new table, one column change, one transient session structure, and two value objects that
never touch the database. Nothing else in the schema moves.

---

## 1. `user_identities` (NEW)

The association between one Ladybug account and one external identity. Created by the first
Google sign-in; destroyed with the account (FR-032).

**Migration**: `backend/database/migrations/2026_07_29_000000_create_user_identities_table.php`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `bigIncrements` | no | internal only; never serialized |
| `user_id` | `foreignId` → `users.id` | no | **`cascadeOnDelete`** — FR-032 |
| `provider` | `string(32)` | no | `'google'` today; the column is what keeps a second provider possible later |
| `provider_user_id` | `string(255)` | no | Google's `sub`. **Never serialized, never in a URL** (FR-022) |
| `created_at` | `timestamp` | yes | "when the link was made" (FR-021) |
| `updated_at` | `timestamp` | yes | Laravel convention; carries no meaning here |

**Indexes**

| Index | Purpose |
|---|---|
| `UNIQUE (provider, provider_user_id)` | one Google account links to at most one Ladybug account — FR-012, direction A |
| `UNIQUE (user_id, provider)` | one Ladybug account links to at most one Google account — FR-012, direction B |

No separate index on `user_id`: the `(user_id, provider)` unique index is left-prefixed by
`user_id`, so lookups and the FK both use it.

### Why `cascadeOnDelete` and not `nullOnDelete`

Every other user-owned row in this codebase orphans on a hard delete — `trashposts.user_id` and
`comments.user_id` are both `nullOnDelete` (feature 013), because a meme without an uploader is
still a meme. A link without an owner is different in kind: it matches nobody, it can never be
cleared by anyone, and `UNIQUE (provider, provider_user_id)` would make it **permanently refuse
its own person a new account** (FR-012 firing against a tombstone). FR-032 exists precisely to
prevent that, and the FK is how it is enforced — there is no cascade code to get wrong.

### Model — `App\Models\UserIdentity`

```
$fillable = [];            // like users.hash / users.role: assigned explicitly, never mass-assigned
$hidden   = ['provider_user_id'];   // belt-and-braces; no resource serializes this model at all
user(): BelongsTo          // → User
```

`$fillable` is empty on purpose. `provider_user_id` is the sole key to an account; anything that
could reach it through `fill()` from a request body would be an account-takeover primitive of
exactly the kind `role` and `rating` are kept out of `$fillable` to avoid.

### Relationship on `User`

```
googleIdentity(): HasOne   // UserIdentity, constrained to provider = 'google'
```

---

## 2. `users.password` → nullable (CHANGED)

**Migration**: `backend/database/migrations/2026_07_29_000001_make_users_password_nullable.php`

```
up():   $table->string('password')->nullable()->change();
down(): $table->string('password')->nullable(false)->change();
```

Laravel 11+ changes columns natively — no `doctrine/dbal`, no dependency decision (Principle I).

| Account origin | `password` |
|---|---|
| registered with email + password (007) | bcrypt hash — unchanged |
| created via Google (US1) | `NULL` |
| password account later auto-linked to Google (US3) | bcrypt hash — **untouched** (FR-015) |

**The invariant this gives up, and what replaces it**: `NOT NULL` previously made "every account
has a password" structurally true. FR-020 now depends on behaviour instead. `Hash::check()`
returns `false` for a `null` or `''` stored hash, so `Auth::attempt()` fails closed — but the
design does not lean on that alone. See research D6 for the three explicit guards, and
`contracts/password-login-invariant.md` for the assertions.

**`down()` on a live database is a runbook step, not a rollback.** Restoring `NOT NULL` while
passwordless rows exist errors under MySQL strict mode and silently coerces `NULL` → `''` without
it. `quickstart.md` §6 carries the procedure.

---

## 3. `users` — no other change

`name`, `email`, `email_sha1`, `hash`, `email_verified_at`, `role`, `rating`, `disabled_at`,
`disabled_by` are all **unchanged**, and a Google-created account gets the ordinary defaults
(FR-013):

| Attribute | Value on a Google-created account | Source |
|---|---|---|
| `name` | `GoogleIdentity::displayName()` (research D13) | derived, always non-empty |
| `email` | the Google-confirmed address | claim, validated |
| `email_sha1` | maintained by the existing `setEmailAttribute` mutator | no new code |
| `hash` | `Str::createUniqueHash(10)` | the same minting `UserService::persist()` uses |
| `password` | `NULL` | §2 |
| `email_verified_at` | `now()` via `markEmailAsVerified()` | FR-014 |
| `role` | `member` — from `$attributes`, not assignable | existing privilege-escalation guard |
| `rating` | `0` — the column default, not assignable | feature 011 |
| `disabled_at` / `disabled_by` | `NULL` | — |

`markEmailAsVerified()` is used rather than a raw assignment so any future listener still fires,
and it is called **only when `email_verified_at` is null** — idempotent, and it stops a returning
visitor's timestamp being rewritten on every sign-in.

---

## 4. Flow state (TRANSIENT — session, no table)

Session key `oauth.google`, written by `redirect()` and consumed with `pull()` by `callback()`.
Research D3 explains why this is not a table.

| Field | Type | Value |
|---|---|---|
| `state` | `string` | `bin2hex(random_bytes(32))` — 64 hex chars |
| `code_verifier` | `string` | PKCE verifier, 64 random hex chars (research D4) |
| `expires_at` | `int` | `time() + 600` — 10 minutes |
| `redirect` | `string` | validated intended path, default `/` (research D10) |

**Lifecycle**

```
mint     → written whole on redirect(); replaces any earlier flow in this browser
consume  → session()->pull() — read AND removed in one operation
validate → present?  AND  hash_equals(state, returned)  AND  expires_at > time()
```

Any validate failure, and the absence case a replay produces, both yield the single
`state` error code (research D10 — one code for five failures, deliberately).

**Never persisted, never logged, never sent to Google in a form that reveals the verifier** — the
authorize URL carries only the SHA-256 `code_challenge`.

---

## 5. Value objects (no persistence)

### `App\Support\GoogleIdentity` (readonly)

| Field | Type | Constraint checked at construction (FR-024) |
|---|---|---|
| `sub` | `string` | non-empty, ≤255 |
| `email` | `string` | `FILTER_VALIDATE_EMAIL`, ≤255 |
| `isEmailVerified` | `bool` | from the `email_verified` claim; strict boolean, `"true"` and `1` both accepted, anything else false |
| `name` | `?string` | raw claim; may be null/empty/oversized |

`displayName(): string` — total, never empty, ≤255. Research D13.

A constraint failure is a `provider` refusal (research D10), never an exception reaching the
visitor.

### `App\Support\OAuthFlowState`

Mints, validates and consumes §4. Pure given a session store, so it is unit-testable with
Laravel's array session driver and no HTTP.

---

## 6. Serialization — what clients may see

### `UserResource` gains two fields (own account only)

| Field | Type | Meaning |
|---|---|---|
| `has_password` | `bool` | `password !== null` — drives the account page's sign-in-method text |
| `google_linked_at` | `?string` | the link's `created_at`, or `null` |

`UserResource` is returned only by `POST /api/register`, `POST /api/login`, `GET /api/user` and
`GET /api/email/verify/{hash}` — always the requester's own account. No public endpoint uses it.

**`provider_user_id` appears in no resource, no route parameter, no log line and no page**
(FR-022, SC-009). `google_linked_at` is a timestamp, not an identifier.

### Frontend `AuthUser` gains the mirrored fields

```
hasPassword: boolean
googleLinkedAt: string | null
```

Sign-in-method text (FR-029), derived in `AuthModel`:

| `googleLinkedAt` | `hasPassword` | Text |
|---|---|---|
| set | `false` | `Google` |
| `null` | `true` | `Email and password` |
| set | `true` | `Google and email/password` |
| `null` | `false` | `Email and password` — unreachable; the total fallback |

---

## 7. State transitions

### Account lifecycle touched by this feature

```
                    ┌──────────────────────────── none ─────────────────────────────┐
                    │                                                               │
     Google sign-in, no link, no matching email                                     │
                    ↓                                                               │
        ┌── Google-only account ───┐                                                │
        │ password NULL            │←─── (no transition: password reset is out of scope)
        │ link present             │                                                │
        │ email verified           │                                                │
        └──────────┬───────────────┘                                                │
                   │ admin hard-delete (013) → link cascades → back to "none" ──────┘
                   │                                             (FR-032, US5 AS3)
                   ↓
      ┌──────── password account ────────┐        Google sign-in, address matches,
      │ password hash                    │ ─────► account enabled, not already linked
      │ no link                          │         ↓
      └──────────────────────────────────┘   ┌─ dual-method account ──┐
                                             │ password hash INTACT   │  FR-015
                                             │ link present           │
                                             │ email verified         │  FR-014
                                             └────────────────────────┘
```

### Refusals that write nothing (SC-006)

| Situation | Written |
|---|---|
| `email_verified` false / no email | nothing (FR-005 — checked before the transaction opens) |
| linked account is disabled | nothing (FR-017) |
| address matches a **disabled** account, not yet linked | nothing — no link, no account (US5 AS4) |
| address matches an account already linked to a different Google account | nothing (FR-012, US3 AS6) |
| state missing / stale / replayed, consent declined, provider error, rate limited | nothing |

Re-enabling a refused account leaves nothing to interfere with: the next Google sign-in runs the
US3 auto-link normally (FR-017 final clause, US5 AS5). That property is a direct consequence of
"refuse before write" and is asserted as such.

---

## 8. Invariants

| # | Invariant | Enforced by |
|---|---|---|
| INV-1 | One Google account → at most one Ladybug account | `UNIQUE (provider, provider_user_id)` |
| INV-2 | One Ladybug account → at most one Google account | `UNIQUE (user_id, provider)` |
| INV-3 | No account exists with two links to the same provider | INV-2 |
| INV-4 | No link outlives its account | `cascadeOnDelete` |
| INV-5 | An account reachable by Google always has `email_verified_at` set | set on create (FR-014) and on link (US3 AS4); never cleared |
| INV-6 | A linked account's `password`, `role`, `rating`, `disabled_at`, posts and comments are untouched by linking | the link path's only writes are the insert and the conditional `markEmailAsVerified()` (FR-015) |
| INV-7 | No empty, absent or unset password satisfies password login | `Hash::check()` fails closed + `LoginRequest` requires the field + the byte-identical-401 test (FR-020, SC-008) |
| INV-8 | `provider_user_id` appears in no URL and no API response | not in any resource; not a route parameter; `$hidden` on the model (FR-022, SC-009) |
| INV-9 | A refused sign-in leaves the database byte-for-byte unchanged | every refusal precedes the first write (FR-017, SC-006) |

---

## 9. Test fixtures

`UserFactory` gains two states, and a new `UserIdentityFactory` is added:

| Factory / state | Produces |
|---|---|
| `UserFactory::googleOnly()` | `password => null`, verified, member |
| `UserFactory::unverified()` | exists already — reused for US3 AS4 |
| `UserFactory::disabled()` | exists already (feature 012) — reused for US5 |
| `UserIdentityFactory` | `provider => 'google'`, unique `provider_user_id` |

Tests run on sqlite `:memory:` only (`Tests\TestCase` hard-aborts otherwise). Both unique indexes
and the FK cascade are exercised there — SQLite enforces both, and
`tests/Feature/Database/SchemaTest.php` gains the column/index assertions for the new table.
