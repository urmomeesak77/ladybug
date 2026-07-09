# Trashposts moderation table — raw timestamps + rename

**Date:** 2026-07-09
**Feature branch:** 010-admin-meme-moderation

## Goal

Two changes to the existing admin moderation console:

1. Rename the user-facing label from "Meme moderation" / "Moderation" to **"Trashposts"**.
2. In the table, show the raw MySQL datetime (or an empty cell) for the
   **Activated** and **Deleted** columns instead of the ●/○ state badges, and
   render **Created** as the same raw MySQL datetime instead of a localized string.

Format: `Y-m-d H:i:s` (exactly as stored in MySQL); `null` → empty cell.

## Changes

### Naming (labels only)

- `frontend/src/pages/ModerationPage.tsx` — `<h1>`, `document.title`, and the
  section `aria-label` become **"Trashposts"**.
- `frontend/src/components/LeftMenu.tsx` — the nav link text "Moderation" becomes
  **"Trashposts"**. The route (`/admin/memes`), the `moderation` glyph key, and
  internal identifiers/comments are unchanged.

### Timestamps replace state badges / localized date

- **Backend** `app/Http/Resources/AdminTrashpostResource.php` — the projection emits:
  - `created_at` → `$this->created_at?->format('Y-m-d H:i:s')`
  - `activated_at` (was the `activated` bool) → formatted string or `null`
  - `deleted_at` (was the `deleted` bool) → formatted string or `null`

  The JSON keys `activated`/`deleted` are **renamed** to `activated_at`/`deleted_at`.

- **Frontend model** `frontend/src/lib/moderationModel.ts` — `RawModerationRow`
  and `ModerationRow` carry `createdAt: string`, `activatedAt: string | null`,
  `deletedAt: string | null`. The `activated`/`deleted` booleans and the
  `activationLabel`/`deletionLabel` helpers are removed — the timestamp is the
  single source of truth for state.

- **Display** `frontend/src/components/moderation/ModerationRow.tsx` — the
  Created/Activated/Deleted cells render the raw datetime string, or an empty cell
  when `null`. The `StateBadge` component is removed. Column headers are unchanged.

- **Actions** `frontend/src/components/moderation/ModerationActions.tsx` — the
  current state is derived from the timestamp: `row.activatedAt !== null` chooses
  Activate/Deactivate, `row.deletedAt !== null` chooses Delete/Restore. Behavior
  is otherwise unchanged.

## Accessibility

An empty "Activated" cell now means "not activated", with the column header giving
context — replacing the old "○ Not activated" text. This is a direct consequence
of the "or empty" requirement. State is still conveyed as text (a datetime or its
absence), never by color alone, so Principle IV / FR-014 intent holds.

## Tests

Updated alongside the code (TDD), keeping the ≥90% coverage gate green on both stacks:

- Backend: `AdminTrashpostResourceTest` (key shape + timestamp values), and any
  `ModerationControllerTest` assertions on the row JSON.
- Frontend: `moderationModel`, `ModerationRow`, `ModerationActions`, `moderationApi`,
  `useModeration`, `ModerationPage`, `LeftMenu` unit tests, and the
  `moderation.spec.ts` Playwright e2e — anything asserting the old booleans, badge
  labels, or the "Moderation" / "Meme moderation" text.

## Out of scope

- No DB schema change (the `activated_at` / `deleted_at` / `created_at` columns
  already exist).
- No change to the action endpoints or their semantics.
