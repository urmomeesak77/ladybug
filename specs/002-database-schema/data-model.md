# Phase 1 Data Model: Posts + Users

Derived from spec.md (Key Entities, Functional Requirements) and research.md. The exact
DDL contract is in [contracts/schema.md](./contracts/schema.md); this document describes the
domain entities, fields, relationships, and rules.

## Entity: Post (`trashposts` table)

A single uploaded item in the feed (image, video, or YouTube link). Faithful copy of the
**live** prototype row, minus `temp`/`oldfile`/`text`, with `user` upgraded to `user_id`.

| Field | Type (MySQL) | Null | Notes |
|-------|--------------|------|-------|
| `id` | `bigint unsigned` PK, auto-increment | no | Surrogate key; never the public identifier. |
| `hash` | `varchar(10)` `utf8mb4_bin`, **unique** | yes¹ | Public shareable identifier. Case-sensitive, 10 chars from `[A-Za-z0-9_-]`. Copied verbatim on manual import. |
| `title` | `varchar(255)` | yes | Optional caption/title. |
| `type` | `varchar(255)` | yes | Content type discriminator (e.g. image/video/youtube). |
| `file` | `varchar(255)` | yes | Uploaded file reference; null for YouTube-only posts. |
| `youtube` | `varchar(255)` | yes | YouTube link; null for file-only posts. |
| `user_id` | `bigint unsigned`, **FK → users.id**, `nullOnDelete` | yes | Owning account. Null when no owner; MUST reference an existing user when set. *(Enhancement over prototype's `user` string — FR-001a.)* |
| `comment` | `text` | yes | Free-text comment. |
| `metadata` | `text` | yes | Arbitrary metadata blob (present in live table; replaces the stale `text` column). |
| `created_at` | `timestamp` DEFAULT CURRENT_TIMESTAMP | yes | Creation time. |
| `updated_at` | `timestamp` ON UPDATE CURRENT_TIMESTAMP (MySQL) | yes | Last-modified time. |
| `activated_at` | `timestamp` | yes | Lifecycle: when the post became active. |
| `deleted_at` | `timestamp` | yes | Soft-delete marker (Eloquent `SoftDeletes`). |

¹ `hash` is nullable to mirror the prototype, but the unique constraint still rejects
duplicate non-null values. App-layer code assigns a hash on creation (future feature).

**Excluded columns** (live source has them; new schema omits, per owner decision):
`temp`, `oldfile`, the stale `text`, and the prototype's loose `user` string.

**Eloquent model** (`App\Models\Trashpost`):
- `protected $table = 'trashposts';`
- `protected $fillable = ['hash', 'title', 'type', 'file', 'youtube', 'user_id', 'comment', 'metadata'];`
- `use SoftDeletes;` (maps `deleted_at`)
- `casts`: `created_at`/`updated_at`/`activated_at`/`deleted_at` → `datetime`
- Relationship: `user()` → `belongsTo(User::class)`

## Entity: User (account, `users` table)

A registered account. Mirrors the prototype's `users` columns; the default Laravel
`users` table is amended to add `hash`.

| Field | Type (MySQL) | Null | Notes |
|-------|--------------|------|-------|
| `id` | `bigint unsigned` PK, auto-increment | no | Surrogate key. |
| `name` | `varchar(255)` | no | Display name. |
| `hash` | `varchar(10)` `utf8mb4_bin`, **unique** | no | Stable public identifier for the account. |
| `email` | `varchar(255)`, **unique** | no | Login email; case-insensitive uniqueness (normal email expectation). |
| `email_verified_at` | `timestamp` | yes | Verification time. |
| `password` | `varchar(255)` | no | Stored already-hashed by the app layer. |
| `remember_token` | `varchar(100)` | yes | "Remember me" token. |
| `created_at` | `timestamp` | yes | Standard Laravel timestamps. |
| `updated_at` | `timestamp` | yes | |

**Eloquent model** (`App\Models\User`, amended):
- `$fillable` adds nothing security-sensitive; `hash` is assigned by the app, not mass-assigned by user input. Keep `['name', 'email', 'password']` fillable; set `hash` explicitly.
- `$hidden`: `password`, `remember_token` (unchanged).
- `casts`: `email_verified_at` → `datetime`, `password` → `hashed` (unchanged).
- Relationship: `posts()` → `hasMany(Trashpost::class)`.

## Relationships

```
User (1) ──< (0..*) Post
   users.id  ←──FK── trashposts.user_id  (nullable, nullOnDelete)
```

- A User owns **zero or more** Posts.
- A Post has **zero or one** owning User (`user_id` null = unowned).
- Deleting a User sets its posts' `user_id` to null (posts survive).

## Validation & Constraint Rules (enforced by this feature)

| Rule | Source | Mechanism |
|------|--------|-----------|
| `trashposts.hash` unique | FR-003 | DB unique index |
| `users.hash` unique | FR-003 | DB unique index |
| `users.email` unique | FR-003 | DB unique index |
| `hash` case-sensitive distinctness | FR-004 | `utf8mb4_bin` collation (MySQL); BINARY default (SQLite) |
| `hash` max length 10 | FR-005 (partial) | `varchar(10)` |
| `user_id` references an existing user | FR-001a | Foreign key constraint |
| Most post columns nullable | Edge cases | Column nullability above |

**Deferred to a later feature** (not enforced by this schema-only slice — see research R5):
exact-length-10 and `[A-Za-z0-9_-]` character-set validation of `hash` (application-layer,
applied where codes are minted).

## State Transitions

A Post has a soft lifecycle expressed via timestamps (no enum/state machine):
- **Created**: `created_at` set.
- **Activated**: `activated_at` set when the post becomes active (semantics owned by future app code).
- **Soft-deleted**: `deleted_at` set; row remains, excluded from default queries via `SoftDeletes`.
- **Restored**: `deleted_at` cleared.
