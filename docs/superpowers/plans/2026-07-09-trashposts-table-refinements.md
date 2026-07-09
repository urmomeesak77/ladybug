# Trashposts Table Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four scoped refinements to the admin Trashposts moderation table — rename the route, add a Title column, shrink the table font, and turn the per-row action buttons into icons.

**Architecture:** A Laravel 12 JSON API (`AdminTrashpostResource`) feeds a React 18 + TS SPA table (`ModerationTable` → `ModerationRow` → `ModerationActions`). One backend key is added (`title`); the frontend threads it through the model into a new column; the action buttons swap visible words for flat SVG glyphs while keeping their accessible names; and the route string moves. No schema change (the `title` column already exists, nullable), no new dependencies.

**Tech Stack:** Laravel 12 / PHP 8.2+ (tests via `php:8.3-cli` Docker, sqlite `:memory:`), React 18 + Vite + TypeScript, Vitest + Testing Library, Playwright e2e.

## Global Constraints

- **No new dependencies** (Constitution Principle I) — use only what's installed.
- **PHP:** `declare(strict_types=1)`, PSR-12, 4-space indent, functions < 30 lines, braces on single-line bodies.
- **JS/TS:** 2-space indent, semicolons, functions < 50 lines; every `lib/` module is a single class of `static` methods; React components/hooks stay functions.
- **Public identifier is `hash`** — never expose DB `id`/`user_id`/`file` in the row projection (Principle V).
- **Accessibility (Principle IV / FR-014):** state is never conveyed by colour or icon alone; every control has an accessible name; images/glyphs are `aria-hidden` with the text carried on the control.
- **Tests mirror source; ≥90% line coverage on both stacks, enforced in CI.** Tests run on sqlite `:memory:` and `Http::fake()` — never the real DB or network.
- **All backend PHP runs through Docker** (no local PHP): `docker compose exec -T backend …`.
- **Commit after each task.** Current branch `010-admin-meme-moderation` — commit there (no new branch).

---

### Task 1: Backend — expose `title` in the moderation row projection

**Files:**
- Modify: `backend/app/Http/Resources/AdminTrashpostResource.php` (add one key to `toArray`)
- Test: `backend/tests/Unit/Http/Resources/AdminTrashpostResourceTest.php`
- Test: `backend/tests/Feature/Http/Controllers/Admin/ModerationControllerTest.php` (JSON-structure assertion)

**Interfaces:**
- Produces: the row JSON gains `"title": string|null` (raw `trashposts.title`, nullable), positioned between `thumbnail` and `type`. Consumed by the frontend `RawModerationRow` in Task 2.

- [ ] **Step 1: Update the resource key-shape test**

In `AdminTrashpostResourceTest.php`, change the `test_exposes_the_documented_row_shape_and_url` expected key list to include `title` after `thumbnail`:

```php
        $this->assertSame(
            ['hash', 'thumbnail', 'title', 'type', 'username', 'created_at', 'activated_at', 'deleted_at', 'url'],
            array_keys($row),
        );
```

- [ ] **Step 2: Add a value test for `title`**

Add this test method to `AdminTrashpostResourceTest.php`:

```php
    public function test_title_is_the_raw_stored_title(): void {
        $post = Trashpost::factory()->create(['title' => 'A funny meme']);

        $this->assertSame('A funny meme', $this->toArray($post)['title']);
    }

    public function test_title_is_null_when_unset(): void {
        $post = Trashpost::factory()->create(['title' => null]);

        $this->assertNull($this->toArray($post)['title']);
    }
```

- [ ] **Step 3: Add `title` to the controller structure assertion**

In `ModerationControllerTest.php`, update the `data` structure assertion (around line 54) to include `title`:

```php
            'data' => [['hash', 'thumbnail', 'title', 'type', 'username', 'created_at', 'activated_at', 'deleted_at', 'url']],
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `docker compose exec -T backend php artisan test --filter="AdminTrashpostResource|Moderation"`
Expected: FAIL — `title` key is missing / key order mismatch.

- [ ] **Step 5: Add `title` to the resource projection**

In `AdminTrashpostResource.php`, insert the `title` key in `toArray` between `thumbnail` and `type`:

```php
        return [
            'hash' => $this->hash,
            'thumbnail' => $this->thumbnailUrl(),
            'title' => $this->title,
            'type' => $this->type,
            'username' => $this->uploaderName(),
            'created_at' => $this->created_at?->format('Y-m-d H:i:s'),
            'activated_at' => $this->activated_at?->format('Y-m-d H:i:s'),
            'deleted_at' => $this->deleted_at?->format('Y-m-d H:i:s'),
            'url' => "/posts/{$this->hash}",
        ];
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `docker compose exec -T backend php artisan test --filter="AdminTrashpostResource|Moderation"`
Expected: PASS.

