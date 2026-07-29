# Data Model: SEO & Social-Sharing Discoverability

**Feature**: `016-seo-discoverability` | **Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

## No schema change

This feature adds **no table, no column, no migration, and no stored record**. Everything it
emits is derived at request time from rows that already exist, and cached in the existing cache
store. If the cache is flushed the site behaves identically, only slower on the next request.

The entities below are therefore **in-memory value objects and derived collections**, not
persistence models. They are listed with the same rigour as stored entities because their
shapes are what the contracts assert against.

---

## Existing entities read (unchanged)

### `Trashpost` (`backend/app/Models/Trashpost.php`)

Read-only for this feature. Fields consumed:

| Field | Used for |
|---|---|
| `hash` | permalink (`/posts/{hash}`), cache key, sitemap `<loc>` |
| `title` | `<title>`, `og:title`, `description`, JSON-LD `name` |
| `type` | discriminates `youtube` from an image meme |
| `file` | resolves image variants via `TrashpostImageService::imageData()` |
| `youtube` | re-validated to a video id for JSON-LD `embedUrl` |
| `youtube_thumbnail` | relative path → preview image for a video meme |
| `username` / `user->name` | JSON-LD `author.name` (public memes only) |
| `created_at` | JSON-LD `datePublished` / `uploadDate`, sitemap `<lastmod>` |
| `activated_at` | half of the public-visibility test |
| `deleted_at` (via `SoftDeletes`) | the other half |

**One change to the model**: the public-visibility rule is promoted from
`TrashpostService::visible()` (currently `private`) to a local scope so the sitemap and the feed
share **one** definition (research D8, spec Assumptions → Visibility):

```
scopePubliclyVisible(Builder $query): Builder   // whereNotNull('activated_at'), SoftDeletes excludes trashed
```

`TrashpostService::visible()` becomes a call to that scope. No behaviour change to the feed.

### `User` — not read directly. The author name comes off the post row / eager-loaded relation, exactly as `TrashpostResource::authorName()` already resolves it.

---

## Derived entities

### `PageMeta` (`App\Support\PageMeta`)

An immutable value object: everything one address needs in its `<head>`. Constructed by
`PageMetaService`, consumed by the renderer. Never serialized to the client except as rendered
tags.

| Field | Type | Notes |
|---|---|---|
| `title` | `string` | full document title, e.g. `Cat on a roomba - online-trash`. Not truncated (D6) |
| `description` | `string` | ≤155 chars, word-boundary truncated |
| `canonical` | `string` | absolute, on `APP_URL`, query stripped |
| `socialTitle` | `string` | ≤60 chars |
| `socialDescription` | `string` | ≤200 chars |
| `imageUrl` | `string` | absolute; always set — falls back to the branded logo (FR-006) |
| `isLargeImageCard` | `bool` | `true` → `twitter:card=summary_large_image`, `false` → `summary` (D7) |
| `isIndexable` | `bool` | `false` → emit `<meta name="robots" content="noindex, follow">` |
| `structuredData` | `array<string,mixed>\|null` | JSON-LD `@graph`; `null` for every non-public address (FR-028) |

**Invariants**

- `imageUrl` is never `null` and never a relative path.
- `structuredData !== null` **implies** `isIndexable === true`. The converse does not hold:
  `/` is indexable and carries no JSON-LD.
- `isIndexable === false` for every address in the `noindex` set (FR-012), for a
  non-publicly-visible meme (FR-011), for a `404` (FR-013), and for the FR-038 degraded response.
- When `isIndexable === false`, `title`/`description`/`imageUrl` carry **only** site-level
  values — no meme-derived value may appear (FR-010). This is the security-relevant invariant
  and gets its own tests.

**Construction paths** (exactly three; there is no fourth):

1. `PageMeta::forPost(Trashpost)` — publicly visible meme.
2. `PageMeta::site(canonical, isIndexable)` — home feed, every static address, hidden memes,
   404s, and the FR-038 degraded response. One constructor, so the "generic metadata" of
   FR-011/FR-013/FR-015/FR-038 is provably the same bytes in all four cases.
3. Deserialization from the cache (plain array in, object out).

### `SpaRoute` (`App\Support\SpaRoutes`)

Not an object per row — a static table plus matchers. Mirrors `frontend/src/App.tsx`.

| Pattern | Kind | Indexable |
|---|---|---|
| `/` | static | yes |
| `/posts/{hash}` | dynamic | decided per row (D3) |
| `/login`, `/register`, `/account`, `/upload`, `/verify-email` | static | no |
| `/verify-email/{hash}` | dynamic | no |
| `/admin/trashposts`, `/admin/users` | static | no |
| anything else | — | `404` |

`SpaRoutes` exposes: `match(string $path): ?SpaRouteKind`, `isIndexable(string $path): bool`,
`disallowedPaths(): list<string>` (feeds robots.txt, so FR-012 and FR-021 cannot drift apart).

### `SitemapEntry`

| Field | Type | Notes |
|---|---|---|
| `loc` | `string` | absolute permalink |
| `lastmod` | `string` | ISO-8601 from `created_at` |

Produced only for `Trashpost::publiclyVisible()` rows (FR-017), newest `id` first. No
`changefreq`, no `priority`.

### `SitemapIndex`

A list of child sitemap URLs: `/sitemaps/static.xml` plus `/sitemaps/posts-{n}.xml` for
`n = 1 … ceil(visibleCount / 50000)`. When there are no visible memes the index still lists
`/sitemaps/static.xml` and remains valid (spec edge case "Empty site").

---

## Cache entries

| Key | Value | TTL | Invalidated by |
|---|---|---|---|
| `seo:meta:v1:{sha1(path)}` | serialized `PageMeta` | 1 h | explicit `PageMetaService::forget($hash)` from every visibility transition (FR-040) |
| `seo:sitemap:v1:index` | rendered XML | 1 h | TTL only (FR-020) |
| `seo:sitemap:v1:static` | rendered XML | 1 h | TTL only |
| `seo:sitemap:v1:posts:{n}` | rendered XML | 1 h | TTL only |

Store: the app's configured cache (`CACHE_STORE=file` in dev and prod). The `v1:` segment is a
namespace version — bumping the constant invalidates every entry at once on a deploy that
changes the emitted tag set.

**Key-safety (FR-039)**: the key is `sha1` of the **path alone**. It contains no requester
identity because the metadata is a function of public visibility only — which is precisely what
makes a shared entry correct rather than a leak. Two distinct addresses cannot collide onto one
entry, and no signed-in view can be stored under an address key, because no signed-in view is
ever produced.

---

## Configuration (`backend/config/seo.php`, new)

Not data, but it is where the values the contracts assert against live:

| Key | Default | Purpose |
|---|---|---|
| `site_name` | `online-trash` | title suffix, JSON-LD `publisher` |
| `site_description` | *(copy written at implementation)* | the generic description |
| `shell_path` | `base_path('resources/spa/index.html')` | overridden by tests and by the dev mount (D2) |
| `fallback_image` | `/logo-light.png` | absolutised against `APP_URL` |
| `sitemap_chunk` | `50000` | URLs per child sitemap (the protocol maximum) |
| `cache_ttl` | `3600` | seconds |
| `untitled_label` | `Untitled meme` | matches the SPA's existing feed fallback |
