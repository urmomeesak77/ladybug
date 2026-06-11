# Contract: Feed API Consumption

How the mainpage calls the existing read-side feed API (feature 004). The frontend is a
**consumer**; it does not define the API. Authoritative source:
`specs/004-read-feed-api/contracts/feed-api.md`.

## Request

- Base origin from `VITE_API_BASE_URL` (e.g. `http://localhost:8000`).
- `GET {base}/api/posts?limit=10` — newest page (first batch).
- `GET {base}/api/posts?limit=10&start=<hash>` — next batch, `<hash>` = last loaded post's
  `hash` (keyset cursor).
- No auth headers (public, read-only). `Accept: application/json`.
- `src/lib/api.ts`:
  - `buildFeedUrl({ limit?, start? }): string` — pure; clamps `limit` to `[1,50]`,
    default 10; omits `start` when absent; URL-encodes `start`.
  - `fetchFeed(params): Promise<FeedResult>` — wraps `fetch`; maps raw `data[]` via
    `feedModel.mapPost`; classifies network/HTTP errors into a typed error result.

## Response handling

- `200 { "data": Post[] }` ⇒ map each `Post` → `FeedPost` (see
  [../data-model.md](../data-model.md)).
- A batch shorter than `limit` (or empty) ⇒ `hasMore = false` (end of feed / empty).
- Non-200 or network failure ⇒ typed error; UI shows Error state with Retry and keeps
  already-loaded items (FR-013).
- Unknown/stale `start` is ignored server-side (newest page returned) — the UI must not
  assume the returned items are "older than" an unresolved cursor (stale-deep-link edge).

## Pagination → URL mapping

| UI action | Request | URL after action |
|-----------|---------|------------------|
| Open `/` | `?limit=10` | `/` |
| Auto-scroll next batch (within page) | `?limit=10&start=<lastHash>` | unchanged (`/` or `/?after=<pageHash>`) |
| Reach 200 entries → "Load more" | (advance page) | `/?after=<lastHash>` |
| Open `/?after=<hash>` directly / refresh | `?limit=10&start=<hash>` | `/?after=<hash>` |

## Guarantees the UI relies on

- Ordering `activated_at DESC, id DESC`; keyset paging is gap/duplicate-free when the
  last `hash` is passed as the next `start`.
- `sizes` lists only existing files, widest-first; `default`/`original` per the 004 rules.
- Only visible posts are ever returned (UI renders exactly what it receives; FR-014).