- [ ] **Step 7: Lint the backend**

Run: `docker compose exec -T backend vendor/bin/pint --test`
Expected: no style errors.

- [ ] **Step 8: Commit**

```bash
git add backend/app/Http/Resources/AdminTrashpostResource.php backend/tests/Unit/Http/Resources/AdminTrashpostResourceTest.php backend/tests/Feature/Http/Controllers/Admin/ModerationControllerTest.php
git commit -m "feat(010-admin-meme-moderation): expose title in the moderation row projection"
```

---

### Task 2: Frontend — add the Title column

**Files:**
- Modify: `frontend/src/lib/moderationModel.ts` (type + mapRow)
- Modify: `frontend/src/components/moderation/ModerationTable.tsx` (header)
- Modify: `frontend/src/components/moderation/ModerationRow.tsx` (cell)
- Modify: `frontend/src/styles/theme.css` (`.moderation-title` wrap rule)
- Test: `frontend/tests/lib/moderationModel.test.ts`
- Test: `frontend/tests/components/moderation/ModerationTable.test.tsx`
- Test: `frontend/tests/components/moderation/ModerationRow.test.tsx`
- Fixtures to update (add `title`): all 7 test files listed in Step 4.

**Interfaces:**
- Consumes: `RawModerationRow.title: string | null` from Task 1's JSON.
- Produces: `ModerationRow.title: string | null` on the render-ready row; a `Title` `<th>` as the table's **second** column and a matching `<td class="moderation-title">` as the row's **second** cell.

- [ ] **Step 1: Update the model mapping test**

In `moderationModel.test.ts`, add `title` to `rawRow` and to the expected mapped object:

```ts
const rawRow: RawModerationRow = {
  hash: 'Ab3-_9xQ12',
  thumbnail: 'http://localhost/storage/x.jpg',
  title: 'A funny meme',
  type: 'image',
  username: 'alice',
  created_at: '2026-07-08 20:14:02',
  activated_at: '2026-07-09 08:01:10',
  deleted_at: null,
  url: '/posts/Ab3-_9xQ12',
};
```

And in the `maps the raw row…` expectation:

```ts
    expect(row).toEqual({
      hash: 'Ab3-_9xQ12',
      thumbnail: 'http://localhost/storage/x.jpg',
      title: 'A funny meme',
      type: 'image',
      username: 'alice',
      createdAt: '2026-07-08 20:14:02',
      activatedAt: '2026-07-09 08:01:10',
      deletedAt: null,
      url: '/posts/Ab3-_9xQ12',
    });
```

- [ ] **Step 2: Update the table-header test**

In `ModerationTable.test.tsx`, add `title` to `makeRow` and change the header assertions:

```ts
function makeRow(hash: string, username: string): ModerationRow {
  return {
    hash,
    thumbnail: null,
    title: 'A funny meme',
    type: 'image',
    username,
    createdAt: '2026-07-08 20:14:02',
    activatedAt: '2026-07-09 08:01:10',
    deletedAt: null,
    url: `/posts/${hash}`,
  };
}
```

In `has a caption and scoped column headers`, bump the count and assert the Title header:

```ts
    const headers = container.querySelectorAll('th[scope="col"]');
    expect(headers).toHaveLength(7);
    expect(screen.getByRole('columnheader', { name: 'Title' })).toBeTruthy();
```

- [ ] **Step 3: Update the row-cell test**

In `ModerationRow.test.tsx`, add `title` to the `row` fixture, change the cell count, and assert the title renders:

```ts
const row: Row = {
  hash: 'Ab3-_9xQ12',
  thumbnail: null,
  title: 'A funny meme',
  type: 'image',
  username: 'alice',
  createdAt: '2026-07-08 20:14:02',
  activatedAt: '2026-07-09 08:01:10',
  deletedAt: null,
  url: '/posts/Ab3-_9xQ12',
};
```

Change the cell-count test to seven and add a title test:

```ts
  it('renders all seven cells', () => {
    const { container } = renderRow(row);

    expect(container.querySelectorAll('td')).toHaveLength(7);
  });

  it('shows the post title', () => {
    renderRow(row);

    expect(screen.getByText('A funny meme')).toBeTruthy();
  });
```

- [ ] **Step 4: Add `title` to every remaining Row/RawModerationRow fixture**

