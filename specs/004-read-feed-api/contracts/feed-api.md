# Contract: Read-Side Feed API

Two read-only, unauthenticated JSON endpoints. Base path is Laravel's API prefix
(`/api`). All responses are `application/json`. A **visible** post is one with
`activated_at` set and not soft-deleted; non-visible posts are never returned.

## `GET /api/posts` — feed (list)

Returns the newest visible posts, newest-first, as a bounded page.

### Query parameters

| Name | Type | Required | Default | Rules |
|------|------|----------|---------|-------|
| `limit` | integer | no | `10` | Clamped to `[1, 50]`. Non-numeric / `≤ 0` ⇒ default `10`. `> 50` ⇒ `50`. |
| `start` | string (post `hash`) | no | — | Keyset cursor: return only posts strictly older than the post with this `hash`. Unknown/malformed ⇒ ignored (newest page returned). |

Any other query parameters are ignored in this feature (no title/type/user filters).

### Ordering & pagination

- Order: `activated_at DESC, id DESC`.
- Cursor semantics: with a resolvable `start`, results satisfy the keyset predicate
  `(activated_at < cursor.activated_at) OR (activated_at = cursor.activated_at AND id < cursor.id)`.
  (The simpler `activated_at < cursor AND id < cursor.id` is **wrong** — it skips posts
  whose `activated_at` is older but whose `id` is larger, since activation is not
  monotonic with insertion.) Iterating by passing the last item's `hash` as the next
  `start` walks the entire visible set with **no duplicates and no gaps**.

### Responses

- `200 OK` — JSON body `{ "data": [ <Post>, … ] }`, at most `limit` items (default 10).
  Empty feed ⇒ `{ "data": [] }`.

### Examples

```
GET /api/posts                         → newest 10 visible posts
GET /api/posts?limit=3                  → newest 3
GET /api/posts?limit=999                → newest 50 (clamped)
GET /api/posts?start=Ab3-dZ9_q0         → up to 10 visible posts older than Ab3-dZ9_q0
GET /api/posts?start=Ab3-dZ9_q0&limit=5 → up to 5 older than the cursor
GET /api/posts?start=__nomatch__        → newest 10 (cursor ignored)
```

## `GET /api/posts/{hash}` — single post

Returns one visible post addressed by its public `hash`.

### Path parameters

| Name | Type | Rules |
|------|------|-------|
| `hash` | string | The post's public identifier (10-char `[A-Za-z0-9-_]`). |

### Responses

- `200 OK` — JSON body `{ "data": <Post> }` when a visible post matches.
- `404 Not Found` — when no **visible** post matches (unknown `hash`, not activated, or
  soft-deleted). Standard Laravel not-found JSON.

### Examples

```
GET /api/posts/Ab3-dZ9_q0   → 200 { "data": { … } }   (visible)
GET /api/posts/doesnotexist → 404
GET /api/posts/<hidden>     → 404   (activated_at null)
GET /api/posts/<deleted>    → 404   (soft-deleted)
```

## `<Post>` object

| Field | Type | Notes |
|-------|------|-------|
| `id` | int | DB id (informational; not the public handle). |
| `hash` | string | Public identifier (URLs, cursor, lookups). |
| `title` | string\|null | |
| `type` | string\|null | |
| `file` | string\|null | Image filename `{code}.{ext}`; null for link-only posts. |
| `youtube` | string\|null | |
| `user_id` | int\|null | Owner reference. |
| `username` | string\|null | Denormalized owner name (for rendering). |
| `comment` | string\|null | |
| `metadata` | string\|null | |
| `created_at` | string (ISO-8601) | |
| `updated_at` | string (ISO-8601) | |
| `activated_at` | string (ISO-8601)\|null | Always non-null for returned posts. |
| `deleted_at` | null | Always null for returned posts. |
| `url` | string | Frontend deep link `/posts/{hash}`. |
| `url_api` | string | Absolute URL of `GET /api/posts/{hash}`. |
| `original` | string\|null | URL of the `original` size if present on disk, else null. |
| `default` | string\|null | `800` URL if present, else widest present size, else `original`, else null. |
| `sizes` | array | `[{ "url": string, "width": int }, …]` — only numeric sizes present on disk, widest-first. `[]` when the post has no image. |

### Image-size rules

- Sizes come from `MediaPath::imageSizes()` = `original, 800, 500, 300, 100`.
- A size appears **only if its file exists** on the `public` disk at
  `image/trash/{size}/{shard}/{code}.{ext}` (shard = `MediaPath::shardFor`).
- Absent sizes are omitted; the API never returns a URL to a missing file and never
  fabricates or resizes images.
- A post with `file = null` returns `original: null`, `default: null`, `sizes: []`.

## Guarantees

- Read-only: no side effects; safe and idempotent.
- No authentication required (public feed).
- All DB access is parameterized via Eloquent; `hash`/`start` are bound, never
  concatenated.
