# Contract: Route `/posts/{hash}`

**Feature**: 006-trashpost-page

The SPA route that feature 005 registered as a placeholder becomes the real single-meme
page. The route's outward behavior is the contract; component internals may change
freely behind it.

## Route

| Path | Component | Replaces |
|------|-----------|----------|
| `/posts/:hash` | `PostPage` | `PostPlaceholderPage` (deleted) |

- `hash` is treated as an opaque string (no client-side format gate); the API decides
  validity. Any value — malformed, unknown, hidden, deleted — that the API rejects with
  404 renders the not-found view (FR-006).
- The route renders inside the shared `PageLayout` (header wordmark + anonymous nav
  menu), like every view (FR-005).

## Behavior contract

| Trigger | Required outcome |
|---------|------------------|
| Direct open / refresh | The meme is fetched and rendered from the URL alone (FR-008, US1). |
| Feed entry click | Arrives here with that entry's hash; correct meme renders (SC-004). |
| While fetching | Loading indication; never a premature not-found (FR-007). |
| API 404 | Not-found view (shared `NotFoundPage` content) with a working link back to `/` (FR-006). |
| Other HTTP / network failure | Error view with a Retry control; retry refetches without a full page reload and clears stale error text on success (FR-007, SC-008). |
| Loaded | Meme title (or "Untitled meme") as the page heading + media via `MemeMedia`; image is display-only — no link/zoom (FR-002, FR-003). |
| Page open (incl. Forward, meme→meme) | Window scrolled to top before paint (FR-008, clarification). |
| Browser Back to the feed | Unaffected by this page: the feed restores its scroll anchor (005 contract stays intact). |
| Document title | `"{meme title} - online-trash"`, or `"online-trash"` for untitled memes (FR-009). Home resets the title on return. |
| Hash change while mounted (Back/Forward between memes) | State resets to loading; the previous meme's content is never shown for the new hash (spec edge case). |

## Out of contract

Comments, voting, sharing, next/previous navigation, auth-aware menu states, and a
manual theme toggle remain out of scope (spec Out of Scope).
