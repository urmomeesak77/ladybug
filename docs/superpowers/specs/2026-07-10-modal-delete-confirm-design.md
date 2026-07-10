# Modal Delete Confirmation for the Moderation Table — Design

**Date:** 2026-07-10
**Feature branch:** `010-admin-meme-moderation`
**Status:** Approved

## Problem

The moderation table's delete action (FR-016) uses an inline two-step confirm:
clicking the trash icon swaps the actions cell to a text "Confirm delete" +
"Cancel" button pair. Those buttons are wider than the actions column, so they
overflow the table (see `temp/view.png`). The confirmation should instead be a
modal popup that blocks all other page interaction until answered.

## Decision

Extend the existing app-level notice infrastructure (`NoticeProvider` /
`useNotice`) with a confirm-dialog capability, rendered as a native `<dialog>`
opened with `showModal()` — the same blocking pattern `NoticeDialog` already
uses (backdrop, inert page, focus trap).

Approaches considered and rejected:

- **Local ConfirmDialog inside `ModerationActions`** — works, but the user
  chose the app-level service so future confirms reuse the same plumbing.
- **`window.confirm()`** — natively blocking but unthemed browser chrome;
  untestable and visually out of place.

## Design

### 1. Context API — `frontend/src/hooks/useNotice.ts`

```ts
export type Confirm = {
  message: string;
  title?: string;
  confirmCaption?: string;   // defaults to 'Confirm'
  onConfirm: () => void;
};

export type NoticeContextValue = {
  notice: Notice | null;
  confirm: Confirm | null;
  show: (notice: Notice) => void;
  ask: (confirm: Confirm) => void;   // raises a confirm dialog
  clear: () => void;                 // closes whichever dialog is open
};
```

`NoticeProvider` holds `confirm` state alongside `notice`. Confirm button →
`clear()` then `onConfirm()` (exactly once); Cancel or Esc → `clear()` only.

### 2. New component — `frontend/src/components/ConfirmDialog.tsx`

A sibling of `NoticeDialog`, not a rewrite (notices stay one-button):

- Native `<dialog>` + `showModal()` on mount; `onCancel` (Esc) reports through
  `onClose` so keyboard users can always dismiss (Principle IV, same deviation
  NoticeDialog documents).
- Optional `title` (`<h2>`), `message` (`<p>`), then a button row: **Cancel**
  and a danger-styled confirm button carrying `confirmCaption`.
- Reuses the `.notice-dialog` CSS classes; theme.css gains one danger-button
  modifier (e.g. `.notice-dialog__buttons button.notice-dialog__danger`) using
  the existing danger color variable so it themes in light and dark.

### 3. `NoticeProvider` rendering

Renders `ConfirmDialog` when a confirm is pending. Notice and confirm are
mutually exclusive in practice; if both are ever set, only the confirm renders,
and `clear()` closes both states at once.

### 4. Call site — `frontend/src/components/moderation/ModerationActions.tsx`

`DeletionControl` drops its `confirming` state and the inline `DeleteConfirm`
component entirely. The trash-icon click raises:

- title: `Delete post?`
- message: `The post "<title>" will be hidden from the site. You can restore
  it later.` — falls back to `this post` when the row has no title.
- confirmCaption: `Confirm delete`
- onConfirm: applies `ModerationApi.remove(row.hash)` via `RowAction.apply`.

The actions cell therefore always holds exactly two icon buttons and can no
longer overflow. User-facing copy says **post**, not "meme".

### 5. Tests (mirror source; ≥90% coverage gate)

- New `frontend/tests/components/ConfirmDialog.test.tsx` — renders title /
  message / captions, confirm fires `onConfirm`, cancel and Esc fire `onClose`.
- Extend `frontend/tests/components/NoticeProvider.test.tsx` — `ask()` shows
  the dialog, cancel clears without firing, confirm fires exactly once and
  clears.
- Rework delete cases in
  `frontend/tests/components/moderation/ModerationActions.test.tsx` — delete
  goes through the provider-rendered modal (wrap render in `NoticeProvider`).
- Update the moderation Playwright e2e spec's delete-confirm selectors to the
  modal buttons.
- jsdom lacks `showModal()`; follow whatever polyfill/guard the existing
  NoticeDialog tests use.

### 6. Spec artifact touch-up

Amend `specs/010-admin-meme-moderation/spec.md` (FR-016 wording: inline →
modal confirmation) and `specs/010-admin-meme-moderation/research.md` (the
"No global modal/dialog infra is added" note) so the artifacts stay truthful.

## Out of scope (YAGNI)

Promise-based `confirm()` API, dialog queueing, animations, converting
`NoticeDialog` itself.
