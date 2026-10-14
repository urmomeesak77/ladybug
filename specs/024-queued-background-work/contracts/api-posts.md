# Contract: Posts API changes (024)

## POST /api/posts (changed)

Validation and error responses are unchanged (contracts of 008/014/019).

**201 Created** — same body shape as before, plus `media_state`:

```json
{ "data": { "hash": "Ab3dEfGh1_", "media_state": "processing", "file": null, "original": null,
            "default": null, "sizes": [], "activated_at": null, "hidden": "pending", "...": "..." } }
```

- Image / video upload: `media_state` is `"processing"`; media fields are null/empty and
  `activated_at` is null even for a trusted uploader (activation happens when processing succeeds).
- YouTube upload: `media_state` is `"ready"`; activation behaves exactly as before.

**503 Service Unavailable** — new: the upload could not be staged (e.g. disk full).
`{ "message": "Uploads are temporarily unavailable. Please try again later." }` No post is created.

## GET /api/posts/{hash} (changed)

Adds `media_state` (`processing` | `ready` | `failed`). Visibility:

| Viewer | ready + active | processing / failed |
|---|---|---|
| guest / other member | 200 | 404 (as any non-public post) |
| uploader | 200 | 200 (not trashed) |
| admin+ | 200 | 200 |

## GET /api/posts (unchanged shape)

Every row now also carries `media_state: "ready"`; non-ready posts are never listed.

## Admin: GET /api/admin/posts (changed)

Each row adds `media_state`.

## Admin: POST /api/admin/posts/{hash}/activate (changed)

**409 Conflict** when `media_state !== "ready"`:
`{ "message": "This meme's media is not ready yet." }` No state changes, no rating change.

## POST /api/password/forgot (behaviour only)

Same `200` body and headers for every address. The response no longer waits on any lookup, token
or mail work: the request enqueues one job per call regardless of the address.

## POST /api/register, POST /api/email/verification-notification (behaviour only)

Same responses; the verification message is enqueued, not sent in-request.
