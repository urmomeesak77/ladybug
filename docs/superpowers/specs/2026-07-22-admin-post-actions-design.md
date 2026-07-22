# Admin post actions on the feed and single-post page

**Date:** 2026-07-22
**Status:** Approved-to-build (user asked to proceed without gating)

## Problem

Admins can moderate memes only from the back-office console (`/admin/trashposts`).
When an admin is browsing the public site — the Home feed or a single meme's
permalink page — there is no way to act on a bad meme in place. They must copy the
hash, open the console, find the row, and act there.

This feature puts the same per-row moderation actions the console already offers into
the **top-right corner of every feed item** and **on the dedicated post page**, behind
the same shared kebab menu the admin consoles use (013). Admins get one-click
Activate / Deactivate / Delete / Restore right where they see the meme; nothing changes
for guests or members, who never see the control.

## Scope

- **In:** a reusable admin-only actions menu on `FeedItem` and `PostPage`; feed-item
  removal and post-page state refresh after an action; sharing the console's action
  icons.
- **Out:** any new backend surface (all endpoints exist), comments, and any change to
  the console itself.

## Why no backend work

Everything needed already ships:

- `POST /api/admin/posts/{hash}/activate|deactivate|restore`, `DELETE .../{hash}`
  (soft), `DELETE .../{hash}/purge` (hard) — all admin-gated, all wired in
  `frontend/src/lib/moderationApi.ts` (`ModerationApi`), each non-purge action
  returning the updated row (`activated_at` / `deleted_at`), purge returning `204`.
- `GET /api/posts/{hash}` already returns a meme in **any** state to an admin, carrying
  a coarse `hidden` field (`'pending' | 'deleted' | null`) via
  `TrashpostResource::hiddenStatus()`. The feed (`GET /api/posts`) returns only
  activated, non-trashed memes, so `hidden` there is always `null`.

So the client already knows each meme's moderation state from `hidden`, and already has
a typed client for every action. This feature is **frontend presentation only**.

## State → menu mapping

The meme's `hidden` value drives the menu, mirroring the console's
`activatedAt`/`deletedAt` logic (`ModerationActions`):

| `hidden`    | meaning                    | menu items                          |
|-------------|----------------------------|-------------------------------------|
| `null`      | activated, not trashed     | Deactivate, Delete                  |
| `'pending'` | not activated (live)       | Activate, Delete                    |
| `'deleted'` | soft-deleted               | Restore, Delete (permanent, danger) |

- **Delete** on a live meme (`null` / `'pending'`) opens the existing soft-vs-permanent
  confirm; **Delete** on a `'deleted'` meme opens the permanent-only confirm — the same
  `ModerationModel.deleteConfirmMessage` / `purgeConfirmMessage` copy and the same
  `useNotice().ask` dialog the console uses.
- Activate / Deactivate / Restore run immediately (no confirm), matching the console.

Because the feed only ever shows `hidden === null` memes, feed items only ever offer
**Deactivate** and **Delete** in practice; the full mapping matters on the post page.

## Components

### `AdminPostActions` (new) — `components/moderation/AdminPostActions.tsx`

The one reusable control both surfaces render. Props:

```ts
{
  hash: string;
  title: string | null;
  hidden: 'pending' | 'deleted' | null;
  onApplied: (hidden: 'pending' | 'deleted' | null) => void; // action changed the state
  onRemoved: () => void;                                       // meme was purged (gone)
}
```

- Builds the `ActionMenuItem[]` from `hidden`, using `ModerationApi` for IO and the
  shared action glyphs.
- On a successful non-purge action it derives the new `hidden` from the returned row
  (`deleted_at !== null → 'deleted'`, else `activated_at === null → 'pending'`, else
  `null`) and calls `onApplied(newHidden)`. On a successful purge it calls `onRemoved()`.
  Any failed action leaves everything untouched (no callback), exactly like the console.
- Renders through the shared `ActionMenu` (kebab trigger + WAI-ARIA menu +
  `useMenuKeyboard`); `label` is `More actions for {title ?? 'this post'}`.
- **Not self-gating on role** — the parent decides whether to render it (keeps the
  component dumb and its tests role-free). The server enforces admin on the data
  regardless.

The derive-hidden helper lives as a `static` method on the existing `ModerationModel`
(`ModerationModel.hiddenFromRow`, `lib/moderationModel.ts`) so it is unit-testable without
a DOM and mirrors the backend's `hiddenStatus()`. The menu-item builder stays inline in
`AdminPostActions.tsx` as a `PostActionMenu` class of statics (it produces JSX
`ActionMenuItem`s, so it belongs with the component, matching `ModerationMenu` in
`ModerationActions.tsx`) — no separate `lib/postModerationModel.ts` module was needed.

