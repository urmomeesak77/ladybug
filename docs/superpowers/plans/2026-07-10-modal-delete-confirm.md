# Modal Delete Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the moderation table's overflowing inline delete Confirm/Cancel buttons with a blocking modal confirmation dialog raised through the app-level `NoticeProvider`.

**Architecture:** A new `ConfirmDialog` component (native `<dialog>` + `showModal()`, sibling of the existing `NoticeDialog`) is rendered by `NoticeProvider` when a consumer raises a confirm via a new `ask()` context function. `ModerationActions.DeletionControl` drops its local `confirming` state and inline button pair and raises the confirm instead; the confirm message copy comes from a new `ModerationModel.deleteConfirmMessage()` static.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react (jsdom), theme.css design tokens. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-10-modal-delete-confirm-design.md`

## Global Constraints

- User-facing copy says **post**, never "meme" (user decision, 2026-07-10).
- `docs/CODING_CONVENTIONS.md` is binding: 2-space indent, semicolons, comments explain *why*, logic helpers are classes of `static` methods (React components/hooks stay functions).
- No new npm dependencies (Constitution Principle I).
- ≥90% Vitest line coverage across `src/` (CI gate); tests mirror source paths under `frontend/tests/`.
- Color is never the sole signal (Principle IV): the danger button's caption carries the meaning.
- All frontend commands run inside the dev container: `docker compose exec frontend npm test -- <args>` / `docker compose exec frontend npm run lint` from the repo root (`C:\projects\ladybug`). The dev stack must be up (`docker compose up -d`).
- Commit after every task on the current branch `010-admin-meme-moderation` (no new branches).

**Verified non-item:** `frontend/e2e/moderation.spec.ts` never exercises delete/confirm (checked 2026-07-10), so no Playwright change is needed despite the design mentioning it.

---

### Task 1: ConfirmDialog component + danger button style

**Files:**
- Create: `frontend/src/components/ConfirmDialog.tsx`
- Create: `frontend/tests/components/ConfirmDialog.test.tsx`
- Modify: `frontend/src/styles/theme.css` (after the `.notice-dialog__buttons button` rule, ~line 544)

**Interfaces:**
- Consumes: existing `.notice-dialog*` CSS classes.
- Produces: `ConfirmDialog` default export, props `{ message: string; title?: string; confirmCaption?: string; onConfirm: () => void; onCancel: () => void }`. `confirmCaption` defaults to `'Confirm'`. Esc and the Cancel button both report through `onCancel`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/components/ConfirmDialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ConfirmDialog from '../../src/components/ConfirmDialog';

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
}

afterEach(cleanup);

describe('ConfirmDialog', () => {
  it('opens as a modal showing title, message, Cancel and the confirm caption', () => {
    render(
      <ConfirmDialog
        title="Delete post?"
        message="Sure?"
        confirmCaption="Confirm delete"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = document.querySelector('dialog');
    expect(dialog?.open).toBe(true);
    expect(screen.getByRole('heading', { name: 'Delete post?' })).toBeTruthy();
    expect(screen.getByText('Sure?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeTruthy();
  });

  it('defaults the confirm caption to Confirm and the title to none', () => {
    render(<ConfirmDialog message="Sure?" onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('reports the confirm click through onConfirm only', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog message="Sure?" onConfirm={onConfirm} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('reports the Cancel click through onCancel only', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog message="Sure?" onConfirm={onConfirm} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('reports Esc (the dialog cancel event) through onCancel', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog message="Sure?" onConfirm={vi.fn()} onCancel={onCancel} />);

    fireEvent(document.querySelector('dialog') as HTMLDialogElement, new Event('cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec frontend npm test -- tests/components/ConfirmDialog.test.tsx`
Expected: FAIL — cannot resolve `../../src/components/ConfirmDialog`.

- [ ] **Step 3: Write the component and the CSS**

Create `frontend/src/components/ConfirmDialog.tsx`:

```tsx
import { useEffect, useRef } from 'react';

// Native <dialog> confirm modal — the two-button sibling of NoticeDialog. Esc (the dialog's
// cancel event) reports through onCancel like the Cancel button, so keyboard users can always
// back out (Principle IV). What confirming *does* is entirely the caller's business.
function ConfirmDialog({ message, title, confirmCaption = 'Confirm', onConfirm, onCancel }: {
  message: string;
  title?: string;
  confirmCaption?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  return (
    <dialog className="notice-dialog" ref={dialogRef} onCancel={onCancel}>
      {title ? <h2>{title}</h2> : null}
      <p>{message}</p>
      <div className="notice-dialog__buttons">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="notice-dialog__danger" onClick={onConfirm}>{confirmCaption}</button>
      </div>
    </dialog>
  );
}

export default ConfirmDialog;
```

