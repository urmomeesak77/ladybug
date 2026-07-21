# Data Model: Admin Action Menus

**Feature**: 013-admin-action-menus | **Date**: 2026-07-21

This feature adds **no columns, no tables, and no migration**. Permanent account
deletion removes an existing row; the surrounding referential behaviour is already
enforced by constraints shipped in earlier features. What follows documents the
entities the feature touches and the invariants deletion must preserve.

## Entities

### Account (`users` row) — hard-deleted

The registered user, addressed publicly by its 10-char `hash`. Permanent deletion
**removes the row entirely** (no `SoftDeletes` on `User`, no tombstone, no audit
row — FR-020). Fields relevant here (all pre-existing):

| Field | Role in this feature |
|---|---|
| `hash` | The only handle the delete endpoint accepts (FR-018). |
| `role` | Read for the strict-rank guard; the target's **current stored** role decides permission (FR-009). |
| `rating` | Belongs to the account; disappears with it. Needs no settlement on delete (D5). |
| `disabled_at` / `disabled_by` | If this account had disabled others, those rows' `disabled_by` clears via FK (see below). |

### Meme (`trashposts` row) — orphaned, never deleted

An uploaded entry addressed by its `hash`, with lifecycle columns `activated_at` /
`deleted_at`. **Unchanged by this feature** except that its `user_id` may become
`null` when its uploader is deleted, after which it renders as owner-less
("no account" rating) and remains fully moderatable (D5).

### Actions menu — transient UI only

A per-row control listing the actions valid for that row given the viewer's
permissions and the row's state. **Not persisted**; carries no shareable state
(FR-019). Modelled on the frontend as a plain list of items passed to the shared
`ActionMenu` component (label, optional icon, optional destructive emphasis,
`onChoose`).

## Referential behaviour on account deletion (already enforced)

Both constraints are **`nullOnDelete`** and already exist — the delete relies on
them rather than re-implementing them:

| Constraint | Migration | Effect on account delete |
|---|---|---|
| `trashposts.user_id → users.id` `nullOnDelete` | `2026_06_08_000000_create_trashposts_table.php` | Every meme the account uploaded is orphaned (`user_id = null`); no meme row or media file is removed (FR-010, SC-004). |
| `users.disabled_by → users.id` `nullOnDelete` | `2026_07_20_000002_add_disabled_to_users_table.php` | Every account the deleted admin had disabled keeps `disabled_at` but loses the actor name (FR-011). |

## Invariants

- **INV-1 (hard delete, no trace)**: After a successful delete, no `users` row, no
  tombstone, and no audit record references the deleted account (FR-020).
- **INV-2 (orphan, don't cascade)**: The count and state of `trashposts` rows is
  unchanged by an account deletion; only their `user_id` may transition to null
  (FR-010).
- **INV-3 (strict-rank authority)**: A delete succeeds only when the actor's stored
  role *strictly outranks* the target's, evaluated on the locked row at action time.
  Peer, higher rank, and self are refused with `403`, leaving the row untouched
  (FR-009). Identical to the guard `disable`/`enable` already apply.
- **INV-4 (idempotent-ish under concurrency)**: Deleting a hash that no longer
  exists is a clean `404` that changes nothing else (FR-012); the second admin's
  view corrects on its next refresh.
- **INV-5 (rating neutrality)**: An account deletion performs no rating adjustment;
  the deleted account's `rating` is gone and its orphaned memes charge nobody on
  subsequent moderation (D5).
