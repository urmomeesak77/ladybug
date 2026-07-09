# Phase 1 Data Model: Admin Meme Moderation Table

This feature adds **one nullable column** to an existing table and introduces no new tables.
The moderation view is a projection over `trashposts` joined to `users`.

## Entity: Trashpost (existing — one additive column)

Table `trashposts` (see `2026_06_08_000000_create_trashposts_table.php` and later
migrations). Attributes relevant to moderation:

| Column | Type | Role in this feature |
|--------|------|----------------------|
| `id` | bigint PK | Internal only — **never** serialized (Principle V). Secondary sort key for stable newest-first order. |
| `hash` | string(10) unique | Public identifier — used in the row's `/posts/{hash}` link and every action endpoint. |
| `title` | string, nullable | Not shown in the compact table (title lives on the meme page). |
| `type` | string, nullable | `'youtube'` for YouTube memes; null/other for image. Selects thumbnail strategy. |
| `file` | string, nullable | Stored image filename (`{code}.{ext}`); source of the `100`-size thumbnail. |
| `youtube` | string, nullable | Validated 11-char video id; source of the remote thumbnail URL. |
| `user_id` | FK users, nullable | Resolves the uploader account; `nullOnDelete`. |
| `username` | string, nullable | Stored uploader name; fallback when `user_id` does not resolve (FR-012). |
| `created_at` | timestamp | **Newest-first sort key** (FR-003) and the "created" column (FR-013). |
| `activated_at` | timestamp, nullable | Non-null ⇒ **activated**. Toggled by Activate/Deactivate. |
| `deleted_at` | timestamp, nullable (SoftDeletes) | Non-null ⇒ **deleted**. Toggled by Delete/Restore. |
| **`youtube_thumbnail`** | **string, nullable — NEW** | Relative `public`-disk path of the once-downloaded YouTube still. Null until first successful fetch; drives SC-004 (fetch at most once). |

### New migration

`2026_07_09_000000_add_youtube_thumbnail_to_trashposts_table.php` — additive and reversible:

- **up**: `$table->string('youtube_thumbnail')->nullable()->after('youtube');`
- **down**: `$table->dropColumn('youtube_thumbnail');`

`youtube_thumbnail` is added to `Trashpost::$fillable`. No index needed (looked up by `hash`,
not by thumbnail). Reversibility is covered by the existing `MigrationReversibilityTest`
pattern.

### State model (per meme)

Two independent, fully reversible axes (FR-016):

```
activation:  not-activated  ──Activate──▶  activated
                            ◀─Deactivate──
deletion:    not-deleted    ──Delete────▶  deleted   (soft: row + media retained)
                            ◀─Restore────
```

- Activate ⇒ `activated_at = now()`; Deactivate ⇒ `activated_at = null`.
- Delete ⇒ `deleted_at = now()` (Eloquent `delete()`); Restore ⇒ `deleted_at = null`
  (`restore()`).
- The two axes are orthogonal: a deleted meme still shows Activate/Deactivate per its
  activation state (edge case: already-deleted meme), and vice-versa.
- Transitions are idempotent against their target state (concurrent/repeated actions land the
  same final state without error).

## Entity: User (existing — read-only here)

`users.role` (`App\Enums\Role`: guest < member < admin < superuser) gates access
(admin or higher). `users.name` is the account display name shown in the user column when
`user_id` resolves. No changes to the `users` table.

## Projection: Moderation row (API shape, not a table)

Produced by `AdminTrashpostResource` from a `Trashpost` (with its `user` eager-loaded):

| Field | Source / rule |
|-------|---------------|
| `hash` | `trashpost.hash` (row link + action key). |
| `thumbnail` | Image: URL of the existing `100`-size variant, else `null`. YouTube: URL of the stored/just-fetched thumbnail, else `null`. Other/malformed: `null`. `null` ⇒ UI placeholder (FR-008/009/010/011). |
| `type` | `trashpost.type` (lets the UI label/aria-describe the media kind). |
| `username` | `user.name` when `user_id` resolves, else `trashpost.username` (FR-012). |
| `created_at` | `trashpost.created_at` (FR-013). |
| `activated` | `trashpost.activated_at !== null` (FR-014). |
| `deleted` | `trashpost.deleted_at !== null` (FR-014). |
| `url` | `/posts/{hash}` — the meme's own page (FR-018). |

**Deliberately omitted** (mirrors `TrashpostResource`): `id`, `user_id`, `file` path,
`deleted_at`/`activated_at` raw timestamps, `comment`, `metadata` — internal bookkeeping.

### Pagination envelope

The index returns Laravel's paginator payload: `data` (≤100 rows) plus `meta`
(`current_page`, `last_page`, `per_page` = 100, `total`). The frontend `ModerationModel`
derives the numbered page links and the current page from `meta`; the URL carries `?page=N`
(FR-004/FR-005). Ordering: `created_at DESC, id DESC`, over **all** states
(`withTrashed()`, no `activated_at` filter).

## Storage: YouTube thumbnail files

New dedicated subtree on the `public` disk, resolved by
`MediaPath::youtubeThumbnailRelativePath(videoId)` →
`image/trash/youtube/{shard}/{videoId}.jpg` (shard via the existing `MediaPath::shardFor`
rule, keeping any one directory from holding the whole library). Files are written once and
reused; the relative path is persisted in `trashposts.youtube_thumbnail`.
