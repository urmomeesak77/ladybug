# Design — Authorized visibility for the single-post page

**Date:** 2026-07-21
**Status:** Approved (pending spec review)

## Problem

The single-post endpoint `GET /api/posts/{hash}` (→ `TrashpostsApiController::show`
→ `TrashpostService::findVisibleByHash`) returns a post only when it is **activated
and not soft-deleted**; every other state resolves to a 404. This means:

- An **admin** cannot open the permalink of a meme they just deactivated or
  soft-deleted to look at it — they get a 404, even though the moderation console
  lists it and the media still lives on the `public` disk.
- A **member** who uploads a meme that is created **pending** (below
  `TRUST_THRESHOLD`) cannot view their own upload at its permalink until a
  moderator activates it — they get a 404 for their own content.

## Goal

Give elevated viewers access to the single-post page for hidden posts, without
changing the public feed and without leaking internal moderation timing:

- **admin+** (role rank ≥ `Role::Admin`): may view a post in **any** state —
  pending, deactivated, or soft-deleted.
- **owner** (the uploader): may view **their own** post in any activation state,
  **but not** when it is soft-deleted (matches "visible if it's not deleted").
- **everyone else** (guests, other members): unchanged — a non-public post is a 404.

The single-post page additionally shows the elevated viewer a banner indicating the
post is not publicly visible, distinguishing *pending/deactivated* from *deleted*.

Out of scope: the feed (`GET /api/posts`, `TrashpostService::feed`) is unchanged;
only the single-post `show` path gains elevated visibility.

## States

A `Trashpost` carries two independent signals:

- **activation** — `activated_at` (`null` = pending or deactivated; non-null = active).
- **soft-delete** — `deleted_at` via `SoftDeletes` (`trashed()`).

"Publicly visible" = `activated_at != null` **and** not `trashed()`. Anything else is
hidden from the public.

## Backend

### Service — `TrashpostService`

Replace `findVisibleByHash(string $hash): ?Trashpost` with:

```php
public function findViewableByHash(string $hash, ?User $viewer): ?Trashpost
```

Logic:

1. Load the row `withTrashed()` by `hash` (so soft-deleted rows are reachable), or
   return `null` when no row matches.
2. If the post is **public** (`activated_at !== null && ! trashed()`) → return it.
3. Else if `$viewer !== null` and `$viewer->role->rank() >= Role::Admin->rank()`
   → return it (admins see every state).
4. Else if `$viewer !== null`, `$post->user_id === $viewer->id`, and
   `! $post->trashed()` → return it (owner sees own non-deleted post).
5. Else → return `null`.

Rationale for the ordering: the public check first means guests and other members
keep exactly today's behavior with no role lookup; the admin check precedes the
owner check so an admin viewing their own soft-deleted post still succeeds.

`findVisibleByHash` is removed (only `show` consumed it; the feed uses the private
`visible()` builder directly, which is unchanged).

### Controller — `TrashpostsApiController::show`

```php
public function show(Request $request, string $hash): TrashpostResource
{
    $post = $this->service->findViewableByHash($hash, $request->user());
    if ($post === null) {
        abort(404);
    }
    return new TrashpostResource($post);
}
```

The route stays public (no `auth:sanctum`). `$request->user()` resolves from the
Sanctum SPA session when present and is `null` for a guest — the same
session-aware, no-middleware pattern `AuthController::user` and the `/api/user`
route already rely on.

### Resource — `TrashpostResource`

Add one computed field:

```php
'hidden' => $this->hiddenStatus(),
```

where `hiddenStatus()` returns:

- `'deleted'` when `trashed()`,
- else `'pending'` when `activated_at === null`,
- else `null`.

`'deleted'` takes precedence so a post that is both deactivated and soft-deleted
reads as `'deleted'`.

This is a **coarse status only** — no `deleted_at` timestamp is exposed, preserving
the resource's existing "no internal moderation timing" contract. On the public feed
every row is public, so `hidden` is always `null` there; a non-null value can only
reach an admin/owner through the authorization-gated `show` path.

## Frontend

### Model — `feedModel.ts`

- Add `hidden: 'pending' | 'deleted' | null` to `RawPost`.
- Add `hidden: 'pending' | 'deleted' | null` to `FeedPost`.
- `mapPost` passes it through: `hidden: raw.hidden ?? null`.

Feed items therefore carry `hidden: null`; only a `show` response for a hidden post
carries a non-null value.

### Component — `components/states/HiddenNotice.tsx`

A small presentational component:

```tsx
function HiddenNotice({ status }: { status: 'pending' | 'deleted' }) { … }
```

- `role="status"` banner (text is the primary signal; color is never the sole
  signal — Principle IV).
- `'pending'` → "This meme is pending review and isn't publicly visible yet."
- `'deleted'` → "This meme has been deleted and isn't publicly visible."

### Page — `PostPage`

Render `{state.post.hidden && <HiddenNotice status={state.post.hidden} />}` above
the `<h1>` title inside the loaded `<article>`. When `hidden` is `null` (the public
case) nothing renders and the page is unchanged.

## Testing (≥90 % line coverage, mirrored paths)

**Backend**

- `TrashpostServiceTest` — `findViewableByHash` matrix:
  - public post → returned for guest, member, owner, admin.
  - pending post → returned for admin and for its owner; `null` for a guest and for
    a non-owner member.
  - deactivated post → same as pending.
  - soft-deleted post → returned for admin; `null` for its owner, a non-owner
    member, and a guest.
  - unknown hash → `null`.
- `TrashpostsApiControllerTest` (`show`):
  - public → 200 (unchanged).
  - admin viewing pending / deactivated / soft-deleted → 200.
  - owner viewing own pending → 200.
  - owner viewing own soft-deleted → 404.
  - non-owner member viewing pending → 404.
  - guest viewing pending → 404.
  - unknown hash → 404.
- `TrashpostResourceTest` (or via controller assertions) — `hidden` is `null` for a
  public post, `'pending'` for a deactivated/pending post, `'deleted'` for a
  soft-deleted post (deleted wins when both).

**Frontend**

- `feedModel` — `mapPost` sets `hidden` from `raw.hidden`, defaulting to `null` when
  absent.
- `HiddenNotice` — renders the correct text per status and has `role="status"`.
- `PostPage` — renders the banner when the loaded post has `hidden` set; renders no
  banner when `hidden` is `null`.

## Follow-up (not in this change)

`feedModel.ts` `IMAGE_SIZES` still reads `'(min-width: 48rem) 48rem, 100vw'`, stale
after `--layout-max-width` moved to `80rem`. Track separately.
