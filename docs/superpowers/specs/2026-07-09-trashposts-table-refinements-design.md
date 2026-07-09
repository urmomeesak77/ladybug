# Trashposts moderation table — refinements

**Date:** 2026-07-09
**Feature branch:** 010-admin-meme-moderation

## Goal

Four small, independent refinements to the existing admin moderation console
(already renamed "Trashposts" in the UI by the prior WIP):

1. Move the route from `/admin/memes` to `/admin/trashposts`.
2. Add a **Title** column, immediately after the Thumbnail column.
3. Make the table text slightly smaller.
4. Replace the visible words on the per-row **Activate / Deactivate / Delete /
   Restore** buttons with flat icons (accessible name preserved via `aria-label`
   + `title`). The Delete two-step confirmation keeps its text buttons.

No new dependencies (Principle I). No database schema change — `title` already
exists on `trashposts` and is fillable.

## Changes

### 1. Route rename `/admin/memes` → `/admin/trashposts`

The user-facing label is already "Trashposts"; this aligns the URL. No redirect
from the old path — the feature is unshipped, so there are no live bookmarks.

- `frontend/src/App.tsx` — the `<Route path="/admin/memes" …>` becomes
  `/admin/trashposts`.
- `frontend/src/components/LeftMenu.tsx` — the nav `NavLink to="/admin/memes"`
  becomes `/admin/trashposts`.
- `frontend/src/pages/ModerationPage.tsx` — the leading comment referencing the
  old path is updated (label only; the component is unchanged).
- Tests/e2e that hard-code the path move to the new one:
  `frontend/tests/hooks/useModeration.test.tsx`,
  `frontend/tests/pages/ModerationPage.test.tsx`,
  `frontend/tests/components/LeftMenu.test.tsx`,
  `frontend/tests/components/moderation/ModerationPagination.test.tsx`,
  `frontend/tests/components/moderation/ModerationRow.test.tsx`,
  `frontend/tests/components/RequireRole.test.tsx`,
  `frontend/e2e/moderation.spec.ts`.

The internal `moderation` glyph key, component names, CSS class names, and the
route-guard wiring are unchanged.

### 2. Title column (after Thumbnail)

- **Backend** `app/Http/Resources/AdminTrashpostResource.php` — the projection
  emits `'title' => $this->title` (a `string`; may be empty but is non-null in
  practice). Placed right after `hash`/`thumbnail` for readability; JSON key
  order does not affect the UI.
- **Frontend model** `frontend/src/lib/moderationModel.ts` — `RawModerationRow`
  and `ModerationRow` gain `title: string | null`; `mapRow` copies it through.
- **Table** `frontend/src/components/moderation/ModerationTable.tsx` — a
  `<th scope="col">Title</th>` header inserted as the **second** column, between
  Thumbnail and User.
- **Row** `frontend/src/components/moderation/ModerationRow.tsx` — a
  corresponding `<td class="moderation-title">` inserted as the second cell,
  rendering `row.title` (empty string when null).

**Overflow:** long titles **wrap** to multiple lines. The `moderation-title`
cell overrides the table-wide `white-space: nowrap` with `white-space: normal`
and a `max-width` so a long title grows the row's height rather than the table's
width. All other cells stay single-line.

### 3. Smaller table font

- `frontend/src/styles/theme.css` — `.moderation-table` `font-size` changes from
  `0.9375rem` to `0.875rem` (14px). One-line change; no layout restructure.

### 4. Icon-only action buttons

The four per-row action controls lose their visible text and show a flat SVG
glyph instead, drawn in the same style as the existing LeftMenu glyph set:

| Action     | Glyph            |
| ---------- | ---------------- |
| Activate   | play triangle ▶  |
| Deactivate | two pause bars ⏸ |
| Delete     | trash can 🗑     |
| Restore    | undo arrow ↺     |

- `frontend/src/components/moderation/ModerationActions.tsx` — each action
  `<button>` renders the glyph (SVG, `aria-hidden="true"`) and carries the word
  as its accessible name: `aria-label="Activate"` (etc.) plus a matching `title`
  for a hover tooltip. A small local glyph map (mirroring LeftMenu's `GLYPHS`
  pattern) holds the four SVGs; it lives with the component that uses it.
- The **Delete confirmation** step is unchanged: it still shows the text buttons
  **Confirm delete** (danger tone) and **Cancel**. Keeping words on the
  destructive confirm is a deliberate safety choice.
- `frontend/src/styles/theme.css` — `.moderation-actions__button` gains
  consistent square-ish sizing so the icon buttons line up; the icon inherits
  `currentColor`. The `--danger` modifier is unchanged.

## Accessibility

Removing the visible action words is safe: a row's **state** is conveyed by the
**Activated** and **Deleted** timestamp columns (text — a datetime or an empty
cell), not by the buttons. The buttons are controls whose meaning is the
`aria-label`/`title` text, so state is never conveyed by icon or colour alone
(Principle IV / FR-014 still hold). The danger confirm still carries the word
"delete" as visible text.

## Tests

Every change is mirrored (TDD), keeping the ≥90% coverage gate green on both
stacks:

- **Backend:** `AdminTrashpostResourceTest` asserts `title` is emitted;
  `ModerationControllerTest` adds `title` to its JSON-structure assertion.
- **Frontend:** `moderationModel` (title mapped through), `ModerationTable`
  (Title header present, second column), `ModerationRow` (title cell rendered,
  wraps), `ModerationActions` (buttons still found by accessible name
  "Activate"/"Deactivate"/"Delete"/"Restore" via `aria-label`; confirm step text
  unchanged), and the route-path updates listed in change #1.
- **e2e:** `moderation.spec.ts` uses the new `/admin/trashposts` URL and finds
  the Deactivate/Activate controls by accessible name.

## Out of scope

- No DB schema change (`title` already exists and is fillable).
- No change to any action endpoint, its route method, or its semantics.
- No redirect from the old `/admin/memes` path.
- No change to the timestamp columns from the prior WIP.
