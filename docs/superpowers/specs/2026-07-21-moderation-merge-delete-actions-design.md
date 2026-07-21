# Design — Merge moderation "Soft delete" + "Delete permanently" into one "Delete"

**Date:** 2026-07-21
**Feature area:** 013 admin action menus — moderation console (`/admin/trashposts`)
**Scope:** frontend only, presentation change

## Problem

In the moderation kebab menu (`ModerationActions.tsx`), a live meme currently offers two
delete entries — **Soft delete** and **Delete permanently** — and *both* open the same
confirmation popup (`askDelete`) that already lets the admin choose soft-vs-permanent. The
two menu items are therefore redundant: the choice belongs to the popup, not the menu.

## Goal

Present a single **Delete** menu item in the moderation console. The choice between soft
delete and permanent delete stays where it already lives — in the confirmation popup.

## Change

Frontend only, in `frontend/src/components/moderation/ModerationActions.tsx` and its test.
Nothing else changes: no API, no `moderationModel.ts` copy, no `ActionMenu.tsx`, and the
confirm dialogs and their button labels are untouched.

### `ModerationMenu.live(row, apply, askDelete)`

Replace the two items:

```tsx
{ label: 'Soft delete', icon: <ActionIcon glyph="delete" />, onChoose: askDelete },
{ label: 'Delete permanently', danger: true, icon: <ActionIcon glyph="delete" />, onChoose: askDelete },
```

with one, no danger emphasis:

```tsx
{ label: 'Delete', icon: <ActionIcon glyph="delete" />, onChoose: askDelete },
```

`askDelete` is unchanged — it still opens the soft-vs-permanent popup, so no capability is
lost; there is simply one entry point instead of two.

### `ModerationMenu.deleted(row, apply, askPurge)`

Relabel the single delete entry from `Delete permanently` to `Delete` and drop the
`danger: true` emphasis. `onChoose` stays `askPurge` → the existing permanent-only popup
(soft delete is moot for an already soft-deleted meme).

### Docblock

Update the `ModerationMenu` class docblock to describe the merged single **Delete** item
rather than the former two-item live menu.

## Confirmation popups — unchanged

- Live meme: `askDelete` → `Delete post?` with **Soft delete** and **Delete permanently**
  buttons and the existing `ModerationModel.deleteConfirmMessage` copy.
- Soft-deleted meme: `askPurge` → `Delete post permanently?` with the single **Delete
  permanently** button.

## Tests (`frontend/tests/components/moderation/ModerationActions.test.tsx`)

- Menu-**item** assertions change: the live-meme tests (`inactive`, `activated`) and the
  soft-deleted test assert a single `/^delete$/i` menu item; `/^soft delete$/i` and
  `/^delete permanently$/i` no longer appear as menu items.
- In-**dialog** button assertions stay: the popup still exposes `Soft delete` /
  `Delete permanently` buttons — those `within(dialog)` checks are unchanged.
- The two separate live tests ("Soft delete" item, "Delete permanently" item) merge into
  tests that open the menu, click the single **Delete** item, then exercise both the soft
  path (`ModerationApi.remove`) and the permanent path (`ModerationApi.purge`) from the one
  popup.
- The soft-deleted permanent-only tests click the **Delete** menu item (was
  `Delete permanently`), then the `Delete permanently` dialog button — behavior unchanged.

## Out of scope

- The users console (`UserActions.tsx` and `tests/e2e/admin-action-menus.spec.ts`) — its
  `Delete permanently` item is a different menu with no soft/permanent choice.
- Historical docs: the `013-admin-action-menus` entry in `CLAUDE.md` and the
  `specs/013-…` spec describe the prior three-item live menu and are left as-is; this
  dated design doc records the change.

## Verification

`ModerationActions.test.tsx` (Vitest) is green with the updated assertions; ESLint clean;
frontend coverage gate (≥90% over `src/`) still met — the change only removes a menu item,
so no new uncovered branches.
