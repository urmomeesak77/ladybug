# Research: Admin Action Menus

**Feature**: 013-admin-action-menus | **Date**: 2026-07-21

The spec is unusually well-constrained (one clarification already resolved, no
open `NEEDS CLARIFICATION`). Research therefore fixes the concrete design choices
that keep this feature almost entirely *reuse* plus one small new endpoint.

## D1 — Kebab menu is built in-house, no dependency

**Decision**: Implement the "more actions" control as a lightweight React
component (`components/admin/ActionMenu.tsx`) following the WAI-ARIA *menu button*
pattern: a `<button aria-haspopup="menu" aria-expanded={open}>` toggling a
`role="menu"` container of `role="menuitem"` buttons. No dropdown/menu/popover
library is added.

**Rationale**: Principle I (Minimal Dependencies, NON-NEGOTIABLE) makes a library
the wrong default for a control this small. The whole surface is one button, a
list, a keydown handler, and a dismiss handler — well under the in-house threshold.
The prototype had no equivalent to copy, so this is greenfield but tiny.

**Alternatives considered**:
- *Native `<details>`/`<summary>`* — free open/close and outside semantics, but it
  does not give menu/menuitem ARIA roles or roving arrow-key navigation, and
  styling the marker cross-browser is fiddly. Rejected: fails FR-005's "announces
  it opens a menu" cleanly.
- *A headless menu library (e.g. downshift/radix)* — solves accessibility for us
  but violates Principle I for a control we can write in ~40 lines.

## D2 — Menu accessibility & dismissal (US3, FR-003/FR-004/FR-005)

**Decision**:
- The trigger button carries `aria-haspopup="menu"`, `aria-expanded`, and a text
  `aria-label` ("More actions for <name>"). Items are real `<button role="menuitem">`
  with a text label (icon is `aria-hidden`).
- **Open**: click or `Enter`/`Space`/`ArrowDown` on the trigger; focus moves to the
  first item.
- **Keyboard within**: `ArrowUp`/`ArrowDown` move roving focus between items; `Enter`/
  `Space` activate; `Escape` closes and returns focus to the trigger.
- **Dismiss** (FR-004): closing on (a) item chosen, (b) `Escape`, (c) pointer-down
  outside the menu root, and (d) focus leaving the menu root (`focusout` whose
  `relatedTarget` is outside). Choosing nothing takes no action.

**Rationale**: This is the smallest set that satisfies every US3 acceptance
scenario and FR-003–FR-005. Returning focus to the trigger on Escape keeps keyboard
users oriented. Colour is never the sole signal — the destructive item always
carries its text label (FR-002).

**Alternatives considered**: relying only on outside-click (no focusout) — rejected
because a keyboard user tabbing out would leave an orphaned open menu, failing US3
scenario 2.

## D3 — Permanent account deletion is a hard `DELETE`, mirroring meme purge

**Decision**: Add `DELETE /api/admin/users/{hash}` →
`UserAdminController::destroy` → `UserAdminService::destroy(User $actor, string $hash): void`.
The service loads the target `lockForUpdate` inside a transaction, applies the
strict-rank guard, then `$target->delete()` (User has no `SoftDeletes`, so this is a
true hard delete — no tombstone, FR-020). Responds `204` with no body, exactly like
`ModerationController::purge`.

**Rationale**: The existing purge endpoint is the established shape for an
irreversible, body-less admin destroy, so the account delete matches it for
consistency (SC-002's "no more than three interactions" and the SPA's in-place row
removal both fall out of this). `204` keeps the client logic identical to the meme
purge path (`{ ok: response.ok }`).

**Alternatives considered**: soft-deleting the User (add `SoftDeletes`) — rejected;
the clarification explicitly says "hard-deleted with nothing retained", and adding a
`deleted_at` to users would be an unused, spec-contradicting column.

## D4 — Orphaning memes & clearing the disabling actor is already free (FR-010/FR-011)

**Decision**: Rely on the existing foreign-key constraints; add **no** cascade code.
- `trashposts.user_id` → `constrained('users')->nullOnDelete()`
  (`2026_06_08_000000_create_trashposts_table.php`): deleting the owner sets the
  meme's `user_id` to null. The meme row, its media files, and its activation state
  are untouched — it simply becomes owner-less (FR-010, SC-004).
