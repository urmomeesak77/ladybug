# Data Model: YouTube Shorts Support

No new entity. This feature extends the existing **Trashpost** row with one derived,
render-only fact; nothing else in the schema changes.

## Trashpost (existing — extended)

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `youtube` | `string` | yes | **Unchanged.** Still the bare 11-char extracted video id — a Shorts-sourced post is stored through the exact same field as any other YouTube post (spec Key Entities). |
| `youtube_is_short` | `boolean` | no, default `false` | **New.** Set once, at creation (`TrashpostService::reserve()`), from `Youtube::isShort()` applied to the *raw* submitted `youtube` field — the only moment the original URL shape is available before it's discarded down to a bare id. Never updated afterward (immutable, like `youtube` itself). `false` for every non-YouTube post and every non-Shorts YouTube post (including all pre-existing rows, via the column default — no backfill migration needed since the default is the correct historical value). |

**Migration**: new file, e.g. `2026_08_06_000000_add_youtube_is_short_to_trashposts_table.php`:

```php
Schema::table('trashposts', function (Blueprint $table) {
    $table->boolean('youtube_is_short')->default(false)->after('youtube');
});
```

No index needed — the column is never queried/filtered on, only read back for display.

### Validation rules

- Set exactly once, at row-reservation time, alongside `type` and `youtube`
  (`TrashpostService::reserve()`); not part of `$fillable` (same non-mass-assignment
  guard already documented for `type`/`youtube`/`hash`/`user_id`).
- Derived, not user-supplied directly: the boundary validation is still "does the
  `youtube` field parse to a real id" (`CreatePostRequest`); `youtube_is_short` is a
  pure function of the *already-validated* raw input, never trusted on its own.
- Meaningless (and always `false`) on `image`/`video`-type posts.

### State transitions

None — immutable once written, same as `youtube` and `type`. No moderation action,
edit, or re-upload flow in this codebase mutates a post's media source.

## API surface (existing resource, one field added)

`TrashpostResource::toArray()` (`GET /api/posts`, `GET /api/posts/{hash}`, and the
`201` response from `POST /api/posts`) gains:

```json
{
  "youtube": "dQw4w9WgXcQ",
  "youtube_is_short": true
}
```

placed next to the existing `youtube` field. No other resource (`AdminTrashpostResource`,
etc.) is in scope — the spec's playback/preview requirements (FR-005, FR-006, FR-007)
only touch public feed and single-post rendering.

## Frontend shapes (existing types, extended)

`frontend/src/lib/feedModel.ts`:

```ts
export type RawPost = {
  // ...unchanged fields...
  youtube: string | null;
  youtube_is_short: boolean;   // new
};

export type FeedMedia =
  // ...unchanged members...
  | { kind: 'youtube'; embedUrl: string; title: string; isShort: boolean };  // isShort added
```

`FeedModel.deriveMedia()` populates `isShort: raw.youtube_is_short` when it builds the
`youtube`-kind `FeedMedia` (the one call site, `feedModel.ts:162-165`). `PostPage`
consumes the same `FeedMedia` shape via `postModel.ts`, so no second mapping site
exists to keep in sync.
