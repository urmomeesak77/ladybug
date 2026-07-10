# Quickstart & Validation: Admin Meme Moderation Table

Validation guide for the moderation console. Backend runs through the `php:8.3-cli` Docker
container (no local PHP); tests use sqlite `:memory:` and never hit the network or the real
DB. See [plan.md](./plan.md), [data-model.md](./data-model.md), and
[contracts/admin-moderation-api.md](./contracts/admin-moderation-api.md) for details.

## Prerequisites

- The dev stack is up (`docker compose up`), or at least the backend container is available
  for artisan/PHPUnit.
- At least one **admin** or **superuser** account exists. Promote one with the existing
  command:

  ```powershell
  docker compose exec backend php artisan app:make-superuser <email>
  ```

- Some memes exist across states (activated, not-activated, soft-deleted; image + YouTube).
  Use `app:seed-media` / the upload flow, then soft-delete/deactivate a couple via tinker or
  the UI itself.

## Apply the migration

```powershell
docker compose exec backend php artisan migrate
```

Confirms `trashposts.youtube_thumbnail` (nullable string) is added. Reversible via
`migrate:rollback`.

## Automated tests (the real gates)

```powershell
# Backend: PHPUnit + coverage (sqlite :memory:, Http::fake for the thumbnail fetch)
docker compose exec backend php artisan test
docker compose exec backend vendor/bin/pint --test

# Frontend: ESLint + Vitest (coverage spans all of src/)
cd frontend; npm run lint; npm run test
```

Both stacks must stay **≥90%** line coverage (Principle VII).

## Manual validation scenarios

### US2 — Access control (do this first; it is the security gate)

1. **Guest**: while logged out, request `GET /api/admin/posts` → **401**; visit `/admin/memes`
   → redirected away, no table.
2. **Member**: sign in as a member → `GET /api/admin/posts` → **403**; `/admin/memes` blocked;
   the LeftMenu shows **no** Moderation link.
3. **Admin/Superuser**: sign in → the LeftMenu shows the **Moderation** link; `/admin/memes`
   loads the table; `GET /api/admin/posts` → **200**.

### US1 — Browse the table

4. Open `/admin/memes`. Expect a table ordered **newest-first**, up to **100** rows, with
   columns: thumbnail, user, created, activated, deleted, actions.
5. With >100 memes, click page-link **2** → URL becomes `/admin/memes?page=2` and shows the
   next 100. **Refresh** and **Back/Forward** restore the exact page (FR-005).
6. A meme whose `user_id` resolves shows the **account name**; one without shows the row's
   stored **uploader name** (FR-012).
7. Click a row (not a button) → the meme's page `/posts/{hash}` opens (FR-018).
8. **Empty state**: with no memes (or a page beyond the last), an explicit "no entries"
   message shows — not a blank table or error (FR-019, edge cases).

### Thumbnails (SC-003, SC-004)

9. Image rows show the `100`-size variant clipped to ≤100×75. A meme missing its `100`
   variant shows a **placeholder**, not a broken image.
10. A YouTube row shows a thumbnail. Check the DB: its `youtube_thumbnail` is now set, and the
    file exists under `…/ladybug-storage/image/trash/youtube/…`. Reload the page and confirm
    **no repeat download** (the stored path is reused).
11. Simulate a failed fetch (invalid id / offline) → placeholder, and the rest of the table
    still renders (FR-011).

### US3 — Activation toggle (stay on page)

12. On page N, use **Activate** on a not-activated meme → row shows **activated**, still on
    page N. Use **Deactivate** → row returns to not-activated (FR-016, FR-017). Each row shows
    exactly the applicable control for its state.

### US4 — Soft delete / restore (stay on page)

13. Use **Delete** on a non-deleted meme → a **blocking modal confirmation** appears
    ("Delete post?"; the page behind it is inert); **Confirm delete** →
    row shows **deleted**, still on page N. Verify the meme is **absent** from the public feed
    and its `/posts/{hash}` public view (soft-deleted, retained). Use **Restore** → row
    returns to not-deleted and it reappears publicly.
14. Activate/Deactivate and Restore apply on a **single click** (no confirmation); only Delete
    confirms (FR-016).

### Theming, a11y, responsive (SC-008, Principle IV/VIII)

15. Toggle OS light/dark → the table follows `prefers-color-scheme`. Activated/Deleted are
    legible **without relying on color** (text/icon labels).
16. Narrow to a phone width → the page does **not** scroll horizontally (the table scrolls
    inside its own container); action buttons keep adequate touch targets.

## Expected outcomes (success criteria)

- SC-002: 100% of guest/member access attempts refused; 100% of admin/superuser allowed.
- SC-004: each YouTube thumbnail fetched from the remote source **at most once**.
- SC-005: activate/deactivate/delete/restore update the row **without losing the page**.
- SC-006/SC-007: every row link opens the right meme page; page URLs are bookmarkable and
  refresh-safe.