In `frontend/src/styles/theme.css`, insert directly after the `.notice-dialog__buttons button { … }` rule (which ends at ~line 544, before the "Email verification (008)" comment block):

```css
.notice-dialog__buttons button + button {
  margin-left: var(--space-sm);
}

/* The destructive choice in a confirm dialog: outlined in the error tone, but the caption
   ("Confirm delete") carries the meaning so colour is never the sole signal (Principle IV). */
.notice-dialog__buttons button.notice-dialog__danger {
  color: var(--color-error);
  border-color: var(--color-error);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec frontend npm test -- tests/components/ConfirmDialog.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ConfirmDialog.tsx frontend/tests/components/ConfirmDialog.test.tsx frontend/src/styles/theme.css
git commit -m "feat(010-admin-meme-moderation): add ConfirmDialog modal component"
```

---

### Task 2: `ask()` confirm support in useNotice + NoticeProvider

**Files:**
- Modify: `frontend/src/hooks/useNotice.ts`
- Modify: `frontend/src/components/NoticeProvider.tsx`
- Modify: `frontend/tests/components/NoticeProvider.test.tsx`

**Interfaces:**
- Consumes: `ConfirmDialog` from Task 1 (props `message`, `title`, `confirmCaption`, `onConfirm`, `onCancel`).
- Produces: `useNotice()` now also returns `confirm: Confirm | null` and `ask: (confirm: Confirm) => void`, where `export type Confirm = { message: string; title?: string; confirmCaption?: string; onConfirm: () => void }`. `clear()` closes notice and confirm alike. Confirming clears the dialog, then runs `onConfirm` exactly once; Cancel/Esc clears without running it.

- [ ] **Step 1: Write the failing tests**

In `frontend/tests/components/NoticeProvider.test.tsx`, add a confirm-raising consumer next to `Raiser` and a new describe block at the end of the file:

```tsx
// Consumer for the confirm side: raises a delete-style confirm carrying the caller's action.
function ConfirmRaiser({ onConfirm }: { onConfirm: () => void }) {
  const { ask } = useNotice();
  return (
    <button
      type="button"
      onClick={() => ask({ title: 'Delete post?', message: 'Sure?', confirmCaption: 'Confirm delete', onConfirm })}
    >
      raise confirm
    </button>
  );
}

describe('NoticeProvider confirm dialogs', () => {
  it('shows the confirm dialog for a raised confirm', () => {
    render(<NoticeProvider><ConfirmRaiser onConfirm={vi.fn()} /></NoticeProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'raise confirm' }));

    expect(screen.getByRole('heading', { name: 'Delete post?' })).toBeTruthy();
    expect(screen.getByText('Sure?')).toBeTruthy();
  });

  it('cancel clears the dialog without running the action', () => {
    const onConfirm = vi.fn();
    render(<NoticeProvider><ConfirmRaiser onConfirm={onConfirm} /></NoticeProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'raise confirm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('confirm runs the action exactly once and clears the dialog', () => {
    const onConfirm = vi.fn();
    render(<NoticeProvider><ConfirmRaiser onConfirm={onConfirm} /></NoticeProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'raise confirm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(document.querySelector('dialog')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose exec frontend npm test -- tests/components/NoticeProvider.test.tsx`
Expected: FAIL — `ask` is not provided by the context (TypeScript/undefined error on `ask`). The three pre-existing tests still pass.

- [ ] **Step 3: Extend the hook and the provider**