TypeScript will now require `title` on every row literal. Add `title: 'A funny meme'` (or any string) to the fixtures in these files so `tsc` stays green:
`frontend/tests/components/moderation/ModerationActions.test.tsx` (`activated`),
`frontend/tests/pages/ModerationPage.test.tsx`,
`frontend/tests/hooks/useModeration.test.tsx`,
`frontend/tests/lib/moderationApi.test.ts`.
(The four edited above — `moderationModel`, `ModerationTable`, `ModerationRow` — are already done.)

- [ ] **Step 5: Run the tests to verify they fail**

Run (from `frontend/`): `npm run test -- moderationModel ModerationTable ModerationRow`
Expected: FAIL — `title` missing from the model type / no Title header / cell count is 6.

- [ ] **Step 6: Thread `title` through the model**

In `frontend/src/lib/moderationModel.ts`, add `title` to `RawModerationRow` (after `thumbnail`), to `ModerationRow` (after `thumbnail`), and to `mapRow`:

```ts
export type RawModerationRow = {
  hash: string;
  thumbnail: string | null;
  title: string | null;
  type: string | null;
  username: string | null;
  created_at: string | null;
  activated_at: string | null;
  deleted_at: string | null;
  url: string;
};
```

```ts
export type ModerationRow = {
  hash: string;
  thumbnail: string | null;
  title: string | null;
  type: string | null;
  username: string | null;
  // Raw MySQL datetimes (Y-m-d H:i:s) straight from the server, or null when unset. The
  // absence of an activated_at/deleted_at is itself the "not activated"/"live" signal.
  createdAt: string | null;
  activatedAt: string | null;
  deletedAt: string | null;
  url: string;
};
```

```ts
  static mapRow(raw: RawModerationRow): ModerationRow {
    return {
      hash: raw.hash,
      thumbnail: raw.thumbnail,
      title: raw.title,
      type: raw.type,
      username: raw.username,
      createdAt: raw.created_at,
      activatedAt: raw.activated_at,
      deletedAt: raw.deleted_at,
      url: raw.url,
    };
  }
```

- [ ] **Step 7: Add the Title header (second column)**

In `frontend/src/components/moderation/ModerationTable.tsx`, insert the header between Thumbnail and User:

```tsx
          <tr>
            <th scope="col">Thumbnail</th>
            <th scope="col">Title</th>
            <th scope="col">User</th>
            <th scope="col">Created</th>
            <th scope="col">Activated</th>
            <th scope="col">Deleted</th>
            <th scope="col">Actions</th>
          </tr>
```

- [ ] **Step 8: Add the Title cell (second cell)**

In `frontend/src/components/moderation/ModerationRow.tsx`, insert the cell between the thumbnail cell and the user cell:

```tsx
      <td><ModerationThumbnail src={row.thumbnail} alt={alt} /></td>
      <td className="moderation-title">{row.title ?? ''}</td>
      <td>{uploader}</td>
```

- [ ] **Step 9: Add the wrap style**

In `frontend/src/styles/theme.css`, add after the `.moderation-time` block:

```css
/* The title can be long: let it wrap within a capped width so a long title grows the
   row's height, not the table's width (the other cells stay single-line). */
.moderation-title {
  white-space: normal;
  max-width: 22rem;
}
```

- [ ] **Step 10: Run the tests to verify they pass**

Run (from `frontend/`): `npm run test -- moderationModel ModerationTable ModerationRow`
Expected: PASS.

- [ ] **Step 11: Typecheck + lint**

Run (from `frontend/`): `npx tsc --noEmit && npm run lint`
Expected: no type errors, no lint errors.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/lib/moderationModel.ts frontend/src/components/moderation/ModerationTable.tsx frontend/src/components/moderation/ModerationRow.tsx frontend/src/styles/theme.css frontend/tests
git commit -m "feat(010-admin-meme-moderation): add Title column to the moderation table"
```

---

### Task 3: Frontend — icon-only action buttons + smaller table font

**Files:**
- Modify: `frontend/src/components/moderation/ModerationActions.tsx` (glyphs + aria-label/title)
- Modify: `frontend/src/styles/theme.css` (icon sizing + table font-size)
- Test: `frontend/tests/components/moderation/ModerationActions.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: the four action buttons (Activate/Deactivate/Delete/Restore) render an `aria-hidden` SVG glyph and carry their word as `aria-label` + `title`. The Delete-confirm buttons ("Confirm delete"/"Cancel") keep their visible text.

- [ ] **Step 1: Add tests locking in the icon behaviour**

