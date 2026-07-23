# Comment count on feed items & post page — design

**Date:** 2026-07-23
**Status:** approved (design)

## Goal

Show, at the right end of the byline row on every meme card, a small speech-bubble
icon followed by the number of **public** (non-hidden) comments on that meme. This
appears in two places, both of which render the shared `.feed-item` card:

- the feed (`FeedItem`, on `HomePage`), and
- the single-meme page (`PostPage` at `/posts/{hash}`).

The count is **display-only** (no link, no interaction) and styled to match the
existing muted byline.

## Non-goals

- No admin-console change (`AdminTrashpostResource` is untouched).
- The count is not interactive and does not scroll to / open the comment section.
- No change to how comments themselves are listed, created, hidden, or deleted.

## Definition of the count

The number is the **public** comment total: `comments` rows with `hidden_at IS NULL`.
This is exactly the `total` that `CommentService::list()` already returns and that the
post page's `CommentSection` shows, so the byline count and the section header always
agree. The count is **not** viewer-aware — an admin (who can see hidden comments in the
list) still reads the same public number here.

## Backend

### `Trashpost` model — new scoped relation

Add a relation that bakes in the non-hidden constraint, so the count can be aggregated
with `withCount` and **without a closure**:

```php
public function publicComments(): HasMany {
    return $this->comments()->whereNull('hidden_at');
}
```

### `TrashpostService` — load the aggregate at both read sites

Add `->withCount('publicComments as comment_count')` to:

- `feed()` (the newest-first keyset page), and
- `findViewableByHash()` (the single-post query).

`withCount` compiles to a single correlated aggregate subquery, so the feed stays one
query with no N+1.

### `TrashpostResource` — emit the field

```php
'comment_count' => (int) ($this->comment_count ?? 0),
```

The `?? 0` fallback covers the freshly-created post returned by `store()` (which does
not run through a `withCount` query and has zero comments anyway — so `0` is correct).

## Frontend

### Data shape

- `RawPost` (in `feedModel.ts`) gains `comment_count: number`.
- `FeedPost` gains `commentCount: number`.
- `FeedModel.mapPost` maps `commentCount: raw.comment_count ?? 0`.

### New component: `CommentCount.tsx`

An in-house inline SVG speech-bubble (`aria-hidden="true"`, `focusable="false"`, filled
with `currentColor`, drawn in the same spirit as `ActionGlyph`) followed by the number,
wrapped in a `<span>` carrying a pluralized accessible label:

- `0` → `aria-label="0 comments"`
- `1` → `aria-label="1 comment"`
- `n` → `aria-label="{n} comments"`

The visible content is just the number; the icon is decorative and the `aria-label`
carries the meaning, so the badge is never icon-only (Principle IV — color/icon is never
the sole signal).

### `PostByline` — flex row

`PostByline` already renders in both `FeedItem` and `PostPage`, so it is the single
change point. It becomes a flex container (`.feed-item__meta`, `justify-content:
space-between`, `align-items: center`) holding the existing byline `<p>` on the left and
`<CommentCount count={commentCount} />` on the right. It takes a new `commentCount` prop;
`FeedItem` and `PostPage` pass `post.commentCount`.

The post page keeps its full `CommentSection` below the byline; the byline count is just
the at-a-glance number.

### CSS (`theme.css`)

- New `.feed-item__meta` wrapper carries the bottom padding (moved off `.feed-item__byline`),
  laid out as a space-between flex row.
- New `.feed-item__comment-count`: muted color (`--color-text-muted`), small font matching
  the byline, icon sized to the text with a small gap.

## Testing (≥90% line coverage, both stacks)

### Backend

- Feed and show responses include `comment_count`.
- The count **excludes hidden** comments (a post with some hidden + some visible reports
  only the visible ones).
- The count is unaffected by viewer role — an admin viewer reads the same public count.
- A post with no comments reports `0`.

### Frontend

- `FeedModel.mapPost` maps `comment_count` → `commentCount` (including the `?? 0` fallback).
- `CommentCount` renders the number, the correct pluralized `aria-label` (0 / 1 / n), and
  an `aria-hidden` icon.
- `PostByline` renders the byline text and the comment count together.

## Dependencies

None. No new npm or Composer packages.