Replace the type block in `frontend/src/hooks/useNotice.ts` (keep the file's existing comment and `useNotice` function unchanged):

```ts
export type Notice = { message: string; title?: string };

// A pending confirmation: the message/captions to show and the action to run only when the
// user confirms. Cancel (or Esc) drops it unrun.
export type Confirm = {
  message: string;
  title?: string;
  confirmCaption?: string;
  onConfirm: () => void;
};

export type NoticeContextValue = {
  notice: Notice | null;
  confirm: Confirm | null;
  show: (notice: Notice) => void;
  ask: (confirm: Confirm) => void;
  clear: () => void;
};
```

Replace the body of `frontend/src/components/NoticeProvider.tsx`:

```tsx
import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { NoticeContext } from '../hooks/useNotice';
import type { Confirm, Notice } from '../hooks/useNotice';
import ConfirmDialog from './ConfirmDialog';
import NoticeDialog from './NoticeDialog';

// App-level host for the NoticeDialog and ConfirmDialog. Pages raise notices through
// useNotice(); rendering the dialogs here lets them survive route changes — a register
// success redirects away from /register (RequireAnon) the moment auth state flips, which
// would unmount a page-local dialog before the user saw it. Notice and confirm are never
// raised together in practice; if they ever are, the confirm wins the screen and clear()
// closes both.
function NoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const show = useCallback((next: Notice) => {
    setNotice(next);
  }, []);

  const ask = useCallback((next: Confirm) => {
    setConfirm(next);
  }, []);

  const clear = useCallback(() => {
    setNotice(null);
    setConfirm(null);
  }, []);

  // Confirming closes the dialog first, then runs the caller's action exactly once.
  const runConfirm = useCallback(() => {
    setConfirm(null);
    confirm?.onConfirm();
  }, [confirm]);

  const value = useMemo(() => ({ notice, confirm, show, ask, clear }), [notice, confirm, show, ask, clear]);

  return (
    <NoticeContext.Provider value={value}>
      {children}
      {notice && !confirm ? <NoticeDialog message={notice.message} title={notice.title} onClose={clear} /> : null}
      {confirm ? (
        <ConfirmDialog
          message={confirm.message}
          title={confirm.title}
          confirmCaption={confirm.confirmCaption}
          onConfirm={runConfirm}
          onCancel={clear}
        />
      ) : null}
    </NoticeContext.Provider>
  );
}

export default NoticeProvider;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose exec frontend npm test -- tests/components/NoticeProvider.test.tsx`
Expected: PASS (6 tests — 3 pre-existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useNotice.ts frontend/src/components/NoticeProvider.tsx frontend/tests/components/NoticeProvider.test.tsx
git commit -m "feat(010-admin-meme-moderation): app-level confirm dialogs via useNotice ask()"
```

---

### Task 3: `ModerationModel.deleteConfirmMessage()`

**Files:**
- Modify: `frontend/src/lib/moderationModel.ts` (add a static to the `ModerationModel` class)
- Modify: `frontend/tests/lib/moderationModel.test.ts`

**Interfaces:**
- Produces: `ModerationModel.deleteConfirmMessage(title: string | null): string` — the confirm modal's body copy; says "post", never "meme".

- [ ] **Step 1: Write the failing tests**

Add to `frontend/tests/lib/moderationModel.test.ts` (inside the existing top-level describe, or as a new describe block matching the file's style):

```ts
describe('ModerationModel.deleteConfirmMessage', () => {
  it('names the post by its title', () => {
    expect(ModerationModel.deleteConfirmMessage('A funny meme')).toBe(
      'The post "A funny meme" will be hidden from the site. You can restore it later.',
    );
  });

  it('falls back to "This post" when the title is missing', () => {
    expect(ModerationModel.deleteConfirmMessage(null)).toBe(
      'This post will be hidden from the site. You can restore it later.',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose exec frontend npm test -- tests/lib/moderationModel.test.ts`
Expected: FAIL — `deleteConfirmMessage is not a function`.

- [ ] **Step 3: Implement the static**

Add to the `ModerationModel` class in `frontend/src/lib/moderationModel.ts` (after `shortTitle`):

```ts
  // The delete-confirm modal's body. Soft-delete phrased for the admin: hidden, restorable.
  // User-facing copy says "post" (site vocabulary), never the internal "meme"/"trashpost".
  static deleteConfirmMessage(title: string | null): string {
    if (title === null) {
      return 'This post will be hidden from the site. You can restore it later.';
    }
    return `The post "${title}" will be hidden from the site. You can restore it later.`;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose exec frontend npm test -- tests/lib/moderationModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/moderationModel.ts frontend/tests/lib/moderationModel.test.ts
git commit -m "feat(010-admin-meme-moderation): delete-confirm message copy in ModerationModel"
```

---

### Task 4: ModerationActions raises the modal (drop inline confirm)

**Files:**
- Modify: `frontend/src/components/moderation/ModerationActions.tsx`
- Modify: `frontend/tests/components/moderation/ModerationActions.test.tsx`
- Modify: `frontend/src/styles/theme.css` (remove the now-unused `.moderation-actions__button--danger` rule, ~lines 714–719)

**Interfaces:**
- Consumes: `useNotice().ask` (Task 2), `ModerationModel.deleteConfirmMessage` (Task 3).
- Produces: `ModerationActions` keeps its public props `{ row: Row; onApply: Apply }`; the actions cell now always renders exactly two icon buttons. **Rendering it now requires a `NoticeProvider` ancestor** (already present app-wide via `main.tsx`'s provider nesting).

- [ ] **Step 1: Rewrite the delete tests against the modal**

In `frontend/tests/components/moderation/ModerationActions.test.tsx`:

1. Add imports and the same `showModal` guard used by the other dialog tests:

```tsx
import NoticeProvider from '../../../src/components/NoticeProvider';

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
}
```

2. Wrap the render helper in the provider (the dialog then renders as a sibling of the table, exactly as in production where the provider is app-level):

```tsx
function renderInRow(row: Row, onApply: (updated: Row) => void, onRowClick: () => void = () => {}) {
  return render(
    <NoticeProvider>
      <table>
        <tbody>
          <tr onClick={onRowClick}>
            <td>
              <ModerationActions row={row} onApply={onApply} />
            </td>
          </tr>
        </tbody>
      </table>
    </NoticeProvider>,
  );
}
```

3. Replace the three delete-flow tests (`requires an inline confirm…`, `cancels a pending delete…`, `does not navigate the row when Delete then Confirm…`) with modal equivalents; the other tests are untouched:

```tsx
  it('requires a modal confirm before it deletes (FR-016)', async () => {
    const updated = { ...inactive, deletedAt: '2026-07-09 09:30:00' };
    vi.spyOn(ModerationApi, 'remove').mockResolvedValue({ ok: true, row: updated });
    const onApply = vi.fn();

    renderInRow(inactive, onApply);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    // Not sent yet — the modal confirmation must be answered first; the copy says "post".
    expect(ModerationApi.remove).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Delete post?' })).toBeTruthy();
    expect(
      screen.getByText('The post "A funny meme" will be hidden from the site. You can restore it later.'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(updated));
    expect(ModerationApi.remove).toHaveBeenCalledWith('Ab3-_9xQ12');
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('cancels a pending delete without sending it, closing the modal', () => {
    vi.spyOn(ModerationApi, 'remove').mockResolvedValue({ ok: false });

    renderInRow(inactive, () => {});
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(ModerationApi.remove).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeTruthy();
  });

  it('does not navigate the row when Delete then Confirm is clicked (FR-018)', () => {
    vi.spyOn(ModerationApi, 'remove').mockResolvedValue({ ok: false });
    const onRowClick = vi.fn();

    renderInRow(inactive, () => {}, onRowClick);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

    expect(onRowClick).not.toHaveBeenCalled();
  });
```

4. Add one modal-specific test for the untitled fallback, in the same describe block:

```tsx
  it('falls back to "This post" copy when the row has no title', () => {
    renderInRow({ ...inactive, title: null }, () => {});
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(
      screen.getByText('This post will be hidden from the site. You can restore it later.'),
    ).toBeTruthy();
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `docker compose exec frontend npm test -- tests/components/moderation/ModerationActions.test.tsx`
Expected: FAIL — the modal tests can't find the `Delete post?` heading (inline buttons still render); pre-existing activation tests still pass.

- [ ] **Step 3: Rework DeletionControl**

In `frontend/src/components/moderation/ModerationActions.tsx`:

1. Change the first import line `import { useState } from 'react';` → remove it (no state left); keep the `type` import line.
2. Add imports:

```ts
import { useNotice } from '../../hooks/useNotice';
import { ModerationModel } from '../../lib/moderationModel';
```

3. Replace `DeletionControl` and delete the `DeleteConfirm` component entirely:

```tsx
// Delete (guarded by a blocking modal confirm raised app-level via useNotice, FR-016) for a
// live meme; single-click Restore for a soft-deleted one. Exactly one path shows, per the
// row's deleted state. The modal renders outside the row, so answering it never navigates.
function DeletionControl({ row, onApply }: { row: Row; onApply: Apply }) {
  const { ask } = useNotice();
  const deleted = row.deletedAt !== null;

  function restore(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    void RowAction.apply(ModerationApi.restore(row.hash), onApply);
  }

  function confirmDelete(): void {
    void RowAction.apply(ModerationApi.remove(row.hash), onApply);
  }

  function askDelete(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    ask({
      title: 'Delete post?',
      message: ModerationModel.deleteConfirmMessage(row.title),
      confirmCaption: 'Confirm delete',
      onConfirm: confirmDelete,
    });
  }

  if (deleted) {
    return (
      <button type="button" className="moderation-actions__button" onClick={restore} aria-label="Restore" title="Restore">
        <ActionIcon glyph="restore" />
      </button>
    );
  }

  return (
    <button type="button" className="moderation-actions__button" onClick={askDelete} aria-label="Delete" title="Delete">
      <ActionIcon glyph="delete" />
    </button>
  );
}
```

4. Update the stale wording in the file's two header comments: in the `ModerationActions` comment, "(US3 activation + US4 delete/restore)" stays, but any mention of the inline confirm goes; the `DeletionControl` comment above already covers the modal.

5. In `frontend/src/styles/theme.css`, delete the now-unused rule and its comment (~lines 714–719):

```css
/* The destructive confirm step: outlined in a warning tone, but the word "delete" carries
   the meaning so colour is never the sole signal (Principle IV, FR-014). */
.moderation-actions__button--danger {
  color: var(--color-error);
  border-color: var(--color-error);
}
```

- [ ] **Step 4: Run the full frontend suite**

Run: `docker compose exec frontend npm test -- --coverage`
Expected: PASS across all files (any other suite rendering `ModerationActions` without a provider would surface here); coverage stays ≥90%.

- [ ] **Step 5: Lint**

Run: `docker compose exec frontend npm run lint`
Expected: clean (the removed `useState` import and deleted component would otherwise trip `no-unused-vars`).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/moderation/ModerationActions.tsx frontend/tests/components/moderation/ModerationActions.test.tsx frontend/src/styles/theme.css
git commit -m "feat(010-admin-meme-moderation): delete confirmation as blocking modal"
```

---

### Task 5: Spec artifact truth-up + live verification

**Files:**
- Modify: `specs/010-admin-meme-moderation/spec.md` (FR-016, ~line 211)
- Modify: `specs/010-admin-meme-moderation/research.md` (R7, lines 127–136)

**Interfaces:** none (documentation + verification only).

- [ ] **Step 1: Amend FR-016 in spec.md**

In the FR-016 deletion bullet, replace:

> **Delete** MUST require a lightweight confirmation step before it applies;

with:

> **Delete** MUST require a confirmation step — a blocking modal dialog that suspends
> interaction with the rest of the page until answered (revised 2026-07-10 from the
> original inline confirm, which overflowed the actions column) — before it applies;

- [ ] **Step 2: Rewrite the R7 section in research.md**

Replace the R7 **Decision** and **Rationale** paragraphs (keep the `## R7 — Delete confirmation (lightweight)` heading, retitled to `## R7 — Delete confirmation (modal)`):

```markdown
## R7 — Delete confirmation (modal)

**Decision**: Delete is confirmed in a **blocking modal dialog** (native `<dialog>` +
`showModal()`), raised app-level through `NoticeProvider` via a new `useNotice().ask()`;
Activate, Deactivate, and Restore apply on a single click (FR-016 clarification).

**Rationale**: Originally an inline in-cell Confirm/Cancel pair; once the action buttons
became compact icons, the text pair overflowed the actions column (revised 2026-07-10 —
see docs/superpowers/specs/2026-07-10-modal-delete-confirm-design.md). A modal fits any
row width and blocks stray page actions while the decision is pending. The existing
`NoticeProvider`/`NoticeDialog` already established the native-dialog pattern, so the
confirm extends that infrastructure with a two-button `ConfirmDialog` sibling.
```

- [ ] **Step 3: Verify in the running app**

With the dev stack up (`docker compose up -d`; restart `frontend` if Vite serves stale code):
open `http://localhost:5173/admin/trashposts` as an admin, click a row's trash icon, and
confirm: modal opens with "Delete post?" + post-title copy, backdrop dims the page, clicks
outside do nothing, Esc/Cancel closes without deleting, Confirm delete soft-deletes and the
row flips to Restore. Screenshot or state observed behavior in the summary.

- [ ] **Step 4: Full gates + quality verifier**

Run: `docker compose exec frontend npm test -- --coverage` and `docker compose exec frontend npm run lint`
Expected: PASS / clean. Then dispatch the `commit-quality-verifier` agent on the staged diff; commit only on PASS.

- [ ] **Step 5: Commit and push everything**

```bash
git add specs/010-admin-meme-moderation/spec.md specs/010-admin-meme-moderation/research.md
git commit -m "docs(010-admin-meme-moderation): FR-016 confirm is a blocking modal"
git push
```

(Also push the earlier task commits if not yet pushed.)