- `users.disabled_by` → `constrained('users')->nullOnDelete()`
  (`2026_07_20_000002_add_disabled_to_users_table.php`): any account the deleted
  admin had disabled keeps its `disabled_at` but loses the actor name (FR-011).

**Rationale**: The database already models exactly the "orphan, don't cascade"
semantics the spec wants. Writing application-level nulling would duplicate — and
risk diverging from — a constraint that already fires atomically inside the same
delete.

**Alternatives considered**: manually nulling `user_id`/`disabled_by` in the service
before delete — rejected as redundant and a Principle II smell (extra code for
behaviour the schema guarantees).

## D5 — Orphaned memes stay fully moderatable (rating side-effect check)

**Decision**: No change to `RatingService`. Its `adjust(?int $userId, …)` already
returns early when `user_id` is null, and `settle()` books the per-meme flag
regardless of owner. So a later activate/deactivate/delete/restore/purge of an
orphaned meme succeeds and simply charges nobody.

**Rationale**: Verified against `RatingService.php`: the null-owner path is an
intended, tested `FR-012` no-op (the `no account` rating already renders in the
moderation table). Account deletion therefore introduces no rating drift and needs
no settlement — the owner's `rating` column vanishes with the account, consistent
with "no trace" (FR-020).

## D6 — Permission is re-checked at action time (FR-009, edge: rank changes)

**Decision**: The strict-rank guard runs *inside* `destroy`'s transaction, against
the freshly `lockForUpdate`-loaded target's **current stored** role —
`$actor->role->outranks($target->role)` → `abort(403)` on failure. This is the
identical guard `disable`/`enable` already use, so peer, higher-rank, and self are
all refused by the one strict comparison (a role never outranks itself).

**Rationale**: The menu is drawn from a possibly-stale client render; the server is
the sole authority (Principle VI). Re-checking on the locked row closes the
"target was promoted after the menu opened" edge case and the concurrent-action
edge case at once.

**Alternatives considered**: trusting a `can_delete` field in the row payload —
rejected; it would be an authorization oracle and could be tampered client-side, and
012 deliberately added no such field for the same reason.

## D7 — Confirmation reuses the existing ConfirmDialog / useNotice.ask (FR-008)

**Decision**: The Delete-permanently menu item calls the existing
`useNotice().ask({ … })` with a single `strong` action captioned "Delete
permanently" plus the always-present Cancel, and a message that **names the target
account**. No new confirmation surface is built. A new `UserAdminModel`
copy helper (e.g. `deleteConfirmMessage(name)`) supplies the wording, mirroring
`ModerationModel.purgeConfirmMessage`.

**Rationale**: `ConfirmDialog` is already the app's blocking, Esc-dismissible,
strong-emphasis confirm used by moderation purge — reusing it satisfies FR-008 and
the spec's "existing confirmation mechanism" assumption with zero new UI.

## D8 — Client-side row removal & concurrent-delete handling (FR-013, FR-012)

**Decision**: On a `204`, the SPA drops the row in place via a new
`useUserAdmin.removeRow(hash)` (mirroring `useModeration.removeRow`) backed by a new
`UserAdminModel.dropRow`. `UserAdminApi.destroy` returns `{ ok: response.ok }` like
the meme purge client. A failed delete (including a `404` from a row another admin
already deleted) leaves the row exactly as it was; the list self-corrects on the
next page load / refresh.

**Rationale**: This reuses the 010 purge UX pattern verbatim, so both consoles feel
identical (US2 goal) and the admin never leaves the current page (FR-013). Treating
any non-2xx as "leave the row" gives clean concurrent-delete behaviour without
special-casing 404.

## D9 — One shared menu, two call sites

**Decision**: `ActionMenu` is generic: it takes a list of items
(`{ label, icon?, danger?, onChoose }`) and renders the button + menu; it owns *only*
open/close/keyboard/dismiss state, never what an item does. `UserActions` and
`ModerationActions` each build their own item list (including firing confirms) and
pass it in. When a row's item list is empty, the caller renders the existing "No
permission" text and **no menu button** (FR-006).

**Rationale**: Keeps the accessible behaviour in one place (US3 tested once), and
leaves each console's action semantics where they already live. Matches the existing
split where `AdminPagination` is shared but each page owns its data.