In `ModerationActions.test.tsx`, add these tests inside the `describe('ModerationActions activation control', …)` block:

```ts
  it('renders the Activate control as an icon button (aria-label + title, no visible text)', () => {
    renderInRow(inactive, () => {});

    const button = screen.getByRole('button', { name: /^activate$/i });
    expect(button.getAttribute('title')).toBe('Activate');
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
  });
```

(The existing `getByRole('button', { name: /^activate$/i })` etc. assertions keep working because the accessible name now comes from `aria-label`.)

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npm run test -- ModerationActions`
Expected: FAIL — the button still has visible text `"Activate"` and no `title`/`svg`.

- [ ] **Step 3: Add the glyph set and an icon component to ModerationActions.tsx**

At the top of `frontend/src/components/moderation/ModerationActions.tsx`, after the existing imports, add the glyph map and icon component. Add `ReactElement` to the `react` type import.

```tsx
import { useState } from 'react';
import type { MouseEvent, ReactElement } from 'react';
```

```tsx
type ActionGlyph = 'activate' | 'deactivate' | 'delete' | 'restore';

// Flat single-path glyphs (24x24, filled with currentColor) drawn in the same spirit as the
// LeftMenu icon set: a play triangle, pause bars, a trash can, and an undo arc.
const GLYPHS: Record<ActionGlyph, string> = {
  activate: 'M8 5v14l11-7z',
  deactivate: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  restore: 'M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 7 7 6.97 6.97 0 0 1-4.9-2L6.7 18.4A9 9 0 1 0 13 3z',
};

// Decorative only: the button's aria-label/title carries the accessible name (Principle IV).
function ActionIcon({ glyph }: { glyph: ActionGlyph }): ReactElement {
  return (
    <svg className="moderation-actions__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={GLYPHS[glyph]} />
    </svg>
  );
}
```

- [ ] **Step 4: Swap the activation button's text for an icon**

Replace the `ActivationButton` return with an icon button labelled by `aria-label`/`title`:

```tsx
  const label = activated ? 'Deactivate' : 'Activate';

  return (
    <button type="button" className="moderation-actions__button" onClick={toggle} aria-label={label} title={label}>
      <ActionIcon glyph={activated ? 'deactivate' : 'activate'} />
    </button>
  );
```

- [ ] **Step 5: Swap the Restore and Delete buttons for icons (keep the confirm step as text)**

In `DeletionControl`, replace the Restore button and the initial Delete button (leave `DeleteConfirm` untouched):

```tsx
  if (deleted) {
    return (
      <button type="button" className="moderation-actions__button" onClick={restore} aria-label="Restore" title="Restore">
        <ActionIcon glyph="restore" />
      </button>
    );
  }

  if (confirming) {
    return <DeleteConfirm onConfirm={confirmDelete} onCancel={cancelDelete} />;
  }

  return (
    <button type="button" className="moderation-actions__button" onClick={askDelete} aria-label="Delete" title="Delete">
      <ActionIcon glyph="delete" />
    </button>
  );
```

- [ ] **Step 6: Size the icons and shrink the table font**

In `frontend/src/styles/theme.css`, change the `.moderation-table` font-size and add an icon rule. Edit the existing `.moderation-table` block:

```css
.moderation-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
```

Add after the `.moderation-actions__button:hover, …:focus-visible` block:

```css
/* Icon-only action buttons: the glyph inherits the button's text colour and sits on a
   square-ish footprint so the controls line up. The accessible name lives on the button. */
