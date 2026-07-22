# Admin Post Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins the console's per-meme moderation actions in place — a kebab menu in the top-right of every Home-feed item and on the single-post page.

**Architecture:** Frontend-only. A new admin-gated `AdminPostActions` component reuses the shared `ActionMenu` kebab, the existing `ModerationApi`, and the existing confirm dialogs. Menu contents are driven by the meme's `hidden` field (`'pending' | 'deleted' | null`). A successful feed action removes the item; on the post page it refreshes the visible state in place (or navigates home on a hard delete).

**Tech Stack:** React 18 + TypeScript + Vite, Vitest + Testing Library, React Router.

## Global Constraints

- `docs/CODING_CONVENTIONS.md` binding: 2-space indent, semicolons, functions <50 lines, braces on single-line bodies, comments explain *why*, `lib/` modules are single classes of `static` methods (call through the class).
- No new npm dependencies (Principle I) — everything reused.
- ≥90% line coverage across all of `src/` (CI gate spans the whole tree).
- User-facing copy says "post", never "meme"/"trashpost".
- Accessibility: color never the sole signal; icons decorative (`aria-hidden`); text labels carry meaning; keep the WAI-ARIA menu-button pattern intact.
- No DB ids in URLs/links — the 10-char `hash` is the only public identifier.
- Server already enforces `role:admin` on every action endpoint; the SPA gate is a UX mirror, not the security boundary.

---

### Task 1: Extract the shared action glyphs

**Files:**
- Create: `frontend/src/components/moderation/ActionGlyph.tsx`
- Modify: `frontend/src/components/moderation/ModerationActions.tsx` (remove inline glyphs, import them)
- Test: `frontend/tests/components/moderation/ActionGlyph.test.tsx`

**Interfaces:**
- Produces: `export type ActionGlyphName = 'activate' | 'deactivate' | 'delete' | 'restore';` and `export function ActionIcon({ glyph }: { glyph: ActionGlyphName }): ReactElement;`

- [ ] **Step 1: Write the failing test** — `frontend/tests/components/moderation/ActionGlyph.test.tsx`

```tsx
// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ActionIcon } from '../../../src/components/moderation/ActionGlyph';

afterEach(cleanup);

describe('ActionIcon', () => {
  it('renders a decorative svg with a path for each glyph', () => {
    for (const glyph of ['activate', 'deactivate', 'delete', 'restore'] as const) {
      const { container } = render(<ActionIcon glyph={glyph} />);
      const svg = container.querySelector('svg[aria-hidden="true"]');
      expect(svg).toBeTruthy();
      expect(svg?.querySelector('path')?.getAttribute('d')).toBeTruthy();
      cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend test -- run tests/components/moderation/ActionGlyph.test.tsx`
Expected: FAIL — module `ActionGlyph` not found.

- [ ] **Step 3: Create `ActionGlyph.tsx`** (moving the glyph map + icon verbatim out of `ModerationActions.tsx`)

```tsx
import type { ReactElement } from 'react';

// The action glyph names shared by the moderation console and the in-place post actions.
export type ActionGlyphName = 'activate' | 'deactivate' | 'delete' | 'restore';

// Flat single-path glyphs (24x24, filled with currentColor) drawn in the same spirit as the
// LeftMenu icon set: a play triangle, pause bars, a trash can, and an undo arc.
const GLYPHS: Record<ActionGlyphName, string> = {
  activate: 'M8 5v14l11-7z',
  deactivate: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  restore: 'M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 7 7 6.97 6.97 0 0 1-4.9-2L6.7 18.4A9 9 0 1 0 13 3z',
};

// Decorative only: the menu item's text label carries the accessible meaning (Principle IV /
// FR-002); the icon accompanies it (FR-015).
export function ActionIcon({ glyph }: { glyph: ActionGlyphName }): ReactElement {
  return (
    <svg className="action-menu__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={GLYPHS[glyph]} />
    </svg>
  );
}
```

Note: the icon class becomes `action-menu__icon` (already styled, 1.1rem) instead of the old `moderation-actions__icon`, so both surfaces share one icon size. This is intentional — see Task 8's CSS note.

- [ ] **Step 4: Update `ModerationActions.tsx`** — delete the inline `ActionGlyph` type, `GLYPHS`, and `ActionIcon`; import instead:

```tsx
import { ActionIcon } from './ActionGlyph';
import type { ActionGlyphName } from './ActionGlyph';
```

Replace each `<ActionIcon glyph="activate" />` etc. usage unchanged (the component name is identical). The local `ActionGlyph` type alias references become `ActionGlyphName` — but they were only used by the removed `ActionIcon`, so no other change is needed.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --prefix frontend test -- run tests/components/moderation/ActionGlyph.test.tsx tests/components/moderation/ModerationActions.test.tsx`
Expected: PASS (ModerationActions behaviour unchanged).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/moderation/ActionGlyph.tsx frontend/src/components/moderation/ModerationActions.tsx frontend/tests/components/moderation/ActionGlyph.test.tsx
git commit -m "refactor: extract shared moderation action glyphs"
```

