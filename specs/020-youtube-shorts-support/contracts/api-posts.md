# Contract: POST /api/posts — Shorts detection, GET responses — new field

Extends the existing `POST /api/posts` / `GET /api/posts` / `GET /api/posts/{hash}`
contracts (features 008, 019). No new field, mode, or endpoint on the request side —
this feature only widens what the existing `youtube` field accepts and adds one
read-only field to the response.

## Request (multipart/form-data or JSON `youtube` field) — unchanged shape, wider acceptance

| Field | Required | Notes |
|-------|----------|-------|
| `title` | yes | Unchanged |
| `image` | one of `image`/`youtube`/`video` | Unchanged |
| `youtube` | one of `image`/`youtube`/`video` | **Now also accepts** `youtube.com/shorts/{id}` (optionally `www.`/`m.` host) alongside the existing `watch?v=`, `youtu.be/`, `/embed/`, and bare-id forms |
| `video` | one of `image`/`youtube`/`video` | Unchanged |

A value that contains the word "shorts" without a real `/shorts/{11-char-id}` path
segment is **not** recognized — it falls through to the existing 422, same as any
other unrecognized string (edge case in spec.md).

## Responses

### 201 Created (Shorts link accepted)

Same envelope as any other YouTube post (`TrashpostResource`), with the new field:

```json
{
  "hash": "9zq-abc_de",
  "title": "…",
  "type": "youtube",
  "file": null,
  "video": null,
  "youtube": "dQw4w9WgXcQ",
  "youtube_is_short": true,
  "metadata": null,
  "original": null,
  "default": null,
  "sizes": null,
  "hidden": "pending"
}
```

`youtube` stores the bare extracted id exactly as it does for a regular link — the
only new fact is `youtube_is_short`. `hidden` follows the existing pending/activated
rule, unaffected by this feature.

### 422 Unprocessable Entity

Unchanged: same "Enter a valid YouTube link." message on the `youtube` field for
anything that is not a recognized regular link or a recognized Shorts link (FR-004).
No new rejection reason is introduced.

## GET /api/posts and GET /api/posts/{hash}

Both serialize through `TrashpostResource`, which now always includes
`youtube_is_short: boolean` — `false` for every image/video post and every
non-Shorts YouTube post (including all posts created before this feature shipped).
No other field changes; pagination, ordering, and visibility rules are unchanged.

## GET /api/admin/posts (AdminTrashpostResource)

No change. The moderation console only needs a preview thumbnail (already handled
source-format-agnostically by `YoutubeThumbnailService`, R5) — it does not render the
player, so orientation is irrelevant there.
