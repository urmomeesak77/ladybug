# Uploader byline on feed items and post page — design

**Date:** 2026-07-22
**Status:** approved (pending spec review)

## Goal

Show **who posted a meme and when** directly below its media, on both the main
feed (`FeedItem`) and the single-meme page (`PostPage`). The byline reads:

> by {author} · {date}

- **{author}** — the uploader's name, resolved as **live `users.name` when the
  post is still linked to an account, otherwise the frozen `trashposts.username`
  snapshot**, otherwise the literal `Anonymous` when neither is present.
- **{date}** — the post's creation date, formatted `Jul 22, 2026` (absolute,
  no time, locale-aware).

## Author resolution rule

The rule is already implemented in `AdminTrashpostResource::uploaderName()` and
is reused verbatim here:

```php
$this->user?->name ?? $this->username
```

- The post carries both `user_id` (FK to `users`) and a `username` string column.
- `username` was written as a snapshot of the uploader's name at creation time
  (`TrashpostService::reserve`), and legacy/prototype rows carry a free-text name
  with no matching `users` row.
- When the account still exists, its **current** `name` is shown (so a rename is
  reflected). When the post is orphaned (`user_id` null after a 013 hard delete)
  or is a legacy row, the `username` snapshot is shown.
- When both are null (anonymous upload / orphaned with null username), the
  frontend substitutes `Anonymous`.

## Backend changes

### `TrashpostResource`

- Replace the raw `'username' => $this->username` with a resolved display name via
  a private `authorName(): ?string` returning `$this->user?->name ?? $this->username`
  (mirrors `AdminTrashpostResource::uploaderName`). The response field stays named
  `username` — it now always holds the resolved display name (or null).
- `created_at` is **already** exposed by the resource; no change needed. It stays a
  raw ISO timestamp and the frontend formats it.

### `TrashpostService`

- Eager-load the `user` relation on both read paths so resolving `user?->name`
  across a page does not trigger an N+1:
  - `feed()` — add `->with('user')` to the builder.
  - `findViewableByHash()` — load the row with its `user` relation.
- No change to the query's visibility/keyset semantics.

## Frontend changes

### `lib/feedModel.ts`

- `RawPost` gains `username: string | null` and `created_at: string | null`.
- `FeedPost` gains `author: string | null` and `createdAt: string | null`.
- `FeedModel.mapPost` maps `raw.username → author` and `raw.created_at → createdAt`
  (pass-through; no reshaping).

### `lib/postDate.ts` (new)

- A single class `PostDate` of `static` methods (per conventions: one class per
  `lib/` module, static methods).
- `PostDate.format(iso: string | null): string | null` — parses the ISO string and
  formats it as `Jul 22, 2026` via `Intl.DateTimeFormat` (`{ year: 'numeric',
  month: 'short', day: 'numeric' }`). Returns null for null/blank/unparseable input
  (so the byline can omit the date rather than print `Invalid Date`).

### `components/PostByline.tsx` (new)

- Props: `{ author: string | null; createdAt: string | null }`.
- Renders a `<p className="feed-item__byline">` containing:
  - `by {author ?? 'Anonymous'}`
  - a `·` separator and the formatted date, **only when** `PostDate.format(createdAt)`
    is non-null.
- Author name is rendered as text (React escapes it); no HTML injection risk.
- The `·` is decorative punctuation inside the text line, not a standalone control.

### `components/FeedItem.tsx`

- Render `<PostByline author={post.author} createdAt={post.createdAt} />` below
  `<MemeMedia>`, inside the existing `<article>`.

### `pages/PostPage.tsx`

- Render the same `<PostByline>` below `<MemeMedia>` in the loaded branch.

### CSS

- Add `.feed-item__byline` styling: muted/secondary text color (theme-aware via the
  existing color-scheme variables), small font size, modest top margin. Color is not
  the sole signal — it is plain text content.

## Testing (TDD)

- **`TrashpostResourceTest`** — assert `username` resolves to the linked account's
  live name when a `user` is attached, and falls back to the `username` column when
  `user_id` is null. Assert `created_at` is present.
- **`TrashpostServiceTest`** — assert the feed eager-loads `user` (relation loaded
  on returned models) so the resource does not lazy-load per row.
- **`feedModel` test** — `mapPost` carries `author` and `createdAt` through.
- **`PostDate` test** — formats a known ISO date to `Jul 22, 2026`; returns null for
  null/blank/garbage.
- **`PostByline` test** — renders `by {name} · {date}`; substitutes `Anonymous` for a
  null author; omits the date (and its separator) when the date is null.
- **`FeedItem` / `PostPage` tests** — the byline appears below the media with the
  expected author and date.

Coverage stays ≥90% on both stacks (all new modules are directly tested).

## Out of scope

- No API surface for a *clickable* author (no user profile pages exist).
- No change to upload, moderation, or admin resources.
- No new dependency (Intl is a platform built-in).
