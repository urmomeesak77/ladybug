# Quickstart: Admin Action Menus

**Feature**: 013-admin-action-menus | **Date**: 2026-07-21

Validation guide proving both consoles work through the new shared menu and that
permanent account deletion is safe, guarded, and orphan-preserving. See
[contracts/admin-user-delete-api.md](./contracts/admin-user-delete-api.md) for the
endpoint contract and [data-model.md](./data-model.md) for the invariants.

## Prerequisites

- Docker stack up (`docker compose up -d`), frontend + backend served.
- A **superuser** (bootstrap: `make:superuser`) and at least one **admin** and a
  couple of **member** accounts. One member should own ≥ 1 activated meme.
- Backend tests run through the `php:8.3-cli` container on sqlite `:memory:` — never
  the real DB (project convention).

## Automated checks (must pass — Principle VII, ≥90 %)

```bash
# Backend — service + controller delete cases
docker compose run --rm backend php artisan test --filter=UserAdmin

# Backend — full suite + coverage gate
docker compose run --rm backend php artisan test --coverage

# Frontend — menu, refactored actions, API client, model, hook
cd frontend && npm run test

# Frontend — lint
cd frontend && npm run lint

# E2E — the delete-with-confirm slice
cd frontend && npx playwright test admin-action-menus
```

## Scenario 1 — Account delete, happy path (US1, SC-002)

1. Sign in as the superuser; open `/admin/users`.
2. On a member row, activate the kebab **More actions** button.
   → A menu opens offering **Disable** (or Enable) and **Delete permanently**.
3. Choose **Delete permanently**.
   → A blocking confirm names that account; nothing is deleted yet.
4. Confirm.
   → `DELETE /api/admin/users/{hash}` returns `204`; the row vanishes in place; you
   stay on the same page (no navigation). **Three interactions total** (SC-002).

## Scenario 2 — Memes survive as owner-less (US1 AS-5, SC-004)

1. Before deleting, note a meme owned by the target member on `/admin/trashposts`.
2. Delete that member (Scenario 1).
3. Reload `/admin/trashposts`.
   → The meme still exists, still in its prior state, now showing **"no account"**
   for its owner/rating. No meme was removed.

## Scenario 3 — Permission is refused and re-checked (US1 AS-4, SC-003, FR-009)

1. As an **admin**, open the menu on:
   - your **own** row → no menu button, "No permission" text;
   - a **peer** admin → same;
   - the **superuser** (higher rank) → same.
2. Direct-call guard: `DELETE /api/admin/users/{peerHash}` → `403`, account intact.
3. Rank-change edge: open the menu on a member, then (in another session) promote
   that member to admin; confirm the delete → `403` (re-checked on the locked row),
   account intact.

## Scenario 4 — Concurrent / already-deleted (FR-012, INV-4)

1. Two admins view the same member row. Admin A deletes it (`204`).
2. Admin B confirms delete on the now-stale row → `404`; nothing else changes;
   B's list corrects on refresh.

## Scenario 5 — Moderation menu is behaviour-identical (US2, SC-001)

1. Open `/admin/trashposts`; open a **live** meme's menu.
   → Activate/Deactivate, Soft delete, Delete permanently — each with icon + label.
   Every action and its confirm behaves exactly as before this feature.
2. Open a **soft-deleted** meme's menu → Restore and Delete permanently only.
3. Confirm activate/deactivate/restore refresh the row in place; permanent delete
   drops it — identical to pre-feature outcomes.

## Scenario 6 — Accessibility & dismissal (US3, SC-005/SC-006)

1. **Keyboard only**: Tab to a row's menu button; open with Enter; arrow through
   items; activate one — all without a mouse.
2. Open a menu and dismiss it three ways: **Escape** (focus returns to the button),
   **click outside**, and **Tab focus away** — each closes it with no action taken.
3. With a screen reader, confirm the button announces it opens a menu and its
   open/closed state, and each item exposes a text label.
4. Open and close menus repeatedly: the page **URL never changes** and
   Back/Forward/Refresh restore the same page (SC-006).

## Manual verification (Constitution gate)

- **Responsive** (Principle VIII): the menu button and its items keep adequate touch
  targets and reflow within the admin tables at mobile / tablet / desktop widths; no
  horizontal scroll.
- **Theme** (Principle IV): the menu and its destructive item render correctly in
  light and dark; the destructive emphasis is never the *only* signal — the label
  always says "Delete permanently".
