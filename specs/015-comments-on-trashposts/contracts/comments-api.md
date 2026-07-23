# Contract: Public Comments API (read + create)

Nested under a trashpost, addressed by the post's public `hash`. Routes in `routes/api.php`.
Cookie-session (Sanctum SPA) where authentication applies.

```
GET  /api/posts/{hash}/comments            # public, viewer-aware
POST /api/posts/{hash}/comments            # auth:sanctum + verified + throttle:comments
```

`{hash}` is the trashpost's 10-char public code. An unknown/hidden post that the viewer may
not see resolves to **404** (same viewer-aware rule as `GET /api/posts/{hash}`), so the
comment section of a non-public post is unreachable through public views (spec edge cases).

---

## GET /api/posts/{hash}/comments

Return one newest-first batch of the post's comments plus the public count and a cursor for
older comments.

### Query parameters

| Param    | Type   | Default | Meaning |
|----------|--------|---------|---------|
| `before` | string | —       | Opaque keyset cursor from a previous response's `meta.next_cursor`. Omit for the newest batch. |

Batch size is fixed at **10** (FR-019); `limit` is not a client parameter.

### Viewer-awareness

- **Guest / member**: only comments with `hidden_at IS NULL` are returned.
- **Admin+**: hidden comments are also returned, each with `hidden: true`.

Determined from `$request->user()` and `Role::rank` — the route is public; the session, when
present, elevates what is returned (same pattern as `TrashpostsApiController::show`).

### 200 response

```json
{
  "data": [
    {
      "hash": "Ab3-xY9_q2",
      "body": "first line\nsecond line",
      "username": "alice",
      "hidden": false,
      "created_at": "2026-07-23T10:15:00.000000Z"
    }
  ],
  "meta": {
    "total": 42,
    "next_cursor": "eyJjIjoiMjAyNi0wNy0yM1QxMDoxNTowMFoiLCJpZCI6MTAxfQ==",
    "has_more": true
  }
}
```

- `data` — up to 10 rows, `created_at DESC, id DESC`.
- `hidden` — always `false` for guests/members (they never receive hidden rows); may be
  `true` for an admin viewer (FR-011: marked as hidden by more than color on the client).
- `meta.total` — the **public** comment count (`hidden_at IS NULL`), regardless of viewer
  (FR-015, D7). Drives the count shown on the post page (US1 scenario 4).
- `meta.next_cursor` — pass as `before` to fetch the next 10 older comments; `null` when
  none remain.
- `meta.has_more` — `false` on the last batch (drives hiding the "load more" control).

Fields deliberately omitted: DB `id`, `trashpost_id`, `user_id`, `hidden_at`, `updated_at`
(internal bookkeeping; the `hash` is the public handle, Principle V).

### Empty state

A post with no publicly visible comments returns `data: []`, `meta.total: 0`,
`next_cursor: null`, `has_more: false`. The client renders the "no comments yet" state
(FR-016).

---

## POST /api/posts/{hash}/comments

Create a comment on the post. **Middleware**: `auth:sanctum` (guest → 401), `verified`
(unverified → 403), `throttle:comments` (429 over cap). The gate is enforced here at the
data layer, not just in the UI (FR-004, SC-002).

### Request body

```json
{ "body": "Nice meme!" }
```

### Validation (`CreateCommentRequest`)

| Field  | Rule                                             | On failure |
|--------|--------------------------------------------------|------------|
| `body` | trimmed, `required`, `string`, `max:1000`         | 422 with field error (FR-007 empty/whitespace, FR-008 over-length). |

### 201 response

The created comment as a single `CommentResource` (attributed to the caller, `hidden: false`):

```json
{
  "data": {
    "hash": "Zk8_La2-p0",
    "body": "Nice meme!",
    "username": "alice",
    "hidden": false,
    "created_at": "2026-07-23T11:02:00.000000Z"
  }
}
```

The client prepends this row to the top of the list in place, without a reload (FR-006,
SC-001), and increments the visible count.

### Error responses

| Status | When |
|--------|------|
| 401    | No authenticated session (guest). No comment created (FR-004). |
| 403    | Authenticated but e-mail not verified. No comment created (FR-004). |
| 404    | `{hash}` is unknown or not viewable by the caller (FR-017). No comment created. |
| 422    | Body empty/whitespace-only or > 1000 chars (FR-007, FR-008). |
| 429    | Over the per-user comment rate limit. |

CSRF: the SPA sends `X-XSRF-TOKEN` (via `Csrf.ensure()`) on this mutation, like every other
unsafe SPA call.
