# Phase 1 Data Model: Read-Side Feed API

This feature introduces **no new tables or migrations**. It reads the existing
`trashposts` table (feature 002) and the seeded image tree (feature 003). The "model"
here is the read/response shape and the query rules.

## Entities

### Post (`trashposts` row → `App\Models\Trashpost`)

Existing columns consumed by this feature (see
`database/migrations/2026_06_08_000000_create_trashposts_table.php`):

| Column | Type | Role in this feature |
|--------|------|----------------------|
| `id` | bigint (PK) | Cursor tie-break only; never exposed as the public handle. |
| `hash` | string(10), unique, nullable | **Public identifier** used in URLs, the `start` cursor, and `show` lookups. |
| `title` | string, nullable | Serialized as-is. |
| `type` | string, nullable | Serialized as-is (e.g. image vs video/link). |
| `file` | string, nullable | Image filename (`{code}.{ext}`); drives image-URL building. Null ⇒ no image. |
| `youtube` | string, nullable | Serialized as-is; link-only posts have `file` null. |
| `user_id` | FK users, nullable | Serialized as-is (owner reference). |
| `comment` | text, nullable | Serialized as-is. |
| `metadata` | text, nullable | Serialized as-is; optional image-width fallback source. |
| `created_at` | datetime | Serialized as-is. |
| `updated_at` | datetime | Serialized as-is. |
| `activated_at` | datetime, nullable | **Visibility + ordering key.** Null ⇒ hidden. |
| `deleted_at` | datetime, nullable | Soft-delete marker; non-null ⇒ hidden (handled by `SoftDeletes`). |

**Visibility rule**: a post is returned only when `activated_at IS NOT NULL` AND
`deleted_at IS NULL`.

**Ordering**: `activated_at DESC, id DESC` (deterministic; supports the keyset cursor).

### Feed page (query result, not persisted)

An ordered, bounded slice of visible posts. Inputs:

| Input | Source | Rule |
|-------|--------|------|
| `limit` | query string | Default 10; clamp to [1, 50]; invalid ⇒ 10. |
| `start` | query string | A post `hash`. When it resolves to a real post, restrict to posts strictly older (`activated_at <` AND `id <` the cursor post). Unknown/malformed ⇒ ignored. |

### Image size set (derived, not persisted)

For a post with a non-null `file = {code}.{ext}`, the subset of
`MediaPath::imageSizes()` = `['original','800','500','300','100']` whose file exists on
the `public` disk at `MediaPath::imageRelativePath($size, $code, $ext)`.

- `original` → its public URL (or null if absent).
- numeric sizes → `{ url, width:int }`, widest-first, only those present on disk.
- `default` → the `800` URL if present, else the widest present numeric size, else
  `original`, else null.
- Post with null `file` ⇒ empty image set (`original`/`default` null, `sizes` `[]`).

## Response shape (`TrashpostResource`)

```jsonc
{
  "id": 123,
  "hash": "Ab3-dZ9_q0",
  "title": "…",
  "type": "image",
  "file": "ab3xyz.jpg",         // or null
  "youtube": null,              // or a parsed YouTube ref
  "user_id": 7,                 // or null
  "comment": "…",
  "metadata": "…",
  "created_at": "2026-06-01T12:00:00.000000Z",
  "updated_at": "2026-06-01T12:00:00.000000Z",
  "activated_at": "2026-06-01T12:00:00.000000Z",
  "deleted_at": null,
  "url": "/posts/Ab3-dZ9_q0",            // future frontend deep link
  "url_api": "http://…/api/posts/Ab3-dZ9_q0",
  "original": "http://…/storage/image/trash/original/a/ab3xyz.jpg",  // or null
  "default":  "http://…/storage/image/trash/800/a/ab3xyz.jpg",       // or null
  "sizes": [
    { "url": "http://…/storage/image/trash/800/a/ab3xyz.jpg", "width": 800 },
    { "url": "http://…/storage/image/trash/300/a/ab3xyz.jpg", "width": 300 }
  ]
}
```

`GET /api/posts` returns an array of these objects under Laravel's default `data`
envelope; `GET /api/posts/{hash}` returns a single object (also under `data`). See
[contracts/feed-api.md](./contracts/feed-api.md) for the full request/response contract.

## Service surface (no new persistence)

- `App\Services\TrashpostService`
  - `feed(array $query): Collection` — applies visibility, ordering, `limit` clamp,
    and the `start` cursor; returns visible posts newest-first.
  - `findVisibleByHash(string $hash): ?Trashpost` — single visible post or null
    (controller turns null into 404).
- `App\Services\TrashpostImageService`
  - `imageData(Trashpost $post): array` — the `original`/`default`/`sizes` block,
    existing-only, reusing `App\Support\MediaPath` + `Storage::disk('public')`.