---

### Task 2: Derive `hidden` from a returned moderation row

**Files:**
- Modify: `frontend/src/lib/moderationModel.ts` (add `hiddenFromRow`)
- Test: `frontend/tests/lib/moderationModel.test.ts` (add cases)

**Interfaces:**
- Produces: `ModerationModel.hiddenFromRow(row: ModerationRow): 'pending' | 'deleted' | null`

- [ ] **Step 1: Add the failing test** — append to `frontend/tests/lib/moderationModel.test.ts`

```ts
describe('ModerationModel.hiddenFromRow', () => {
  const base = {
    hash: 'h', thumbnail: null, title: null, type: null, username: null, createdAt: null,
  };

  it('reports deleted when the row is soft-deleted, whatever its activation', () => {
    expect(ModerationModel.hiddenFromRow({ ...base, activatedAt: '2026-07-09 08:00:00', deletedAt: '2026-07-09 09:00:00' })).toBe('deleted');
    expect(ModerationModel.hiddenFromRow({ ...base, activatedAt: null, deletedAt: '2026-07-09 09:00:00' })).toBe('deleted');
  });

  it('reports pending for a live, never-activated row', () => {
    expect(ModerationModel.hiddenFromRow({ ...base, activatedAt: null, deletedAt: null })).toBe('pending');
  });

  it('reports null (public) for an activated, live row', () => {
    expect(ModerationModel.hiddenFromRow({ ...base, activatedAt: '2026-07-09 08:00:00', deletedAt: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend test -- run tests/lib/moderationModel.test.ts`
Expected: FAIL — `hiddenFromRow is not a function`.

- [ ] **Step 3: Implement** — add to the `ModerationModel` class in `frontend/src/lib/moderationModel.ts`

```ts
  // The coarse public-visibility status the feed/post surfaces use, derived from a returned
  // row: soft-deleted → 'deleted', else never-activated → 'pending', else null (public).
  // Mirrors the backend's TrashpostResource::hiddenStatus() so both agree.
  static hiddenFromRow(row: ModerationRow): 'pending' | 'deleted' | null {
    if (row.deletedAt !== null) {
      return 'deleted';
    }
    if (row.activatedAt === null) {
      return 'pending';
    }
    return null;
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix frontend test -- run tests/lib/moderationModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/moderationModel.ts frontend/tests/lib/moderationModel.test.ts
git commit -m "feat: derive coarse hidden status from a moderation row"
```

---

### Task 3: Feed reducer — remove a post

**Files:**
- Modify: `frontend/src/lib/pagination.ts` (`FeedAction` union + reducer case)
- Test: `frontend/tests/lib/pagination.test.ts` (add cases)

**Interfaces:**
- Produces: `FeedAction` gains `| { type: 'removePost'; hash: string }`; `Pagination.reducer` drops the named post from `state.posts`.

- [ ] **Step 1: Add the failing test** — append to `frontend/tests/lib/pagination.test.ts`

```ts
describe('Pagination.reducer removePost', () => {
  const p = (hash: string) => ({
    hash, title: null, permalink: `/posts/${hash}`,
    media: { kind: 'none' as const }, hidden: null, author: null, createdAt: null,
  });

  it('drops the named post and keeps the status', () => {
    const state = { status: 'loaded' as const, posts: [p('aaa'), p('bbb'), p('ccc')] };
    const next = Pagination.reducer(state, { type: 'removePost', hash: 'bbb' });
    expect(next.posts.map((x) => x.hash)).toEqual(['aaa', 'ccc']);
    expect(next.status).toBe('loaded');
  });

  it('is a no-op when the post is not present', () => {
    const state = { status: 'end' as const, posts: [p('aaa')] };
    const next = Pagination.reducer(state, { type: 'removePost', hash: 'zzz' });
    expect(next.posts.map((x) => x.hash)).toEqual(['aaa']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend test -- run tests/lib/pagination.test.ts`
Expected: FAIL — reducer returns state unchanged / type error on the action.

- [ ] **Step 3: Implement** — in `frontend/src/lib/pagination.ts`

Add to the `FeedAction` union:

```ts
  | { type: 'removePost'; hash: string };
```

Add a case in `reducer` (before `default`):

```ts
      case 'removePost':
        // Drop a meme an admin just hid/removed in place; the persisted snapshot follows
        // the shortened list, so Back/refresh does not resurrect it.
        return { ...state, posts: state.posts.filter((post) => post.hash !== action.hash) };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix frontend test -- run tests/lib/pagination.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/pagination.ts frontend/tests/lib/pagination.test.ts
git commit -m "feat: add removePost action to the feed reducer"
```

---

### Task 4: Post reducer — apply a moderation state change

**Files:**
- Modify: `frontend/src/lib/postModel.ts` (`PostPageAction` union + reducer case)
- Test: `frontend/tests/lib/postModel.test.ts` (add cases)

**Interfaces:**
- Produces: `PostPageAction` gains `| { type: 'applyModeration'; hidden: 'pending' | 'deleted' | null }`; on a `loaded` state the reducer returns the same post with the new `hidden`; a no-op otherwise.

