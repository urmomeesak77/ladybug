# Contract: Lib / Hook / Component Surfaces

**Feature**: 006-trashpost-page

New and touched frontend surfaces. Pure lib functions are the tested contract
(coverage-gated); hooks/components are thin glue verified manually.

## `src/lib/api.ts` (extended)

```ts
// Pure: absolute/relative URL for the single-post endpoint; hash is path-encoded.
export function buildPostUrl(hash: string): string;

export type PostError = { kind: 'notFound' | 'http' | 'network'; status?: number };
export type PostResult =
  | { ok: true; post: FeedPost }
  | { ok: false; error: PostError };

// IO: fetches one post; 404 → notFound, other non-2xx → http, rejection → network.
// Success maps the body through feedModel.mapPost.
export function fetchPost(hash: string): Promise<PostResult>;
```

Existing feed exports are untouched.

## `src/lib/postModel.ts` (new)

```ts
export type PostPageState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; post: FeedPost }
  | { status: 'notFound' }
  | { status: 'error' };

export type PostPageAction =
  | { type: 'loadStart' }
  | { type: 'loadSuccess'; post: FeedPost }
  | { type: 'loadNotFound' }
  | { type: 'loadError' };

export const initialPostPageState: PostPageState; // { status: 'idle' }

// Pure reducer; transitions per data-model.md (notFound/error only from a completed
// response; loadStart always returns to loading).
export function postPageReducer(state: PostPageState, action: PostPageAction): PostPageState;

// "{title} - online-trash" for a non-blank title, else "online-trash" (FR-009).
export function formatDocumentTitle(title: string | null): string;
```

## `src/hooks/usePost.ts` (new)

```ts
// Thin glue over postPageReducer + fetchPost. Loads on mount and on every hash change
// (resetting to loading first); discards responses for a hash that is no longer
// current; retry() re-runs the fetch for the current hash.
export function usePost(hash: string | undefined): {
  state: PostPageState;
  retry: () => void;
};
```

## `src/pages/PostPage.tsx` (new; replaces `PostPlaceholderPage.tsx`)

Props: none (reads `:hash` via `useParams`). Responsibilities:

- Renders by `state.status`: `loading`/`idle` → `LoadingState`; `notFound` →
  `NotFoundPage` content; `error` → `ErrorState` with `onRetry={retry}`; `loaded` →
  heading (title or "Untitled meme") + `MemeMedia` (display-only image — `MemeMedia`
  already renders a plain `<img>`, never a link).
- Wraps the swappable region in a polite live region (mirrors the feed's pattern) so
  state changes are announced (Principle IV).
- Sets `document.title` via `formatDocumentTitle` when a meme loads; plain site name
  otherwise.
- `useLayoutEffect` keyed by `hash`: `window.scrollTo(0, 0)` (FR-008 — global manual
  scroll restoration would otherwise keep the feed's scroll offset).

## Reused as-is (no signature changes)

| Surface | Role here |
|---------|-----------|
| `PageLayout`, `NavMenu` | Site header + anonymous menu around the page (FR-005). |
| `MemeMedia` | Image (`srcset`/`sizes`, lazy, broken→degrade) or sanitized YouTube iframe (FR-003, FR-013). |
| `LoadingState`, `ErrorState` | Loading and retryable-failure presentations (FR-007). |
| `NotFoundPage` | The 404 presentation with the home link (FR-006). |
| `feedModel.mapPost` etc. | Raw→view-model mapping incl. media rules (FR-002/004/012). |

## `src/App.tsx` (edited)

`<Route path="/posts/:hash" element={<PostPage />} />` replaces the placeholder route;
all other routes unchanged.

## Tests (mirrored, Principle VII)

| Test file | Covers |
|-----------|--------|
| `tests/lib/api.test.ts` (extended) | `buildPostUrl` encoding/base; `fetchPost` 200-maps-through-`mapPost`, 404→notFound, non-2xx→http with status, rejection→network, malformed body handling. |
| `tests/lib/postModel.test.ts` (new) | Every reducer transition in the data-model table (incl. retry clears error, no not-found from loading start, hash-change restart) + `formatDocumentTitle` fallbacks (null, empty/blank, normal). |
