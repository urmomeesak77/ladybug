# Contract: sitemap

**Feature**: `016-seo-discoverability` | Covers FR-016–FR-020, FR-022

## Routes

| Method | Path | Response |
|---|---|---|
| `GET` | `/sitemap.xml` | sitemap **index** (always, never a flat urlset) |
| `GET` | `/sitemaps/static.xml` | urlset of public static addresses |
| `GET` | `/sitemaps/posts-{page}.xml` | urlset of ≤50,000 permalinks; `{page}` is `1`-based |

All three are Laravel routes registered **before** the shell catch-all, so the SPA's catch-all
never intercepts them (FR-022). They are not files in `dist/`, so nginx's `try_files $uri`
misses and forwards them to PHP automatically.

> **Do not** add `frontend/public/sitemap.xml` or `frontend/public/robots.txt`. Anything in
> `public/` becomes a real file in `dist/` and would win the `try_files`, silently shadowing
> these routes with a static stub.

Response headers:

```
Content-Type: application/xml; charset=UTF-8
Cache-Control: public, max-age=3600
Content-Encoding: gzip           # when advertised (application/xml is in gzip_types)
```

`{page}` out of range, or non-numeric → `404`.

## `/sitemap.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://online-trash.com/sitemaps/static.xml</loc></sitemap>
  <sitemap><loc>https://online-trash.com/sitemaps/posts-1.xml</loc></sitemap>
  <sitemap><loc>https://online-trash.com/sitemaps/posts-2.xml</loc></sitemap>
</sitemapindex>
```

Child count is `ceil(visibleCount / 50000)`; with zero visible memes the index still lists
`static.xml` alone and remains schema-valid (spec edge case "Empty site").

## `/sitemaps/static.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://online-trash.com/</loc></url>
</urlset>
```

Contains exactly the SPA route table's **indexable static** addresses — today, the home feed
alone. The `noindex` addresses of FR-012 are excluded by construction: the same
`SpaRoutes::isIndexable()` predicate drives this list and the per-page robots tag.

## `/sitemaps/posts-{page}.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://online-trash.com/posts/aB3dEf7GhJ</loc>
    <lastmod>2026-07-14T09:31:02+00:00</lastmod>
  </url>
  …
</urlset>
```

**Membership** — `Trashpost::publiclyVisible()`, the *same* scope the public feed uses. A meme
that is pending activation or soft-deleted never appears (FR-017); a restored meme reappears at
the next refresh.

**Ordering / paging** — descending `id`, walked by keyset (`where('id', '<', $lastId)
->orderByDesc('id')->limit(50000)`), so the newest memes sit at the head of `posts-1.xml` where a
crawler that samples only the first child still sees the freshest content, and the last page costs
the same as the first. The cost of newest-first is that adding a meme shifts entries across page
boundaries instead of appending to the last page; that is accepted because each child is rebuilt
whole on the 1-hour interval anyway, so no crawler ever sees a half-shifted set.

**`<lastmod>`** — `created_at` in ISO-8601 with offset. Memes are immutable once uploaded, so
there is no separate modification time (FR-018).

**Omitted deliberately** — `<changefreq>` and `<priority>`; the major engines ignore both.

## Limits (FR-019)

| Limit | Protocol maximum | This contract |
|---|---|---|
| URLs per file | 50,000 | 50,000 |
| Uncompressed bytes per file | 50 MB | ≈6 MB at 50,000 entries |

Splitting is unconditional rather than threshold-triggered: the response shape is a sitemap
index from the first meme onward, so there is no growth transition to get wrong.

## Caching (FR-020)

| Key | TTL |
|---|---|
| `seo:sitemap:v1:index` | 3600 s |
| `seo:sitemap:v1:static` | 3600 s |
| `seo:sitemap:v1:posts:{page}` | 3600 s |

Rendered XML is cached, not the row set, so a repeated retrieval within the interval performs
**no** database query (AS2.6). Entries are not explicitly invalidated: FR-020 makes the 1-hour
interval the contract for the listing (AS2.5), unlike the permalink metadata of FR-040.