- [ ] **Step 1: Add the failing test** — append to `frontend/tests/lib/postModel.test.ts`

```ts
describe('PostModel.reducer applyModeration', () => {
  const post = {
    hash: 'abc1234567', title: 'T', permalink: '/posts/abc1234567',
    media: { kind: 'none' as const }, hidden: null, author: null, createdAt: null,
  };

  it('updates hidden on a loaded post without touching anything else', () => {
    const loaded = { status: 'loaded' as const, post };
    const next = PostModel.reducer(loaded, { type: 'applyModeration', hidden: 'deleted' });
    expect(next).toEqual({ status: 'loaded', post: { ...post, hidden: 'deleted' } });
  });

  it('is a no-op when no post is loaded', () => {
    const loading = { status: 'loading' as const };
    expect(PostModel.reducer(loading, { type: 'applyModeration', hidden: 'pending' })).toBe(loading);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend test -- run tests/lib/postModel.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — in `frontend/src/lib/postModel.ts`

Add to `PostPageAction`:

```ts
  | { type: 'applyModeration'; hidden: 'pending' | 'deleted' | null };
```

In `reducer`, before the `idle` short-circuit is fine because it needs the loaded post — add this near the top of `reducer`, right after the `loadStart` branch:

```ts
    if (action.type === 'applyModeration') {
      // Refresh the visible state after an in-place admin action; only meaningful once
      // the post is on screen, a no-op in every other lifecycle state.
      return state.status === 'loaded'
        ? { status: 'loaded', post: { ...state.post, hidden: action.hidden } }
        : state;
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix frontend test -- run tests/lib/postModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/postModel.ts frontend/tests/lib/postModel.test.ts
git commit -m "feat: add applyModeration action to the post reducer"
```

---

### Task 5: Expose `removePost` from `useFeed`

**Files:**
- Modify: `frontend/src/hooks/useFeed.ts`
- Test: `frontend/tests/hooks/useFeed.test.tsx` (add a case)

**Interfaces:**
- Consumes: `Pagination.reducer` `removePost` action (Task 3).
- Produces: `useFeed(...)` return object gains `removePost: (hash: string) => void`.

- [ ] **Step 1: Add the failing test** — append a case to `frontend/tests/hooks/useFeed.test.tsx` following its existing render-hook pattern. (Read the file first for its exact `renderHook` + `Api.fetchFeed` mock helpers; reuse them.) The case: load one batch, call `removePost(hash)` of a loaded post inside `act`, assert `result.current.state.posts` no longer contains it.

```tsx
it('removePost drops a loaded post from the feed', async () => {
  // Arrange: reuse this file's existing fetchFeed mock helper to load a batch of posts,
  // then remove the first by hash.
  const first = /* the hash of the first loaded post from the mocked batch */;
  act(() => { result.current.removePost(first); });
  expect(result.current.state.posts.some((p) => p.hash === first)).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend test -- run tests/hooks/useFeed.test.tsx`
Expected: FAIL — `removePost is not a function`.

- [ ] **Step 3: Implement** — in `frontend/src/hooks/useFeed.ts`

Add a callback and return it:

```ts
  // Drop a meme an admin hid/removed in place (US: in-feed moderation). Dispatch only —
  // the persist effect writes the shortened list to the snapshot.
  const removePost = useCallback((hash: string) => {
    dispatch({ type: 'removePost', hash });
  }, []);
```

and add `removePost` to the returned object:

```ts
  return { state, load, atPageBreak, canAutoLoad, removePost };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix frontend test -- run tests/hooks/useFeed.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useFeed.ts frontend/tests/hooks/useFeed.test.tsx
git commit -m "feat: expose removePost from useFeed"
```

---

### Task 6: Expose `applyModeration` from `usePost`

**Files:**
- Modify: `frontend/src/hooks/usePost.ts`
- Test: `frontend/tests/hooks/usePost.test.tsx` (add a case)

**Interfaces:**
- Consumes: `PostModel.reducer` `applyModeration` action (Task 4).
- Produces: `usePost(...)` return gains `applyModeration: (hidden: 'pending' | 'deleted' | null) => void`.

- [ ] **Step 1: Add the failing test** — append to `frontend/tests/hooks/usePost.test.tsx` (read it first for its `Api.fetchPost` mock + `renderHook` helpers). Load a post, call `applyModeration('deleted')` in `act`, assert `result.current.state` is loaded with `post.hidden === 'deleted'`.

```tsx
it('applyModeration updates the loaded post hidden state', async () => {
  // Arrange with this file's existing helper to reach a loaded state, then:
  act(() => { result.current.applyModeration('deleted'); });
  expect(result.current.state).toMatchObject({ status: 'loaded', post: { hidden: 'deleted' } });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend test -- run tests/hooks/usePost.test.tsx`
Expected: FAIL — `applyModeration is not a function`.

- [ ] **Step 3: Implement** — in `frontend/src/hooks/usePost.ts`

```ts
  const applyModeration = useCallback((hidden: 'pending' | 'deleted' | null) => {
    dispatch({ type: 'applyModeration', hidden });
  }, []);
```

and change the return type + value to include it:

```ts
  return { state, retry, applyModeration };
```

Update the function's return-type annotation accordingly:

```ts
export function usePost(hash: string | undefined): {
  state: PostPageState;
  retry: () => void;
  applyModeration: (hidden: 'pending' | 'deleted' | null) => void;
} {
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix frontend test -- run tests/hooks/usePost.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/usePost.ts frontend/tests/hooks/usePost.test.tsx
git commit -m "feat: expose applyModeration from usePost"
```

---

### Task 7: `AdminPostActions` component

**Files:**
- Create: `frontend/src/components/moderation/AdminPostActions.tsx`
- Test: `frontend/tests/components/moderation/AdminPostActions.test.tsx`

**Interfaces:**
- Consumes: `ActionMenu`/`ActionMenuItem`, `ActionIcon` (Task 1), `ModerationApi`, `ModerationModel.hiddenFromRow` (Task 2) + `deleteConfirmMessage`/`purgeConfirmMessage`, `useNotice`.
- Produces:

```tsx
export type AdminPostActionsProps = {
  hash: string;
  title: string | null;
  hidden: 'pending' | 'deleted' | null;
  onApplied: (hidden: 'pending' | 'deleted' | null) => void;
  onRemoved: () => void;
};
function AdminPostActions(props: AdminPostActionsProps): JSX.Element;
```

- [ ] **Step 1: Write the failing test** — `frontend/tests/components/moderation/AdminPostActions.test.tsx`

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminPostActions from '../../../src/components/moderation/AdminPostActions';
import NoticeProvider from '../../../src/components/NoticeProvider';
import { ModerationApi } from '../../../src/lib/moderationApi';

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderActions(
  hidden: 'pending' | 'deleted' | null,
  onApplied = vi.fn(),
  onRemoved = vi.fn(),
) {
  render(
    <NoticeProvider>
      <AdminPostActions hash="Ab3-_9xQ12" title="A funny post" hidden={hidden} onApplied={onApplied} onRemoved={onRemoved} />
    </NoticeProvider>,
  );
  return { onApplied, onRemoved };
}

function openMenu() {
  fireEvent.click(screen.getByRole('button'));
}

describe('AdminPostActions menu shape', () => {
  it('offers Deactivate + Delete for a public post', () => {
    renderActions(null);
    openMenu();
    expect(screen.getByRole('menuitem', { name: /^deactivate$/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^delete$/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^activate$/i })).toBeNull();
  });

  it('offers Activate + Delete for a pending post', () => {
    renderActions('pending');
    openMenu();
    expect(screen.getByRole('menuitem', { name: /^activate$/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^delete$/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^deactivate$/i })).toBeNull();
  });

  it('offers Restore + Delete for a deleted post', () => {
    renderActions('deleted');
    openMenu();
    expect(screen.getByRole('menuitem', { name: /^restore$/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^delete$/i })).toBeTruthy();
  });
});

describe('AdminPostActions behaviour', () => {
  it('deactivates and reports the derived hidden state', async () => {
    vi.spyOn(ModerationApi, 'deactivate').mockResolvedValue({
      ok: true,
      row: { hash: 'Ab3-_9xQ12', thumbnail: null, title: null, type: null, username: null, createdAt: null, activatedAt: null, deletedAt: null },
    });
    const { onApplied } = renderActions(null);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^deactivate$/i }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith('pending'));
    expect(ModerationApi.deactivate).toHaveBeenCalledWith('Ab3-_9xQ12');
  });

  it('activates a pending post and reports null (public)', async () => {
    vi.spyOn(ModerationApi, 'activate').mockResolvedValue({
      ok: true,
      row: { hash: 'Ab3-_9xQ12', thumbnail: null, title: null, type: null, username: null, createdAt: null, activatedAt: '2026-07-09 08:00:00', deletedAt: null },
    });
    const { onApplied } = renderActions('pending');
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^activate$/i }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(null));
  });

  it('soft-deletes via the confirm and reports deleted', async () => {
    vi.spyOn(ModerationApi, 'remove').mockResolvedValue({
      ok: true,
      row: { hash: 'Ab3-_9xQ12', thumbnail: null, title: null, type: null, username: null, createdAt: null, activatedAt: '2026-07-09 08:00:00', deletedAt: '2026-07-09 09:00:00' },
    });
    const { onApplied } = renderActions(null);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^delete$/i }));
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Soft delete' }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith('deleted'));
  });

  it('purges via the permanent choice and reports removal', async () => {
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: true });
    const { onRemoved } = renderActions(null);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^delete$/i }));
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
  });

  it('a deleted post gets the permanent-only confirm and purges', async () => {
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: true });
    const { onRemoved } = renderActions('deleted');
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^delete$/i }));
    expect(screen.getByRole('heading', { name: 'Delete post permanently?' })).toBeTruthy();
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    expect(within(dialog).queryByRole('button', { name: 'Soft delete' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
  });

  it('reports nothing when an action fails', async () => {
    vi.spyOn(ModerationApi, 'deactivate').mockResolvedValue({ ok: false });
    const { onApplied } = renderActions(null);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^deactivate$/i }));
    await Promise.resolve();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('names the post in the trigger label', () => {
    renderActions(null);
    expect(screen.getByRole('button', { name: 'More actions for A funny post' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend test -- run tests/components/moderation/AdminPostActions.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `frontend/src/components/moderation/AdminPostActions.tsx`

```tsx
import ActionMenu from '../admin/ActionMenu';
import type { ActionMenuItem } from '../admin/ActionMenu';
import { ActionIcon } from './ActionGlyph';
import { useNotice } from '../../hooks/useNotice';
import { ModerationApi } from '../../lib/moderationApi';
import type { ModerationActionResult } from '../../lib/moderationApi';
import { ModerationModel } from '../../lib/moderationModel';

export type AdminPostActionsProps = {
  hash: string;
  title: string | null;
  hidden: 'pending' | 'deleted' | null;
  // The action changed the meme's public-visibility state; the caller decides what that
  // means for its surface (feed removes it, the post page refreshes in place).
  onApplied: (hidden: 'pending' | 'deleted' | null) => void;
  // The meme was permanently removed (204); the caller drops it.
  onRemoved: () => void;
};

// Builds the state-driven menu items from the meme's coarse `hidden` state — the same
// activate/deactivate/delete/restore set the console offers (ModerationActions), keyed off
// `hidden` instead of the console row's activated_at/deleted_at. The Delete item never acts
// directly; it opens the shared confirm (soft-vs-permanent for a live meme, permanent-only
// for a soft-deleted one).
class PostActionMenu {
  static build(
    hidden: 'pending' | 'deleted' | null,
    run: (action: Promise<ModerationActionResult>) => void,
    askDelete: () => void,
    hash: string,
  ): ActionMenuItem[] {
    if (hidden === 'deleted') {
      return [
        { label: 'Restore', icon: <ActionIcon glyph="restore" />, onChoose: () => run(ModerationApi.restore(hash)) },
        { label: 'Delete', icon: <ActionIcon glyph="delete" />, danger: true, onChoose: askDelete },
      ];
    }
    const activation: ActionMenuItem = hidden === null
      ? { label: 'Deactivate', icon: <ActionIcon glyph="deactivate" />, onChoose: () => run(ModerationApi.deactivate(hash)) }
      : { label: 'Activate', icon: <ActionIcon glyph="activate" />, onChoose: () => run(ModerationApi.activate(hash)) };
    return [
      activation,
      { label: 'Delete', icon: <ActionIcon glyph="delete" />, onChoose: askDelete },
    ];
  }
}

// The in-place admin moderation menu shown on a feed item and the single-post page. Renders
// through the shared kebab (ActionMenu); a successful non-purge action reports the new hidden
// state upward, a purge reports removal, and any failure reports nothing (the surface is left
// untouched) — matching the console's fail-safe behaviour.
function AdminPostActions({ hash, title, hidden, onApplied, onRemoved }: AdminPostActionsProps) {
  const { ask } = useNotice();

  function run(action: Promise<ModerationActionResult>): void {
    void action.then((result) => {
      if (result.ok) {
        onApplied(ModerationModel.hiddenFromRow(result.row));
      }
    });
  }

  function purge(): void {
    void ModerationApi.purge(hash).then((result) => {
      if (result.ok) {
        onRemoved();
      }
    });
  }

  // A live meme (public or pending): the soft-vs-permanent choice.
  function askDelete(): void {
    if (hidden === 'deleted') {
      ask({
        title: 'Delete post permanently?',
        message: ModerationModel.purgeConfirmMessage(title),
        actions: [{ caption: 'Delete permanently', onChoose: purge, strong: true }],
      });
      return;
    }
    ask({
      title: 'Delete post?',
      message: ModerationModel.deleteConfirmMessage(title),
      actions: [
        { caption: 'Soft delete', onChoose: () => run(ModerationApi.remove(hash)) },
        { caption: 'Delete permanently', onChoose: purge, strong: true },
      ],
    });
  }

  const items = PostActionMenu.build(hidden, run, askDelete, hash);
  return (
    <div className="post-actions">
      <ActionMenu items={items} label={`More actions for ${title ?? 'this post'}`} />
    </div>
  );
}

export default AdminPostActions;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix frontend test -- run tests/components/moderation/AdminPostActions.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/moderation/AdminPostActions.tsx frontend/tests/components/moderation/AdminPostActions.test.tsx
git commit -m "feat: add in-place AdminPostActions moderation menu"
```

---

### Task 8: Wire actions into the feed (FeedItem + Feed + HomePage + CSS)

**Files:**
- Modify: `frontend/src/components/FeedItem.tsx`
- Modify: `frontend/src/components/Feed.tsx`
- Modify: `frontend/src/pages/HomePage.tsx`
- Modify: `frontend/src/styles/theme.css`
- Test: `frontend/tests/components/FeedItem.test.tsx`, `frontend/tests/components/Feed.test.tsx`, `frontend/tests/pages/HomePage.test.tsx`

**Interfaces:**
- Consumes: `AdminPostActions` (Task 7), `useFeed().removePost` (Task 5), `useAuth`, `Role`.
- Produces: `FeedItem` accepts `{ post: FeedPost; canModerate?: boolean; onRemove?: (hash: string) => void }`; `Feed` accepts `{ after?: string; canModerate?: boolean }`.

- [ ] **Step 1: Write failing FeedItem tests** — add to `frontend/tests/components/FeedItem.test.tsx`

```tsx
it('shows no admin actions by default', () => {
  render(<FeedItem post={post()} />, { wrapper: MemoryRouter });
  expect(screen.queryByRole('button', { name: /more actions/i })).toBeNull();
});

it('shows the admin actions kebab when canModerate', () => {
  render(
    <NoticeProvider>
      <FeedItem post={post()} canModerate onRemove={() => {}} />
    </NoticeProvider>,
    { wrapper: MemoryRouter },
  );
  expect(screen.getByRole('button', { name: /more actions for funny cat/i })).toBeTruthy();
});

it('removes the item after a successful deactivate', async () => {
  const onRemove = vi.fn();
  vi.spyOn(ModerationApi, 'deactivate').mockResolvedValue({
    ok: true,
    row: { hash: 'abc1234567', thumbnail: null, title: null, type: null, username: null, createdAt: null, activatedAt: null, deletedAt: null },
  });
  render(
    <NoticeProvider>
      <FeedItem post={post()} canModerate onRemove={onRemove} />
    </NoticeProvider>,
    { wrapper: MemoryRouter },
  );
  fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
  fireEvent.click(screen.getByRole('menuitem', { name: /^deactivate$/i }));
  await waitFor(() => expect(onRemove).toHaveBeenCalledWith('abc1234567'));
});
```

Add the needed imports to the test file: `fireEvent`, `waitFor`, `vi` from vitest/testing-library, `NoticeProvider`, and `ModerationApi`. Add the `showModal` polyfill block (copy from AdminPostActions test) since the delete path may use a dialog in other suites — harmless here.

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend test -- run tests/components/FeedItem.test.tsx`
Expected: FAIL — no kebab rendered / props unknown.

- [ ] **Step 3: Implement `FeedItem.tsx`**

```tsx
import { Link } from 'react-router-dom';

import type { FeedPost } from '../lib/feedModel';
import AdminPostActions from './moderation/AdminPostActions';
import MemeMedia from './MemeMedia';
import PostByline from './PostByline';

type FeedItemProps = {
  post: FeedPost;
  // Admin-only in-place moderation (default off): the parent decides eligibility.
  canModerate?: boolean;
  onRemove?: (hash: string) => void;
};

// One feed entry: title + media. The title links to the meme's /posts/{hash} permalink
// (US2, FR-007). Admins additionally get the moderation kebab in the header's top-right;
// any action that hides or removes the meme drops it from the feed (it is no longer public).
function FeedItem({ post, canModerate = false, onRemove }: FeedItemProps) {
  const title = post.title ?? 'Untitled meme';
  function drop(): void {
    onRemove?.(post.hash);
  }
  return (
    <article className="feed-item">
      <div className="feed-item__header">
        <h2 className="feed-item__title">
          <Link to={post.permalink}>{title}</Link>
        </h2>
        {canModerate && (
          <AdminPostActions
            hash={post.hash}
            title={post.title}
            hidden={post.hidden}
            onApplied={(hidden) => { if (hidden !== null) { drop(); } }}
            onRemoved={drop}
          />
        )}
      </div>
      <MemeMedia media={post.media} linkTo={post.permalink} />
      <PostByline author={post.author} createdAt={post.createdAt} />
    </article>
  );
}

export default FeedItem;
```

- [ ] **Step 4: Write failing Feed/HomePage tests**

Read `frontend/tests/components/Feed.test.tsx` and `frontend/tests/pages/HomePage.test.tsx` for their existing `Api.fetchFeed` mocks and render helpers. Feed's existing tests pass no auth and must keep passing (Feed defaults `canModerate` to false). Add a HomePage test asserting that with an admin auth context the feed items show the kebab. Because HomePage will read `useAuth`, wrap it in a lightweight `AuthContext.Provider` (NOT `AuthProvider`, which fetches):

```tsx
import { AuthContext } from '../../src/hooks/useAuth';
// ...
function adminAuth(): AuthContextValue { /* status:'authenticated', role:'admin', user, no-op fns */ }

it('shows admin actions on feed items for an admin', async () => {
  vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: [/* one post */] });
  render(
    <AuthContext.Provider value={adminAuth()}>
      <NoticeProvider>
        <MemoryRouter><HomePage /></MemoryRouter>
      </NoticeProvider>
    </AuthContext.Provider>,
  );
  expect(await screen.findByRole('button', { name: /more actions/i })).toBeTruthy();
});
```

(If HomePage.test already has an auth wrapper helper, reuse it. Fill in the `AuthContextValue` fields from `frontend/src/hooks/useAuth.ts`: `status`, `user`, `role`, and the four async no-ops `register`/`login`/`logout`/`refresh`.)

- [ ] **Step 5: Implement `Feed.tsx` and `HomePage.tsx`**

`Feed.tsx` — accept `canModerate`, pull `removePost`, pass both down:

```tsx
function Feed({ after, canModerate = false }: { after?: string; canModerate?: boolean }) {
  // ...existing body...
  const { state, load, atPageBreak, canAutoLoad, removePost } = useFeed(after, cacheKey, fresh);
  // ...
        {state.posts.map((post) => (
          <li key={post.hash} data-hash={post.hash}>
            <FeedItem post={post} canModerate={canModerate} onRemove={removePost} />
          </li>
        ))}
  // ...
}
```

`HomePage.tsx` — compute `canModerate` from auth and pass it:

```tsx
import { useAuth } from '../hooks/useAuth';
import { Role } from '../lib/role';
// ...
function HomePage() {
  const { role } = useAuth();
  const canModerate = Role.rank(role) >= Role.rank('admin');
  // ...
  return (
    <section aria-label="Memes">
      <Feed key={location.key} after={after} canModerate={canModerate} />
    </section>
  );
}
```

- [ ] **Step 6: Add the CSS** — append to `frontend/src/styles/theme.css` near the feed-item block

```css
/* Header row: the entry title on the left, the admin actions kebab pinned top-right.
   The title keeps its own padding; the actions get matching top/right padding so the
   kebab lines up with the title's first line. Non-admins see just the title here. */
.feed-item__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-sm);
}

.post-actions {
  padding: var(--space-md) var(--space-md) 0 0;
  flex-shrink: 0;
}
```

- [ ] **Step 7: Run the feed tests**

Run: `npm --prefix frontend test -- run tests/components/FeedItem.test.tsx tests/components/Feed.test.tsx tests/pages/HomePage.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/FeedItem.tsx frontend/src/components/Feed.tsx frontend/src/pages/HomePage.tsx frontend/src/styles/theme.css frontend/tests/components/FeedItem.test.tsx frontend/tests/components/Feed.test.tsx frontend/tests/pages/HomePage.test.tsx
git commit -m "feat: show admin moderation actions on feed items"
```

---

### Task 9: Wire actions into the single-post page

**Files:**
- Modify: `frontend/src/pages/PostPage.tsx`
- Test: `frontend/tests/pages/PostPage.test.tsx`

**Interfaces:**
- Consumes: `AdminPostActions` (Task 7), `usePost().applyModeration` (Task 6), `useAuth`, `Role`, `useNavigate`.

- [ ] **Step 1: Write failing tests** — add to `frontend/tests/pages/PostPage.test.tsx`

The existing `renderPost` uses a bare `MemoryRouter`. Add an admin-aware variant that wraps in `AuthContext.Provider` + `NoticeProvider`, and keep the default (non-admin) path for existing tests. Add the `showModal` polyfill block.

```tsx
function renderAdminPost(post: FeedPost, hash = 'abc1234567') {
  vi.spyOn(Api, 'fetchPost').mockResolvedValue({ ok: true, post });
  render(
    <AuthContext.Provider value={adminAuth()}>
      <NoticeProvider>
        <MemoryRouter initialEntries={[`/posts/${hash}`]}>
          <Routes>
            <Route path="/posts/:hash" element={<PostPage />} />
            <Route path="/" element={<h1>Home</h1>} />
          </Routes>
        </MemoryRouter>
      </NoticeProvider>
    </AuthContext.Provider>,
  );
}

it('shows no admin actions for an anonymous viewer', async () => {
  vi.spyOn(Api, 'fetchPost').mockResolvedValue({ ok: true, post });
  renderPost();
  await screen.findByRole('heading', { name: 'Funny cat' });
  expect(screen.queryByRole('button', { name: /more actions/i })).toBeNull();
});

it('lets an admin deactivate, flipping the post to the pending banner', async () => {
  vi.spyOn(ModerationApi, 'deactivate').mockResolvedValue({
    ok: true,
    row: { hash: 'abc1234567', thumbnail: null, title: null, type: null, username: null, createdAt: null, activatedAt: null, deletedAt: null },
  });
  renderAdminPost(post);
  await screen.findByRole('heading', { name: 'Funny cat' });
  fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
  fireEvent.click(screen.getByRole('menuitem', { name: /^deactivate$/i }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/pending review/i));
});

it('navigates home after an admin permanently deletes the post', async () => {
  vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: true });
  renderAdminPost({ ...post, hidden: 'deleted' });
  await screen.findByRole('heading', { name: 'Funny cat' });
  fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
  fireEvent.click(screen.getByRole('menuitem', { name: /^delete$/i }));
  const dialog = document.querySelector('dialog') as HTMLDialogElement;
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Home' })).toBeTruthy());
});
```

Add imports: `within`, `ModerationApi`, `NoticeProvider`, `AuthContext`, and an `adminAuth()` helper (same shape as Task 8).

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend test -- run tests/pages/PostPage.test.tsx`
Expected: FAIL — no kebab / no navigation.

- [ ] **Step 3: Implement `PostPage.tsx`**

Add imports and render the actions in the loaded branch's header:

```tsx
import { useNavigate, useParams } from 'react-router-dom';

import AdminPostActions from '../components/moderation/AdminPostActions';
import { useAuth } from '../hooks/useAuth';
import { Role } from '../lib/role';
```

Inside the component:

```tsx
  const navigate = useNavigate();
  const { role } = useAuth();
  const { state, retry, applyModeration } = usePost(hash);
  const canModerate = Role.rank(role) >= Role.rank('admin');
```

In the loaded branch, wrap the h1 in the shared header and add the menu:

```tsx
        <article className="post-item feed-item">
          {state.post.hidden && <HiddenNotice status={state.post.hidden} />}
          <div className="feed-item__header">
            <h1 className="feed-item__title">{state.post.title ?? 'Untitled meme'}</h1>
            {canModerate && (
              <AdminPostActions
                hash={state.post.hash}
                title={state.post.title}
                hidden={state.post.hidden}
                onApplied={applyModeration}
                onRemoved={() => navigate('/')}
              />
            )}
          </div>
          <MemeMedia media={state.post.media} />
          <PostByline author={state.post.author} createdAt={state.post.createdAt} />
        </article>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix frontend test -- run tests/pages/PostPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/PostPage.tsx frontend/tests/pages/PostPage.test.tsx
git commit -m "feat: show admin moderation actions on the post page"
```

---

### Task 10: Full gate — lint, typecheck, full test + coverage

**Files:** none (verification only).

- [ ] **Step 1: Lint**

Run: `npm --prefix frontend run lint`
Expected: no errors.

- [ ] **Step 2: Full test suite with coverage**

Run: `npm --prefix frontend run test:coverage` (or the project's coverage script; check `frontend/package.json`).
Expected: all green; total line coverage ≥90%. If any new file dips below, add the missing-branch test in its `*.test.tsx` and re-run.

- [ ] **Step 3: Dispatch the commit-quality-verifier**

Per project convention, dispatch the `commit-quality-verifier` agent over the branch diff; proceed only on PASS. Fix any findings, then re-run this task.

- [ ] **Step 4: Final commit if any fixes were made**

```bash
git add -A
git commit -m "test: close coverage gaps for in-place admin post actions"
```

---

### Task 11: E2E coverage (optional locally; runs in CI)

**Files:**
- Create: `frontend/tests/e2e/admin-feed-actions.spec.ts`

**Interfaces:** follows the existing `frontend/tests/e2e/admin-action-menus.spec.ts` patterns (login as a seeded admin, open the feed, operate the kebab).

- [ ] **Step 1: Write the spec** — mirror `admin-action-menus.spec.ts`: sign in as an admin, load `/`, open a feed item's "More actions" menu, click Deactivate, assert the item disappears from the feed. Add a post-page case: open `/posts/{hash}`, open the menu, Deactivate, assert the pending banner appears.

- [ ] **Step 2: Run locally only if the e2e stack is up** (`docker-compose.e2e.yml`); otherwise rely on CI's `e2e` job.

Run: `npm --prefix frontend run test:e2e -- admin-feed-actions` (only if the stack is running).

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/e2e/admin-feed-actions.spec.ts
git commit -m "test(e2e): cover in-place admin feed and post actions"
```

---

## Self-Review

**Spec coverage:**
- State→menu mapping → Tasks 2 (derive) + 7 (build/behaviour). ✓
- No backend work → confirmed; no backend task. ✓
- `AdminPostActions` component → Task 7. ✓
- Shared glyphs → Task 1. ✓
- Feed removal → Tasks 3 (reducer), 5 (hook), 8 (wire). ✓
- Post-page in-place refresh + navigate-home on purge → Tasks 4 (reducer), 6 (hook), 9 (wire). ✓
- Positioning/CSS → Task 8. ✓
- Admin gating → Tasks 8 (HomePage) + 9 (PostPage); component itself is parent-gated. ✓
- Accessibility (inherited ARIA) → Task 7 reuses ActionMenu. ✓
- Testing across all surfaces → Tasks 1–9 each add tests; Task 10 gate; Task 11 e2e. ✓

**Placeholder scan:** the only intentionally-deferred detail is reusing each hook test's existing mock/render helpers (Tasks 5, 6) rather than duplicating them here — the assertion and the call under test are given explicitly; the implementer reads the file's top for the shared harness. No "TODO"/"handle edge cases" placeholders in implementation code.

**Type consistency:** `hidden: 'pending' | 'deleted' | null` used identically across `FeedPost`, `AdminPostActionsProps`, `applyModeration`, and `ModerationModel.hiddenFromRow`. `removePost(hash)`/`onRemove(hash)` and `onApplied(hidden)`/`onRemoved()` names match across producer and consumer tasks. `ActionGlyphName` replaces the old local `ActionGlyph` type. ✓
