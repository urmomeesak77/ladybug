# Phase 1 Data Model: User Rating & Auto-Activation

Three additive columns across two existing tables. No new tables (research D1).

## Entity: User (existing — one additive column)

| Column | Type | Role in this feature |
|--------|------|----------------------|
| `id` | bigint PK | Internal only — never serialized (Principle V). |
| `role` | string | Read by FR-017: admin/superuser publish immediately regardless of rating. |
| **`rating`** | **smallint signed, NOT NULL, default 0 — NEW** | The account's trust score. Range −32768 … 32767; saturates at both bounds (FR-011a). |

### Migration — `2026_07_20_000000_add_rating_to_users_table.php`

- **up**: `$table->smallInteger('rating')->default(0)->after('role');`
- **down**: `$table->dropColumn('rating');`

Signed, because FR-011 permits negative ratings. `default(0)` pins new accounts (FR-001) and
backfills every existing account in the same DDL step (FR-002) — the pattern
`add_role_to_users_table` established. Covered by the existing `MigrationReversibilityTest`.

### Model guards

- `rating` is **NOT** in `User::$fillable` — no request body can reach it via `fill()`
  (FR-003), mirroring the guard already documented on `role` in `User.php:33-40`.
- `rating` is **NOT** in `UserResource` — never exposed to end users (FR-022).
- No cast needed: a smallint hydrates as PHP `int`.

## Entity: Trashpost (existing — two additive columns)

Per-meme bookkeeping for what the meme has already contributed to its owner's rating. Distinct
from `activated_at`/`deleted_at`, which are the meme's *state*; these record what has already
been *paid out* for that state.

| Column | Type | Role in this feature |
|--------|------|----------------------|
| `user_id` | FK users, nullable | The account to adjust. **Null ⇒ adjust nothing** (FR-012). |
| `activated_at` | timestamp, nullable | Meme state. Unchanged by this feature. |
| `deleted_at` | timestamp, nullable | Meme state (SoftDeletes). Unchanged by this feature. |
| **`rating_credited`** | **boolean, NOT NULL, default false — NEW** | True while this meme holds a +1 for its owner. |
| **`rating_penalized`** | **boolean, NOT NULL, default false — NEW** | True once this meme has cost its owner its single −1. |

### Migration — `2026_07_20_000001_add_rating_flags_to_trashposts_table.php`

- **up**: `$table->boolean('rating_credited')->default(false)->after('activated_at');`
  and `$table->boolean('rating_penalized')->default(false)->after('rating_credited');`
- **down**: `$table->dropColumn(['rating_credited', 'rating_penalized']);`

Both default `false` for existing rows, which is exactly FR-002's semantics: a meme activated
before this feature holds **no credit**, so deactivating it applies the normal −1 with no
matching +1 ever having been granted. The spec accepts this explicitly (Edge Cases, SC-005).

Neither column is in `Trashpost::$fillable` — they are written only by `RatingService`, never
mass-assigned. Cast both to `'boolean'`. No index: always reached via the already-indexed
`hash` lookup.

## The invariant

> `users.rating` = (memes with `rating_credited = true`) − (memes with `rating_penalized = true`)

…summed over the account's memes, **plus** the frozen contribution of memes already purged
(their rows are gone, but their net effect was applied to `users.rating` before deletion), and
clamped to the smallint range. This is SC-003 restated in storage terms.

## Adjustment table

Every moderation action, the flag transition it performs, and the resulting rating delta. **A
delta applies only when the flag actually changes** — that single conditional is what delivers
FR-006 (no drift), FR-008 (at most one penalty), and FR-014 (no double count).

| Action | Precondition | Flag change | Δ rating | FR |
|--------|-------------|-------------|---------:|----|
| Activate | `!rating_credited` | `rating_credited → true` | **+1** | FR-005 |
| Activate | `rating_credited` | none | 0 | FR-006, FR-014 |
| Deactivate | `rating_credited` | `rating_credited → false` | **−1** | FR-005 |
| Deactivate | `!rating_credited` | none | 0 | FR-006 |
| Soft delete | `!rating_penalized` | `rating_penalized → true` | **−1** | FR-007 |
| Soft delete | `rating_penalized` | none | 0 | FR-008 |
| Restore | `rating_penalized` | `rating_penalized → false` | **+1** | FR-010 |
| Restore | `!rating_penalized` | none | 0 | FR-010 |
| Purge | `rating_credited` | credit released | **−1** | FR-009 |
| Purge | `!rating_penalized` | penalty applied | **−1** | FR-007 |
| Purge | both above | both | **−2** | FR-009, US1 §9 |
| Any, `user_id === null` | — | flags still update | **0** | FR-012 |

Note that soft delete does **not** release the activation credit, while purge does. That is
deliberate and it is what makes restore lossless: a soft-deleted meme that is restored returns
to holding its +1 without ever having released it (FR-010).

### Worked sequences (SC-004: destination, never route)

| Sequence | Flags after | Net Δ |
|----------|------------|------:|
| activate → soft delete | credited, penalized | +1 −1 = **0**, meme still holds credit while trashed |
| activate → soft delete → purge | row gone | +1 −1 −1 = **−1** |
| activate → deactivate → purge | row gone | +1 −1 −1 = **−1** |
| activate → purge | row gone | +1 −2 = **−1** |
| soft delete → purge (never activated) | row gone | −1 + 0 = **−1** |
| activate → deactivate → activate | credited | +1 −1 +1 = **+1**, not +2 |
| soft delete → restore | clean | −1 +1 = **0** |
| legacy activated meme → deactivate | not credited | **−1** (FR-002 baseline, accepted) |

Every route to a deleted meme lands at −1. That is SC-004.

## Auto-activation decision (FR-015 … FR-020)

Evaluated once, at creation, **before** the new post exists:

```
shouldAutoActivate(user) := user.role is admin or superuser      (FR-017)
                            OR user.rating >= 15                  (FR-016)
```

- True ⇒ post is created with `activated_at = now()`, then credited **+1** via the normal
  activate path (FR-019) — an auto-activation is an activation, no special case.
- False ⇒ post is created with `activated_at = null`, `rating_credited = false`, and its media
  is synced to the private disk (research D4) so the bytes are not publicly fetchable while
  the row is pending.
- The comparison reads the rating **before** the new post's own credit lands (FR-020), which
  is automatic: the post does not exist yet.

## State model (per meme)

The two state axes from feature 010 are unchanged. This feature adds two bookkeeping bits that
shadow them:

```
activation:  not-activated ──Activate──▶ activated        credited: false ──▶ true  (+1)
                           ◀─Deactivate──                            true ──▶ false (−1)

deletion:    not-deleted   ──Delete────▶ deleted          penalized: false ──▶ true  (−1)
                           ◀─Restore────                             true ──▶ false (+1)

purge:       any ──▶ row destroyed                        release credit if held (−1)
                                                          apply penalty if unpaid  (−1)
```

The bookkeeping bits are not redundant with the state columns. `activated_at` says what the
meme *is*; `rating_credited` says what has *already been paid*. They diverge for exactly the
cases the spec cares about: a legacy meme (activated, never credited) and a soft-deleted meme
(not publicly visible, still credited).
