# Contract: Components, Hooks & lib Modules

Thin React components compose pure `src/lib` helpers via two hooks. Components are
presentational glue (outside the coverage scope); **all branching/derivation logic lives
in `src/lib` and is unit-tested** (Principle VII).

## Pure lib modules (fully unit-tested under `frontend/tests/lib/`)

| Module | Exports | Contract |
|--------|---------|----------|
| `lib/api.ts` | `buildFeedUrl(params)`, `fetchFeed(params)` | URL building (clamp/default/encode); fetch + map + typed error classification. |
| `lib/feedModel.ts` | `type FeedPost`, `mapPost(raw)`, `pickImageSource(post)` | Map raw `Post`→`FeedPost`; media precedence (youtube→image→none); non-empty `alt`; srcset assembly; never fabricate URLs. |
| `lib/pagination.ts` | `nextStart(items)`, `isPageBreak(count)`, `hasMore(batch,limit)`, page-state reducer | Cursor = last `hash`; page break at 200; end detection; in-flight guard transitions. |
| `lib/youtube.ts` | `toEmbedUrl(raw): string \| null` | Extract a valid 11-char id from known YouTube URL/id forms; return fixed `youtube-nocookie.com/embed/<id>`; else `null`. |
| `lib/theme.ts` | `prefersDark(): boolean`, `watchScheme(cb)` | Read/observe `prefers-color-scheme` (thin, testable wrapper around `matchMedia`). |
| `lib/publicCode.ts` | `isValid` *(exists)* | Unchanged; not used as a gate on `hash` here (see research D10). |

## Hooks

| Hook | Contract |
|------|----------|
| `useFeed(after)` | Owns feed state for a page: initial load, append-on-scroll, page-break stop, end/empty/error, retry. Delegates math to `lib/pagination` and IO to `lib/api`. Prevents concurrent loads (FR-015). |
| `useTheme()` | Applies `prefers-color-scheme` to the document; no manual override (deferred). Wraps `lib/theme`. |

## Components

| Component | Props | Responsibility | A11y |
|-----------|-------|----------------|------|
| `App` | — | `BrowserRouter` + routes (`/`, `/posts/:hash`, `*`). | — |
| `PageLayout` | `{ children }` | Header wordmark + `NavMenu` + `<main>` landmark. | `<header>/<nav>/<main>` landmarks. |
| `NavMenu` | — | Fixed anonymous links: Home (`/`), Login/register (auth route). | labeled links; current-page `aria-current`. |
| `HomePage` | — | Reads `?after`; renders `Feed`; sets page title. | `<h1>`/section labeling. |
| `Feed` | `{ after }` | Calls `useFeed`; renders `FeedItem`s; sentinel + `IntersectionObserver`; Load-more link; state views. | live-region status for loading/end/error. |
| `FeedItem` | `{ post: FeedPost }` | Title + `MemeMedia`; whole item links to `post.permalink`. | linked title; meaningful link text. |
| `MemeMedia` | `{ media: FeedMedia }` | `image` ⇒ `<img srcset/sizes/loading=lazy alt>`; `youtube` ⇒ responsive `<iframe>`; `none` ⇒ title-only fallback. | non-empty `alt`; iframe `title`. |
| `states/*` | varies | Loading / Empty / EndOfFeed / Error(retry) presentational views. | accessible status text. |

## Cross-cutting requirements

- **Responsive** (Principle VIII): mobile-first CSS, fluid units + media queries; images
  and the YouTube `<iframe>` scale within their container preserving aspect ratio; no
  horizontal scroll 320px→wide desktop.
- **Theme** (Principle IV): CSS custom properties switched by
  `@media (prefers-color-scheme)`; color never the sole signal.
- **Security** (Principle VI): React's default escaping; iframe src only from
  `lib/youtube.toEmbedUrl`; image URLs only from the API.
- **Conventions** (Principle II): 2-space, semicolons, `camelCase`/`PascalCase`, booleans
  `is/has/should`, functions small; comments explain *why*.
