# Contract: POST /api/posts — video branch

Extends the existing `POST /api/posts` contract (feature 008) with a third,
mutually-exclusive media input. Requires `auth:sanctum` + verified e-mail, unchanged.

## Request (multipart/form-data)

| Field | Required | Notes |
|-------|----------|-------|
| `title` | yes | Unchanged — required, ≤255 chars |
| `image` | one of `image`/`youtube`/`video` | Unchanged |
| `youtube` | one of `image`/`youtube`/`video` | Unchanged |
| `video` | one of `image`/`youtube`/`video` **(new)** | MP4 or WebM, ≤20 MB, must decode as a real video stream |

Providing more than one of `image` / `youtube` / `video` is rejected the same way the
existing two-way exclusivity is: a 422 on the offending field.

## Responses

### 201 Created (video accepted)

Same envelope as an image/YouTube post (`TrashpostResource`), with:

```json
{
  "hash": "9zq-abc_de",
  "title": "…",
  "type": "video",
  "file": "9zq-abc_de.mp4",
  "youtube": null,
  "video": "https://…/storage/video/trash/9/9zq-abc_de.mp4",
  "metadata": "{\"width\":1280,\"height\":720,\"ratio\":1.7778,\"mime\":\"video/mp4\"}",
  "original": "https://…/storage/image/trash/original/9/9zq-abc_de.jpg",
  "default": "https://…/storage/image/trash/800/9/9zq-abc_de.jpg",
  "sizes": [{ "url": "…/300/…", "width": 300 }, { "url": "…/100/…", "width": 100 }],
  "hidden": "pending"
}
```

`hidden` follows the existing rule (`"pending"` below trust threshold, `null` once
activated) — unchanged by this feature (FR-009).

### 422 Unprocessable Entity — rejection reasons (FR-007)

| Scenario | Field | Example message |
|----------|-------|------------------|
| Wrong/unsupported format (including MOV) | `video` | Naming the accepted formats (MP4, WebM) |
| File over 20 MB | `video` | Stating the 20 MB limit |
| Extension/MIME claims video but content is not decodable, or is corrupt | `video` | Distinct "unreadable/corrupt" message, not conflated with the format message |
| More than one of image/youtube/video supplied | the redundant field(s) | Same phrasing pattern as the existing two-way exclusivity message |

No post row is created for any 422 (FR-002, FR-003, FR-007, SC-002) — validation runs
entirely before `TrashpostService::createPost()` is invoked.

## GET /api/posts and GET /api/posts/{hash}

Both already serialize through `TrashpostResource`; the same `video` field described
above appears (as `null` for non-video posts) with no other contract change. Feed
ordering, pagination (10/page, keyset cursor), and visibility rules are unchanged and
apply identically to video posts (FR-009).

## GET /api/admin/posts (AdminTrashpostResource)

`thumbnail` resolves from the post's poster (not `file`) when `type === 'video'`;
otherwise unchanged. No new fields on this resource — the moderation console does not
need the raw playable video URL, only a preview thumbnail, consistent with how it
already handles image and YouTube rows.
