# Contract: Permanent Account Deletion API

**Feature**: 013-admin-action-menus | **Date**: 2026-07-21

One new endpoint, mounted inside the existing `auth:sanctum` + `role:admin` group in
`routes/api.php` alongside the 012 disable/enable routes. It is the **only** new
server surface this feature adds — the menu reshaping (US1 Enable/Disable, US2
moderation actions) reuses the already-shipped 010/012 endpoints unchanged.

Authentication is the Sanctum SPA cookie session; the unsafe `DELETE` carries the
`X-XSRF-TOKEN` header like every other SPA mutation.

## Shared access boundary

Identical to the 012 admin-users endpoints — the boundary protects the **data**,
not just the SPA page:

| Caller | Response |
|---|---|
| Guest (no session) | `401` |
| Member | `403` |
| Admin, Superuser | proceeds (subject to the per-target strict-rank rule below) |
| Any caller whose account is disabled | `401` + session invalidated (`EnsureAccountEnabled`) |

---

## `DELETE /api/admin/users/{hash}`

Permanently and irreversibly delete the target account. `{hash}` is the account's
10-char public handle (FR-018); a database id is never accepted.

**Request body**: none. The acting account is taken from the session, never from the
body.

**204 No Content** — success. The account row is gone; the response carries no body,
exactly like the meme purge endpoint. The SPA drops the row from the current page in
place (FR-013).

**Errors**

| Status | When |
|---|---|
| `403` | The actor's role does not **strictly** outrank the target's — a peer, a higher rank, or the actor's own account. The target is left unchanged (FR-009). |
| `404` | No account carries that hash (e.g. already deleted by another admin — FR-012). Nothing else is affected. |

**Semantics**

- **Hard delete, no trace** (FR-020): the `users` row is removed with `delete()`
  (User has no `SoftDeletes`), leaving no tombstone and writing no audit record.
- **Strict-rank re-check at action time** (FR-009): the guard runs inside the
  transaction against the freshly `lockForUpdate`-loaded target's current stored
  role — never against a client value or a stale menu render. A role never outranks
  itself, so peer/higher/self are refused by the single comparison.
- **Memes orphaned, not deleted** (FR-010): the account's uploaded memes remain;
  their `user_id` transitions to null via the existing `nullOnDelete` FK. No meme
  row or media file is touched. They subsequently render as owner-less.
- **Disabled-by cleared** (FR-011): any account this admin had disabled keeps its
  `disabled_at` and loses only the actor name, via the `disabled_by` `nullOnDelete`
  FK.
- **No rating adjustment** (D5): deleting the account changes no other account's
  rating; orphaned memes charge nobody on later moderation.

---

## Frontend contract

| Concern | Contract |
|---|---|
| Menu control | Each actionable row shows a single kebab "more actions" button (`aria-haspopup="menu"`, `aria-expanded`) opening a `role="menu"` of `role="menuitem"` items, each with a text label and optional icon (FR-001, FR-002, FR-005). |
| Menu items — accounts | For a target the admin strictly outranks: **Enable** or **Disable** (per current state, unchanged behaviour) and **Delete permanently** (destructive emphasis, text label always present). |
| Menu items — moderation | The existing state-dependent set, unchanged: a live meme → Activate/Deactivate, Soft delete, Delete permanently; a soft-deleted meme → Restore, Delete permanently. |
| No permitted actions | No menu button is rendered; the row falls back to the existing "No permission" text (FR-006). |
| Delete confirm | Choosing **Delete permanently** raises the existing blocking `ConfirmDialog` (via `useNotice().ask`) with a single strong "Delete permanently" action plus Cancel, and a message naming the account (FR-008). Cancel leaves the account untouched. |
| Keyboard & dismiss | Menu opens/traverses/activates by keyboard and closes on item choice, Escape, outside click, or focus loss (FR-003, FR-004; US3). |
| After a successful delete | `DELETE` → `204`; the client drops the row in place and keeps its page (FR-013). |
| Failed action | Any non-2xx (incl. `404` from a concurrent delete) leaves the row exactly as it was; the list corrects on the next fetch (FR-012). |
| Transient state | Opening/closing a menu never changes the URL or disturbs Back/Forward/Refresh (FR-019). |
| Identifiers | Every action addresses its target by `hash`, never a DB id (FR-018). |
