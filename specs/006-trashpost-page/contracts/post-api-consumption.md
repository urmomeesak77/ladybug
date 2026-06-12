# Contract: Consumption of `GET /api/posts/{hash}`

**Feature**: 006-trashpost-page

The page consumes the feature-004 single-post endpoint **as-is** (authoritative contract:
`specs/004-read-feed-api/contracts/feed-api.md`). No backend changes. This document pins
how the frontend uses it.

## Request

- `GET {VITE_API_BASE_URL}/api/posts/{hash}` with `Accept: application/json` — same
  base-URL convention as the feed client (`apiBase()` in `src/lib/api.ts`).
- `hash` is the raw route param, URL-path-encoded; no client-side validation (the API is
  the authority on the 10-char code format).
- Exactly one request per page view / hash change / retry; no polling, no caching layer
  (research D10).

## Response handling

| API response | Client mapping (`fetchPost` → `PostResult`) | UI state |
|--------------|---------------------------------------------|----------|
| `200` `{ "data": <Post> }` | `{ ok: true, post: mapPost(data) }` | `loaded` |
| `404` (unknown / not activated / soft-deleted) | `{ ok: false, error: { kind: 'notFound', status: 404 } }` | `notFound` — one indistinguishable view for all three causes (FR-006) |
| Other non-2xx | `{ ok: false, error: { kind: 'http', status } }` | `error` (retryable) |
| Fetch rejection (offline, DNS, CORS) | `{ ok: false, error: { kind: 'network' } }` | `error` (retryable) |

## Fields consumed

Only the fields the existing `RawPost` mapping reads; all others in the payload are
ignored:

| Field | Use |
|-------|-----|
| `hash` | Identity; stale-response guard in the hook. |
| `title` | Heading, document title, alt text (with fallbacks). |
| `youtube` | Parsed by the in-house parser → embed URL or treated as absent (Principle VI; unrecognized reference degrades gracefully, FR-013). |
| `default`, `sizes`, `original` | Image source + `srcset`; only URLs the API declares are ever requested (FR-004). |
| `metadata` | Intrinsic image dimensions (layout stability), when parseable. |
| `url` | Permalink (informational). |

## Guarantees relied upon

- A returned post is always visible (`activated_at` set, not deleted) — the client never
  needs to re-check visibility.
- `sizes` lists only files that exist on disk, widest-first — the client never fabricates
  or guesses image URLs.
- 404 is the *only* signal distinguishing missing posts; the client must not (and does
  not) attempt to differentiate hidden vs unknown.
