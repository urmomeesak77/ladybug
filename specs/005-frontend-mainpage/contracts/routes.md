# Contract: Frontend Routes

Client-side routes (react-router-dom `BrowserRouter`). All views share `PageLayout`
(header wordmark + fixed anonymous nav). URLs are real, shareable, and refresh-safe
(Principle III).

| Path | Component | Purpose | URL state |
|------|-----------|---------|-----------|
| `/` | `HomePage` | Newest meme feed (page break + infinite scroll). | optional `?after=<hash>` selects the feed page; absent ⇒ newest page. |
| `/posts/:hash` | `PostPlaceholderPage` | Per-meme permalink target. Single-meme page is out of scope this feature; shows a placeholder/not-found. | `:hash` is the opaque public code. |
| `*` (recommended) | not-found view | Unknown paths. | — |

Notes:
- The "Login/register" nav item links to the auth route (e.g. `/login`) owned by a future
  feature; in this feature it is a plain link/anchor to that path (no auth state).
- Back/Forward/Refresh MUST restore the correct route + its `after` page (SC-003/SC-004).
- `:hash` is treated as opaque (no client-side format validation gate); the API is the
  authority on validity.
