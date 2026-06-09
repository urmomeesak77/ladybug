# Phase 1 Data Model: Frontend Mainpage

The frontend persists nothing. This is the **view model** — the TypeScript shapes the UI
consumes and the rules for deriving display values from the 004 feed API response.

## Source: feed API `<Post>` (from 004)

`GET /api/posts` returns `{ "data": Post[] }`. Fields consumed by the mainpage (see
[contracts/feed-api-consumption.md](./contracts/feed-api-consumption.md) for the full
mapping):

| API field | Type | Mainpage use |
|-----------|------|--------------|
| `hash` | string | Opaque public id; permalink `/posts/{hash}`; keyset cursor for paging. |
| `title` | string\|null | Heading + image `alt`; falls back to a generic label when null. |
| `youtube` | string\|null | Parsed to a safe embed URL (or ignored if unparseable). |
| `default` | string\|null | `<img src>` (preferred size). |
| `sizes` | `{url,width}[]` | `<img srcset>` candidates (widest-first; existing files only). |
| `original` | string\|null | Last-resort image source if `default` is null. |
| `url` | string | Frontend deep link `/posts/{hash}` (relative). |
| `id`, `type`, `user_id`, `username`, `comment`, `metadata`, timestamps, `url_api`, `activated_at`, `deleted_at` | — | Not rendered on the mainpage (may be read for diagnostics only). |

## View model types (`src/lib/feedModel.ts`)

```ts
export type ImageSize = { url: string; width: number };

export type FeedMediaKind = 'image' | 'youtube' | 'none';

export type FeedPost = {
  hash: string;            // opaque; used in the permalink + cursor
  title: string | null;
  permalink: string;       // `/posts/${hash}`
  media: FeedMedia;        // derived, see below
};

export type FeedMedia =
  | { kind: 'image'; src: string; srcset: string; sizes: string; alt: string }
  | { kind: 'youtube'; embedUrl: string; title: string }
  | { kind: 'none' };      // link/text-only post → render title + graceful fallback
```

### Derivation rules (`mapPost`)

- **Media precedence**: if a parseable `youtube` exists ⇒ `kind: 'youtube'`; else if an
  image source resolves (`default` ?? widest `sizes` ?? `original`) ⇒ `kind: 'image'`;
  else ⇒ `kind: 'none'`.
- **`srcset`**: join `sizes` as `"{url} {width}w"`, widest-first; omit when empty.
- **`alt`**: `title` when present, else a generic non-empty description (never empty —
  Principle IV / FR-012).
- **`embedUrl`**: from `src/lib/youtube.ts` (returns `null` ⇒ treat as not-youtube).
- Never fabricate a URL: only values present in the API response are used (Principle VI).

## Pagination model (`src/lib/pagination.ts`)

| Concept | Value | Rule |
|---------|-------|------|
| Batch size | 10 | `limit=10` per request. |
| Page break | 200 | After 200 loaded entries on the current page, stop auto-loading; show "Load more". |
| In-page cursor | last loaded `hash` | Next auto-batch uses `start=<lastHash>`. |
| Page cursor | URL `after` param | The `hash` that begins the current page (absent ⇒ newest page). |
| End of feed | empty/short batch | A batch with fewer than `limit` items (or empty) ⇒ no more data. |

State machine (per page): `idle → loading → loaded`(+`hasMore`)` → loadingMore …`;
terminal `end` (no more) or `error` (retryable, keeps loaded items). Guards prevent a new
fetch while one is in flight (FR-015).

## Feed UI states (`src/components/states/`)

| State | When | Shown |
|-------|------|-------|
| Loading | first batch in flight | skeleton/spinner with accessible label |
| Empty | first batch returns `[]` | clear empty message |
| EndOfFeed | `hasMore` false after some items | subtle "you've reached the end" |
| Error | a batch request fails | message + Retry; previously loaded items remain |
| LoadMore | 200-entry page break reached | "Load more" link advancing the URL `after` |

## Route model

| Route | Component | Notes |
|-------|-----------|-------|
| `/` (optional `?after=<hash>`) | `HomePage` | The feed; `after` selects the page. |
| `/posts/:hash` | `PostPlaceholderPage` | Placeholder until the single-meme feature ships. |

See [contracts/routes.md](./contracts/routes.md).