### Shared action glyphs — `components/moderation/ActionGlyph.tsx` (extracted)

`ModerationActions` currently owns the four SVG glyphs (`activate` / `deactivate` /
`delete` / `restore`) and the `ActionIcon` component inline. Extract them into this
module so both `ModerationActions` and `AdminPostActions` import the same icons; update
`ModerationActions` to import from here (behaviour unchanged).

### `FeedItem` (changed)

Wrap the title and the actions in a `feed-item__header` flex row (title left, kebab
right). Render `AdminPostActions` only when the viewer is admin+. The feed passes down
`canModerate` and an `onRemovePost(hash)` callback; a successful action that hides or
removes the meme drops it from the feed (a deactivated/deleted meme is no longer public,
so leaving a live-looking card would mislead). `onApplied` therefore removes the item
whenever the new `hidden` is non-null; `onRemoved` removes it too.

### `PostPage` (changed)

Wrap the `h1` and the actions in the same header row. Render `AdminPostActions` when the
viewer is admin+ (compute `canModerate` from `useAuth`). `onApplied(hidden)` updates the
loaded post's `hidden` in place — re-rendering `HiddenNotice` and the menu to the new
state — via a new `applyModeration` action on the post reducer. `onRemoved` (purge)
navigates to `/` with `useNavigate`, since the permalink no longer resolves.

## State plumbing

- **Feed:** add a `removePost` action to `Pagination.reducer`
  (`posts.filter(p => p.hash !== hash)`), expose `removePost(hash)` from `useFeed`, and
  thread it Feed → FeedItem → `AdminPostActions`. The existing snapshot effect persists
  the shortened list, so Back/refresh does not resurrect the removed card.
- **Post page:** add `applyModeration` to `PostModel.reducer` — on a `loaded` state it
  returns `{ status: 'loaded', post: { ...post, hidden } }`; a no-op in any other state.
  Expose it from `usePost`.

## Positioning & styling

- `.feed-item` gets `position: relative` is **not** needed — the header is a normal flex
  row, so the kebab sits inline at the top-right with no absolute positioning. Add
  `.feed-item__header { display: flex; align-items: flex-start; justify-content:
  space-between; gap: var(--space-sm); }` and move the title's padding onto the header so
  the kebab lines up with the title. The `.action-menu` panel floats below the trigger
  (`right: 0`) as it already does in the console; with typical media-bearing cards it
  opens over the media and is never clipped by the card's `overflow: hidden`.
- The kebab reuses `.action-menu__trigger` styling unchanged; no new colours.

## Accessibility

Inherits the console's WAI-ARIA menu-button pattern verbatim (trigger
`aria-haspopup="menu"` / `aria-expanded` / text `aria-label`, `role="menuitem"` items
with text labels, keyboard operation, four-way dismissal). Icons stay decorative
(`aria-hidden`); the text label always carries the meaning. `HiddenNotice` already
announces a hidden post's state politely on the post page.

## Testing

Frontend Vitest (the ≥90% line-coverage gate spans all of `src/`):

- `lib/postModerationModel.test.ts` — derive-hidden for every row shape; menu-item
  builder produces the right labels/handlers per `hidden`.
- `components/moderation/AdminPostActions.test.tsx` — items per state; each action calls
  the right `ModerationApi` method; confirm dialogs for Delete/permanent; `onApplied`
  with the derived hidden; `onRemoved` on purge; failed action → no callback; empty when
  not rendered by parent.
- `components/moderation/ActionGlyph.test.tsx` — renders each glyph decoratively.
- `components/FeedItem.test.tsx` — menu shown only when `canModerate`; a successful
  hide/remove calls `onRemovePost`.
- `pages/PostPage.test.tsx` — menu shown for admin only; `applyModeration` flips the
  `HiddenNotice`; purge navigates home.
- `lib/pagination.test.ts` — `removePost` drops the named post, no-op when absent.
- `lib/postModel.test.ts` — `applyModeration` updates hidden only from `loaded`.
- `hooks/useFeed.test.tsx` / `hooks/usePost.test.tsx` — the new exposed actions.

An e2e Playwright spec (`admin-feed-actions.spec.ts`) covers an admin deactivating a feed
item and seeing it disappear, in the spirit of the existing `admin-action-menus.spec.ts`.

## Risks / decisions

- **Feed removal vs in-place update:** removal chosen because a feed item has no hidden
  badge and every feed-available action makes the meme non-public; a lingering live-looking
  card would mislead. Re-activation/restore of a feed item is done from the console or the
  post page (both still reachable).
- **Panel clipping under `overflow: hidden`:** acceptable — real memes carry tall media,
  so the two-item panel never reaches the card's bottom edge. If a text-only/short card
  ever clips, that is a follow-up, not a blocker.
