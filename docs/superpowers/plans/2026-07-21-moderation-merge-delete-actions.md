# Merge Moderation Delete Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the moderation kebab menu's two delete entries (Soft delete + Delete permanently) with a single "Delete" item; the existing confirmation popup keeps the soft-vs-permanent choice.

**Architecture:** Frontend-only, presentation change in one React component (`ModerationActions.tsx`) and its Vitest spec. The confirmation dialogs (`askDelete` soft-vs-permanent, `askPurge` permanent-only) and their button labels are untouched — only the menu-item list built by `ModerationMenu` changes.

**Tech Stack:** React 18 + TypeScript, Vitest + Testing Library. Frontend tests run via `npm test` in `frontend/`.

## Global Constraints

- Coding conventions binding (`docs/CODING_CONVENTIONS.md`): 2-space TS, semicolons, braces on single-line bodies, comments explain *why*.
- Every `lib/` module is a class of static methods; call through the class. (No new modules here.)
- Frontend coverage gate ≥90% line over all of `src/` (CI, Clover).
- No new dependencies.
- Menu item accessible name comes from the visible text label (Principle IV / FR-002); each item keeps its icon (FR-015).

---

### Task 1: Merge the two delete menu items into one "Delete"

**Files:**
- Modify: `frontend/src/components/moderation/ModerationActions.tsx` (`ModerationMenu.live` ~L82-87, `ModerationMenu.deleted` ~L89-98, docblock ~L62-67)
- Test: `frontend/tests/components/moderation/ModerationActions.test.tsx`

**Interfaces:**
- Consumes: `ModerationApi.remove/purge/activate/deactivate/restore`, `ActionMenuItem` (`{ label, icon?, danger?, onChoose }`), `askDelete()`/`askPurge()` from `ModerationActions` (unchanged).
- Produces: no new exports. `ModerationMenu.live` and `.deleted` each now emit a single delete item labeled `Delete` (no `danger`).

- [ ] **Step 1: Update the failing tests**

In `ModerationActions.test.tsx`, change the menu-**item** assertions (leave every `within(dialog)` button assertion as-is):

Line ~71-81 test — rename and assert one Delete item:
```tsx
  it('offers Activate and a single Delete item for an inactive live meme', () => {
    renderInRow(inactive);
    openMenu();

    expect(screen.getByRole('menuitem', { name: /^activate$/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^deactivate$/i })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /^delete$/i })).toBeTruthy();
    // The two former delete entries are gone; the choice lives in the popup.
    expect(screen.queryByRole('menuitem', { name: /^soft delete$/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^delete permanently$/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^restore$/i })).toBeNull();
  });
```

Line ~83-91 test — activated meme, single Delete:
```tsx
  it('offers Deactivate (not Activate) plus a single Delete for an activated meme', () => {
    renderInRow(activated);
    openMenu();

    expect(screen.getByRole('menuitem', { name: /^deactivate$/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^activate$/i })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /^delete$/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^delete permanently$/i })).toBeNull();
  });
```

Line ~93-102 test — soft-deleted meme, Restore + single Delete:
```tsx
  it('offers Restore and a single Delete only for a soft-deleted meme (FR-016)', () => {
    renderInRow(deletedRow);
    openMenu();

    expect(screen.getByRole('menuitem', { name: /^restore$/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^delete$/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^delete permanently$/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^activate$/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^deactivate$/i })).toBeNull();
  });
```

