# Phase 1 Data Model: Trashpost Comments

## New table: `comments`

Migration `2026_07_23_000000_create_comments_table.php`.

| Column          | Type / constraints                                                        | Notes |
|-----------------|---------------------------------------------------------------------------|-------|
| `id`            | `bigIncrements` PK                                                          | Internal only — never exposed (Principle V). |
| `hash`          | `string(10)`, unique, `utf8mb4_bin` collation on MySQL                      | Public identifier. `Str::createUniqueHash`. Same shape as `trashposts.hash`. Immutable. |
| `trashpost_id`  | `foreignId`, `constrained('trashposts')`, **`cascadeOnDelete()`**           | Parent post. Cascade fires only on a real row delete (purge), not soft delete (D4). |
| `user_id`       | `foreignId`, nullable, `constrained('users')`, **`nullOnDelete()`**         | Author account; nulls if the account is later hard-deleted (D5, 013 FKs). |
| `username`      | `string`, nullable                                                          | Author name snapshot at creation; orphan fallback display (D5). |
| `body`          | `text`                                                                      | The comment content; stored verbatim (≤1000 chars enforced at validation). |
| `hidden_at`     | `timestamp`, nullable                                                       | Moderation state: non-null = hidden from public, still visible to admins (D2). |
| `created_at`    | `timestamp`, nullable, `useCurrent()`                                       | Post time; primary sort key (newest-first). |
| `updated_at`    | `timestamp`, nullable, `useCurrent()` + `useCurrentOnUpdate()` on MySQL     | Follows the `trashposts` migration's MySQL/SQLite split (portable in tests). |

**Indexes**: unique on `hash`; FK index on `trashpost_id` (created by `constrained`). A
composite index on `(trashpost_id, created_at, id)` backs the newest-first keyset listing
per post.

**No `SoftDeletes`** — permanent delete is a hard row removal (D3).

### Migration MySQL/SQLite split

Follow `2026_06_08_000000_create_trashposts_table.php`: detect
`Schema::getConnection()->getDriverName() === 'mysql'` and apply `utf8mb4_bin` collation on
`hash` and `useCurrentOnUpdate()` on `updated_at` only on MySQL; SQLite (tests) degrades to
portable equivalents.

## Model: `App\Models\Comment`

```
class Comment extends Model
  use HasFactory;
  protected $table = 'comments';
  protected $fillable = ['body'];          // body only; hash/trashpost_id/user_id/username/
                                           // hidden_at are set by the service, never mass-assigned
  // relations
  trashpost(): BelongsTo   → Trashpost
  user(): BelongsTo        → User (nullable owner)
  // helpers
  isHidden(): bool         → $this->hidden_at !== null
  // casts: created_at/updated_at/hidden_at → datetime
```

`hash`, `trashpost_id`, `user_id`, `username`, and `hidden_at` are **out of `$fillable`**
(privilege/integrity guard, Principle VI) — the service assigns them explicitly, exactly as
`Trashpost` keeps `hash`/`user_id` off mass assignment.

### Related-model edits

- **`Trashpost`**: add `comments(): HasMany` → `Comment`.
- **`User`**: add `comments(): HasMany` → `Comment`.

## State transitions (a single comment)

```
            create (verified user)
                 │
                 ▼
            ┌─────────┐   hide (admin)    ┌────────┐
            │ visible │ ───────────────▶  │ hidden │
            │hidden_at│ ◀───────────────  │hidden_at│
            │ = null  │   unhide (admin)  │ = now() │
            └─────────┘                    └────────┘
                 │                              │
                 └──────── delete (admin) ──────┘
                           │  (confirmed)
                           ▼
                        removed  (row gone — irreversible)
```

- **create**: verified author only; sets `hash`, `trashpost_id`, `user_id`, `username`
  snapshot, `body`; `hidden_at` null → immediately public (no activation workflow).
- **hide / unhide**: admin+ toggles `hidden_at` between `now()` and `null`. Idempotent and
  reversible with no residual effect (set-to-target, like the moderation transitions).
- **delete**: admin+, confirmed; hard-removes the row. Supersedes the hidden state (a hidden
  comment can still be deleted — edge case "Hide then delete").
- **cascade**: when the parent trashpost is purged, the FK removes the comment (D4).

## Validation rules (`CreateCommentRequest`)

| Field | Rules | Requirement |
|-------|-------|-------------|
| `body` | `required`, `string`, trimmed non-empty, `max:1000` | FR-007 (reject empty/whitespace), FR-008 (≤1000). |

Empty/whitespace-only bodies are rejected: apply `prepareForValidation` to trim, then
`required` catches an all-whitespace body reduced to `''`. `authorize()` returns `true` —
authentication/verification is the route middleware's job (D8).

## Entity relationships

- **Trashpost 1 — n Comment** (`comments.trashpost_id`, cascade on purge).
- **User 1 — n Comment** (`comments.user_id`, null on author deletion).
- A **Comment** belongs to exactly one Trashpost and at most one (possibly orphaned) User.

## Derived / computed values

- **Public comment count** (`meta.total`): `COUNT(*)` over the post's comments where
  `hidden_at IS NULL` — always the public count regardless of viewer (D7, FR-015).
- **Author display name**: `user?->name ?? username` in `CommentResource` (D5).
- **`hidden` flag** in a resource row: `true` when `hidden_at !== null` — only ever sent to
  an admin viewer (guests/members never receive hidden rows).
