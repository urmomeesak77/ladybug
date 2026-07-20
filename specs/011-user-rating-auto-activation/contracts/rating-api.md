# Contract: User Rating & Auto-Activation

This feature adds **no new endpoints**. It changes the behaviour of three existing surfaces and
adds one field to one payload. Each change below is stated as a testable delta against what
ships today.

## 1. `GET /api/admin/posts` — one new field per row

`AdminTrashpostResource` gains `rating` (FR-021).

```jsonc
{
  "data": [
    {
      "hash": "aB3dEf7HjK",
      "thumbnail": "https://…/100/aB3dEf7HjK.jpg",
      "title": "cat on a keyboard",
      "type": null,
      "username": "urmo",
      "rating": 17,              // NEW — owner's current rating
      "created_at": "2026-07-20 11:02:31",
      "activated_at": "2026-07-20 11:02:31",
      "deleted_at": null
    },
    {
      "hash": "zZ9qWe1RtY",
      "username": "legacy_uploader",
      "rating": null,            // NEW — meme has no owning account
      // …
    }
  ],
  "meta": { "current_page": 1, "last_page": 4, "per_page": 100, "total": 312 }
}
```

| Field | Type | Semantics |
|-------|------|-----------|
| `rating` | `int \| null` | The **owning account's** current rating. `null` iff the meme has no resolvable owner (`user_id` null). Never omitted. |

- `rating` is the owner's account-wide rating, **not** a per-meme value. Two rows owned by the
  same account always show the same number.
- `null` MUST render in the UI as an explicit "no account", never as `0` and never as an empty
  cell (FR-021).
- No N+1: `ModerationService::paginate()` already eager-loads `with('user')`.
- Access is unchanged: `auth:sanctum` + `role:admin`. Rating never appears on any non-admin
  endpoint (FR-022).

## 2. `POST /api/posts` — activation becomes conditional

**Today**: every upload is created activated and appears in the feed immediately.

**After this feature**: the response shape is unchanged, but whether the meme is publicly
visible now depends on the uploader.

| Uploader | Outcome | Media disk |
|----------|---------|-----------|
| rating ≥ 15 | activated on creation; in the feed immediately; rating +1 | `public` |
| role admin or superuser (any rating, incl. negative) | activated on creation; rating +1 | `public` |
| rating < 15 and role member | **created unactivated**; absent from `GET /api/posts` and 404 on `GET /api/posts/{hash}` until a moderator activates | `local` (private) |

- Status code is `201` in **both** cases — a pending upload is a success, not an error. The
  client is not told which branch it took beyond the returned resource's own fields.
- The threshold is evaluated **before** the new post's own +1 lands (FR-020). An account at
  exactly 14 uploading does **not** auto-activate; an account at 15 does.
- The pending meme's files MUST NOT be reachable on the public disk (research D4). This is a
  contract requirement, not an implementation detail: a saved permalink to the media of a
  pending upload MUST 404.
- Existing guards are unchanged: `auth:sanctum`, `verified`, `throttle:uploads`.

## 3. Moderation actions — unchanged shapes, new rating side effects

All five endpoints keep their current request and response shapes, status codes, and
idempotency guarantees. Each gains a rating side effect on the meme's owner.

| Endpoint | Response | Rating side effect on owner |
|----------|----------|----------------------------|
| `POST /api/admin/posts/{hash}/activate` | `200` + row | **+1**, once, iff not already credited |
| `POST /api/admin/posts/{hash}/deactivate` | `200` + row | **−1**, iff currently credited |
| `DELETE /api/admin/posts/{hash}` | `200` + row | **−1**, iff not already penalized |
| `POST /api/admin/posts/{hash}/restore` | `200` + row | **+1**, iff currently penalized |
| `DELETE /api/admin/posts/{hash}/purge` | `204` | **−1** if credited, **−1** if not yet penalized (so **−2** for a live activated meme) |

### Guarantees

- **Idempotent (FR-014)**: a repeated or concurrent call adjusts the rating **zero** additional
  times. Calling activate twice is +1 total, not +2. This holds under simultaneous requests,
  not merely sequential ones.
- **Atomic (FR-013)**: the state change and the rating write commit together. A failure in
  either leaves both unchanged — a caller never observes a meme activated whose owner was not
  credited, or vice versa.
- **Unowned memes (FR-012)**: every action on a meme with `user_id = null` succeeds with its
  normal status code and adjusts no rating. It MUST NOT error.
- **Saturation (FR-011a)**: an adjustment that would push the rating past ±32767 is silently
  dropped and **the moderation action still returns its normal success status**. Saturation is
  never surfaced as an error to the caller.
- **No write path (FR-003)**: no endpoint in this or any other contract accepts a rating value.
  There is no `PATCH /api/admin/users/{hash}` and none is added. A rating cannot be set, only
  moved by the events above.

## 4. Surfaces explicitly NOT changed

Stated so the absence is testable rather than accidental:

| Surface | Assertion |
|---------|-----------|
| `GET /api/posts` (public feed) | No `rating` field on any entry (FR-022). |
| `GET /api/posts/{hash}` | No `rating` field (FR-022). |
| `GET /api/user` | No `rating` field — an account cannot read its own rating either. |
| `POST /api/register` | Accepts no `rating`; new accounts start at 0 (FR-001). |
| Any endpoint | No request body field named `rating` is honoured anywhere (FR-003). |