.moderation-actions__icon {
  display: block;
  width: 1.1rem;
  height: 1.1rem;
  fill: currentColor;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run (from `frontend/`): `npm run test -- ModerationActions`
Expected: PASS (icon behaviour + all existing activation/delete/restore/confirm cases).

- [ ] **Step 8: Typecheck + lint**

Run (from `frontend/`): `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/moderation/ModerationActions.tsx frontend/src/styles/theme.css frontend/tests/components/moderation/ModerationActions.test.tsx
git commit -m "feat(010-admin-meme-moderation): icon action buttons + smaller table font"
```

---

### Task 4: Rename the route `/admin/memes` → `/admin/trashposts`

**Files:**
- Modify: `frontend/src/App.tsx` (route path)
- Modify: `frontend/src/components/LeftMenu.tsx` (`NavLink to`)
- Modify: `frontend/src/pages/ModerationPage.tsx` (leading comment only)
- Test: `frontend/tests/components/LeftMenu.test.tsx` (asserts the href)
- Modify (path strings): `frontend/tests/hooks/useModeration.test.tsx`, `frontend/tests/pages/ModerationPage.test.tsx`, `frontend/tests/components/moderation/ModerationPagination.test.tsx`, `frontend/tests/components/moderation/ModerationRow.test.tsx`, `frontend/tests/components/RequireRole.test.tsx`
- Modify (e2e): `frontend/e2e/moderation.spec.ts`

**Interfaces:**
- Produces: the moderation console is reachable at `/admin/trashposts`; the old `/admin/memes` no longer resolves (no redirect — feature unshipped).

- [ ] **Step 1: Update the LeftMenu href test**

In `frontend/tests/components/LeftMenu.test.tsx` (around line 99):

```ts
    expect(link.getAttribute('href')).toBe('/admin/trashposts');
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `frontend/`): `npm run test -- LeftMenu`
Expected: FAIL — the link still points at `/admin/memes`.

- [ ] **Step 3: Move the route and the nav link**

In `frontend/src/App.tsx`, change the route path:

```tsx
              <Route
                path="/admin/trashposts"
                element={<RequireRole role="admin"><ModerationPage /></RequireRole>}
              />
```

In `frontend/src/components/LeftMenu.tsx`, change the NavLink:

```tsx
          <NavLink to="/admin/trashposts">
```

In `frontend/src/pages/ModerationPage.tsx`, update the leading comment's path reference:

```tsx
// The /admin/trashposts moderation console (US1): the full-corpus table plus its numbered page
```

- [ ] **Step 4: Update the remaining test path strings**

Replace `'/admin/memes'` with `'/admin/trashposts'` in every occurrence in:
`frontend/tests/hooks/useModeration.test.tsx` (6 occurrences),
`frontend/tests/pages/ModerationPage.test.tsx` (1),
`frontend/tests/components/moderation/ModerationPagination.test.tsx` (1),
`frontend/tests/components/moderation/ModerationRow.test.tsx` (1),
`frontend/tests/components/RequireRole.test.tsx` (2).

- [ ] **Step 5: Update the e2e spec**

In `frontend/e2e/moderation.spec.ts`, replace all three `'/admin/memes'` occurrences (lines ~35, ~55, ~77) with `'/admin/trashposts'`.

- [ ] **Step 6: Run the frontend suite to verify green**

Run (from `frontend/`): `npm run test`
Expected: PASS (Vitest excludes `e2e/`).

- [ ] **Step 7: Typecheck + lint**

Run (from `frontend/`): `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/LeftMenu.tsx frontend/src/pages/ModerationPage.tsx frontend/tests frontend/e2e/moderation.spec.ts
git commit -m "feat(010-admin-meme-moderation): move console route to /admin/trashposts"
```

---

### Task 5: Full-gate verification

**Files:** none (verification + optional fixups only).

- [ ] **Step 1: Backend gates (Pint + PHPUnit with coverage)**

Run:
```bash
docker compose exec -T backend vendor/bin/pint --test
docker compose exec -T backend php artisan test
```
Expected: Pint clean; all backend tests pass. Coverage on the moderation modules stays ≥90% (they are fully exercised by the resource/controller tests).

- [ ] **Step 2: Frontend gates (lint + typecheck + Vitest with coverage)**

Run (from `frontend/`):
```bash
npm run lint
npx tsc --noEmit
npm run test
```
Expected: clean lint/types; all Vitest suites pass; the moderation modules stay at ≥90% line coverage (they were 100% before and the new lines are all under test).

- [ ] **Step 3: e2e (optional but recommended — isolated stack)**

Run (from repo root, PowerShell): `scripts\e2e.ps1 e2e/moderation.spec.ts`
Expected: the two moderation specs pass against the isolated `ladybug-e2e` stack, now hitting `/admin/trashposts`. (Media-less by design, so thumbnails render as placeholders — expected.)

- [ ] **Step 4: Dispatch the commit-quality-verifier**

Dispatch the `commit-quality-verifier` agent against the branch diff. Address any FAIL findings, then re-run the relevant gate. Only proceed on PASS.

- [ ] **Step 5: Final commit (only if fixups were made)**

```bash
git add -A
git commit -m "chore(010-admin-meme-moderation): verification fixups for table refinements"
```

---

## Notes

- No new npm/Composer dependency is introduced (Principle I).
- `title` is `nullable` in the schema; the UI renders `null` as an empty cell.
- The icon glyphs are inline single-path SVGs (no icon library) filled with `currentColor`.
- The Delete two-step confirm keeps visible text ("Confirm delete" / "Cancel") by explicit design decision — a safety affordance on the destructive path.
