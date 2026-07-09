# Contract: Admin Moderation API

All routes live under `/api/admin/posts` and are registered behind
**`auth:sanctum` + `role:admin`** (admin or higher). The Sanctum SPA cookie-session
authenticates; `role:admin` authorizes. Unsafe methods require the `X-XSRF-TOKEN` header
(Sanctum SPA CSRF), exactly like the existing auth mutations.

## Access control (applies to every route)

| Caller | Result |
|--------|--------|
| Unauthenticated (guest) | **401 Unauthenticated** (from `auth:sanctum`). |
| Authenticated **member** | **403 Forbidden** (from `role:admin`). |
| Authenticated **admin** or **superuser** | Allowed. |

The gate protects the **data**, not merely the page — the SPA route guard is a UX mirror
only (FR-002, Principle VI).

---

## GET `/api/admin/posts` — moderation index

Newest-first, 100 per page, **all states** (activated or not, deleted or not).

**Query params**
- `page` (int, optional, default 1) — 1-based page number. Out-of-range (beyond last page)
  returns `200` with empty `data` and valid `meta` (not an error).

**200 OK**

```json
{
  "data": [
    {
      "hash": "Ab3-_9xQ12",
      "thumbnail": "http://localhost/storage/image/trash/100/a/ab3-_9xq12.jpg",
      "type": "youtube",
      "username": "alice",
      "created_at": "2026-07-08T20:14:02.000000Z",
      "activated": true,
      "deleted": false,
      "url": "/posts/Ab3-_9xQ12"
    }
  ],
  "links": { "first": "…", "last": "…", "prev": null, "next": "…" },
  "meta": { "current_page": 1, "last_page": 7, "per_page": 100, "total": 663 }
}
```

- `thumbnail` is `null` when no usable image can be produced (missing `100` variant, failed
  or unavailable YouTube fetch, non-media) → the client renders a placeholder (FR-011).
- For a YouTube meme with no stored thumbnail yet, the server performs the one-time
  synchronous fetch during this request and, on success, `thumbnail` is the newly stored URL
  and `trashposts.youtube_thumbnail` is now set (FR-010, SC-004).

**Ordering**: `created_at DESC, id DESC`. **Empty corpus**: `data: []`, `total: 0`.

---

## POST `/api/admin/posts/{hash}/activate` — activate

Sets `activated_at = now()` if not already activated (idempotent).

- **200 OK** → the updated row object (same shape as one `data` element above), so the client
  updates the row in place and stays on its page (FR-017).
- **404** when no meme (including soft-deleted) has that `hash`.

## POST `/api/admin/posts/{hash}/deactivate` — deactivate

Sets `activated_at = null` (idempotent). **200** updated row / **404**.

## DELETE `/api/admin/posts/{hash}` — soft delete

Soft-deletes the meme (`deleted_at = now()`, row + media retained; disappears from public
views). Idempotent. **200** updated row (`deleted: true`) / **404**. Requires the client's
lightweight confirmation *before* it is sent (FR-016) — enforced UI-side; the endpoint itself
just applies.

## POST `/api/admin/posts/{hash}/restore` — restore

Clears `deleted_at` (idempotent). **200** updated row (`deleted: false`) / **404**.

---

## Lookup semantics for actions

Action handlers resolve the target with `Trashpost::withTrashed()->where('hash', $hash)` so a
**soft-deleted** meme is still found (to Restore, or to re-activate). A missing hash → 404.
Concurrent actions from two admins converge on the same final state without error (each write
is a set-to-target, not a toggle-relative-to-read).

## Route registration (backend)

```php
// routes/api.php
Route::middleware(['auth:sanctum', 'role:admin'])->prefix('admin')->group(function () {
    Route::get('/posts', [ModerationController::class, 'index'])->name('api.admin.posts.index');
    Route::post('/posts/{hash}/activate', [ModerationController::class, 'activate'])->name('api.admin.posts.activate');
    Route::post('/posts/{hash}/deactivate', [ModerationController::class, 'deactivate'])->name('api.admin.posts.deactivate');
    Route::delete('/posts/{hash}', [ModerationController::class, 'destroy'])->name('api.admin.posts.destroy');
    Route::post('/posts/{hash}/restore', [ModerationController::class, 'restore'])->name('api.admin.posts.restore');
});
```

`bootstrap/app.php` aliases the gate: `$middleware->alias(['role' => EnsureRole::class]);`