Replace the two separate live-delete tests (~L169-210) with one merged test that opens the single Delete item and exercises both popup paths:
```tsx
  it("a live meme's Delete item raises the soft-vs-permanent confirm; the soft choice soft-deletes", async () => {
    const updated = { ...inactive, deletedAt: '2026-07-09 09:30:00' };
    vi.spyOn(ModerationApi, 'remove').mockResolvedValue({ ok: true, row: updated });
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: false });
    const onApply = vi.fn();

    renderInRow(inactive, onApply);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^delete$/i }));

    expect(ModerationApi.remove).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Delete post?' })).toBeTruthy();
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    expect(within(dialog).getByRole('button', { name: 'Soft delete' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Delete permanently' })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Soft delete' }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(updated));
    expect(ModerationApi.remove).toHaveBeenCalledWith('Ab3-_9xQ12');
    expect(ModerationApi.purge).not.toHaveBeenCalled();
  });

  it("a live meme's Delete item purges when the permanent choice is taken (FR-017)", async () => {
    vi.spyOn(ModerationApi, 'remove').mockResolvedValue({ ok: false });
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: true });
    const onRemove = vi.fn();

    renderInRow(inactive, () => {}, onRemove);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^delete$/i }));

    expect(screen.getByRole('heading', { name: 'Delete post?' })).toBeTruthy();
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('Ab3-_9xQ12'));
    expect(ModerationApi.purge).toHaveBeenCalledWith('Ab3-_9xQ12');
    expect(ModerationApi.remove).not.toHaveBeenCalled();
  });
```

In the soft-deleted permanent-only tests (~L212-227 and ~L243-255) and the cancel test (~L229-241) and the no-title test (~L257-268), change the menu-item click from `/^delete permanently$/i` / `/^soft delete$/i` to `/^delete$/i`. Keep the `within(dialog)` button clicks (`Delete permanently`, `Soft delete`, `Cancel`) and the dialog-copy assertions unchanged.

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose run --rm frontend npm test -- ModerationActions` (or `cd frontend && npm test -- ModerationActions`)
Expected: FAIL — menu still renders `Soft delete` / `Delete permanently`, so `/^delete$/i` queries and the `queryByRole(... delete permanently)` null-checks fail.

- [ ] **Step 3: Update `ModerationMenu` in `ModerationActions.tsx`**

`live()` — replace the two delete items with one (no `danger`):
```tsx
    return [
      activation,
      { label: 'Delete', icon: <ActionIcon glyph="delete" />, onChoose: askDelete },
    ];
```

`deleted()` — relabel and drop `danger`:
```tsx
  static deleted(row: Row, apply: ApplyAction, askPurge: () => void): ActionMenuItem[] {
    return [
      {
        label: 'Restore',
        icon: <ActionIcon glyph="restore" />,
        onChoose: () => apply(ModerationApi.restore(row.hash)),
      },
      { label: 'Delete', icon: <ActionIcon glyph="delete" />, onChoose: askPurge },
    ];
  }
```

Update the `ModerationMenu` docblock (~L62-67) to describe the merged item, e.g.:
```tsx
// Builds the state-dependent menu item list. A live meme offers Activate/Deactivate and a
// single Delete; a soft-deleted meme offers Restore and Delete (FR-016). Each item carries an
// icon and a text label (FR-015). The soft-vs-permanent choice is not in the menu — Delete
// opens the existing confirm: a live meme's Delete opens the soft-vs-permanent popup (FR-017),
// a soft-deleted meme's Delete opens the permanent-only popup.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose run --rm frontend npm test -- ModerationActions`
Expected: PASS (all ModerationActions specs green).

- [ ] **Step 5: Lint + full frontend suite + coverage**

Run: `docker compose run --rm frontend npm run lint` — Expected: clean.
Run: `docker compose run --rm frontend npm test` — Expected: all green, coverage ≥90% over `src/`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/moderation/ModerationActions.tsx frontend/tests/components/moderation/ModerationActions.test.tsx
git commit -m "feat: single Delete action in moderation menu (soft/permanent chosen in popup)"
```

---

## Self-Review

- **Spec coverage:** live merge → Step 3 `live()`; deleted relabel + no danger → Step 3 `deleted()`; docblock → Step 3; menu-item vs dialog-button test split → Step 1; out-of-scope items untouched (no task edits them). Covered.
- **Placeholder scan:** none — all steps carry concrete code/commands.
- **Type consistency:** items stay `ActionMenuItem`; `askDelete`/`askPurge` signatures unchanged; hash literal `'Ab3-_9xQ12'` matches existing fixtures.
