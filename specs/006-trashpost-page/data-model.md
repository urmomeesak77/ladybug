# Data Model: Trashpost Page (Single Meme View)

**Feature**: 006-trashpost-page | **Date**: 2026-06-12

This feature adds no backend entities and no storage. The frontend data model is the
existing 005 view model plus one new client-side state machine for the page lifecycle.

## Entities

### Post (view model) — reused from 005, unchanged

The single post is the same `FeedPost` produced by `mapPost(raw: RawPost)` in
`frontend/src/lib/feedModel.ts`, fed by the `<Post>` object from
`GET /api/posts/{hash}` (see `specs/004-read-feed-api/contracts/feed-api.md`).

| Field | Type | Source / rule |
|-------|------|---------------|
| `hash` | `string` | Public 10-char code; opaque on the client (research D11). |
| `title` | `string \| null` | Shown as the page heading; drives document title and image alt (with fallbacks). |
| `permalink` | `string` | `/posts/{hash}` (informational here — the page is already at it). |
| `media` | `FeedMedia` | Derived once in `mapPost`, exactly as on the mainpage. |

`FeedMedia` (discriminated union, unchanged):

- `{ kind: 'image', src, srcset, sizes, alt, width?, height? }` — `src` from `default` →
  widest declared size → `original` (never fabricated); `srcset` only from API-declared
  `sizes`; `alt` = title or the fixed fallback `"Meme image"` (FR-012); intrinsic
  `width`/`height` parsed from `metadata` when present.
- `{ kind: 'youtube', embedUrl, title }` — `embedUrl` only from the in-house parser
  (Principle VI).
- `{ kind: 'none' }` — post has neither usable image nor recognized YouTube reference;
  the page still renders its title coherently (FR-013).

### PostResult (API boundary) — new, in `frontend/src/lib/api.ts`

```ts
type PostError = { kind: 'notFound' | 'http' | 'network'; status?: number };

type PostResult =
  | { ok: true; post: FeedPost }
  | { ok: false; error: PostError };
```

Mapping rules (research D1): HTTP 404 → `notFound` (unknown, hidden, and removed posts
are indistinguishable, FR-006); any other non-2xx → `http` (retryable); rejected fetch →
`network` (retryable).

### PostPageState (state machine) — new, in `frontend/src/lib/postModel.ts`

```ts
type PostPageState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; post: FeedPost }
  | { status: 'notFound' }
  | { status: 'error' };
```

Actions: `loadStart`, `loadSuccess(post)`, `loadNotFound`, `loadError`.

## State transitions

| From \ Action | `loadStart` | `loadSuccess` | `loadNotFound` | `loadError` |
|---------------|-------------|---------------|----------------|-------------|
| `idle` | `loading` | — | — | — |
| `loading` | `loading` | `loaded(post)` | `notFound` | `error` |
| `loaded` | `loading` ¹ | `loaded(post)` ² | `notFound` | `error` |
| `notFound` | `loading` ³ | `loaded(post)` | `notFound` | `error` |
| `error` | `loading` ⁴ | `loaded(post)` | `notFound` | `error` |

¹ Navigating to a different meme's address (hash change) restarts the cycle; the previous
meme's content is dropped immediately so it can never bleed into the next view (spec edge
case "Navigating between memes").

² A success while already loaded replaces the post (latest result wins; the hook
additionally discards responses for a hash that is no longer current — research D9).

³ A hash change away from a dead link starts a fresh load; `notFound` is never sticky.

⁴ Retry: leaving `error` for `loading` clears the stale error messaging before the new
result lands (spec edge case "Repeated retry", SC-008).

Invariants encoded by the machine:

- The not-found view is reachable **only** from a completed response (`loadNotFound`),
  never as a default — so it cannot flash while loading (spec edge case "Slow load").
- `error` and `notFound` are disjoint terminal presentations of one load attempt; a
  transient failure can never present as not-found (FR-007).

## Derived display rules (pure helpers)

| Rule | Input → Output | Requirement |
|------|----------------|-------------|
| Document title | `formatDocumentTitle(title)`: non-blank title → `"{title} - online-trash"`; null/blank → `"online-trash"` | FR-009, untitled-meme edge case |
| Page heading | title, else `"Untitled meme"` (same fallback the feed item uses) | FR-013 |
| Image alt | inside `FeedMedia`: title, else `"Meme image"` — always non-empty | FR-012 |
