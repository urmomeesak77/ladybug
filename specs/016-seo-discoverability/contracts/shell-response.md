# Contract: SPA shell response

**Feature**: `016-seo-discoverability` | Covers FR-001–FR-015, FR-024–FR-028, FR-033, FR-038

The origin answers **every** address that is not a real file on disk with the SPA shell. The
body below `</head>` is byte-identical to today's `dist/index.html`; only the `<head>` block and
the HTTP status differ per address.

## Routing

```
GET  <any path not matching a file in dist/, and not /api|/up|/sanctum|/storage>
```

nginx (`deploy/web/default.conf`):

```nginx
# No `index` directive in this server block, deliberately: see below.
location = / {
    # `try_files $uri @shell` is NOT enough for the root. The request URI is `/`, and a
    # try_files term ending in a slash is a DIRECTORY test — `$uri` matches the document
    # root itself, so `/` would be handed to the index module and answered with the static
    # dist/index.html, never reaching Laravel. An unsatisfiable first term forces the
    # fallback. The failure is silent: PHPUnit has no nginx in front of it, so every test
    # would still pass while the home feed shipped with an empty <head>.
    try_files /__shell__ @shell;
}
location / {
    try_files $uri @shell;
}
location @shell {
    # identical fastcgi block to the existing /(api|up|sanctum) location
}
```

Laravel (`routes/web.php`), registered **after** `/robots.txt` and the sitemap routes:

```
Route::get('/{path?}', [ShellController::class, 'show'])
    ->where('path', '^(?!(api|up|sanctum|storage)(/|$)).*$');
```

The `(/|$)` matches a whole **path segment**. Without it the negative lookahead is a prefix
test, and `/uptime`, `/apixyz` and `/storage-wars` drop out of the shell route into the
framework's own error page instead of the site's not-found view (FR-014).

Response headers on every variant:

```
Content-Type: text/html; charset=UTF-8
Cache-Control: no-cache          # the shell is cheap and must reflect moderation immediately
Content-Encoding: gzip           # when the client advertises it (see robots/compression)
```

## Status codes

| Address | Status |
|---|---|
| `/` and any address in the SPA route table | `200` |
| `/posts/{hash}` where the meme is publicly visible | `200` |
| `/posts/{hash}` where a row exists but is pending or soft-deleted | `200` |
| `/posts/{hash}` where no row exists at all (never existed, or purged) | `404` |
| any address matching no SPA route | `404` |
| any of the above when metadata resolution throws | the status above, never `5xx` (FR-038) |

The body for a `404` is the same shell. The SPA renders its existing `NotFoundPage` (FR-014):
for an unmatched address via the `*` route, for an unknown hash via `PostPage`'s existing
`notFound` state after the API returns `404`.

## Head block — publicly visible meme

Injected immediately before `</head>`, after any existing `<title>` has been stripped:

```html
<title>{title} - online-trash</title>
<meta name="description" content="{description ≤155}">
<link rel="canonical" href="https://online-trash.com/posts/{hash}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="online-trash">
<meta property="og:url" content="https://online-trash.com/posts/{hash}">
<meta property="og:title" content="{title ≤60}">
<meta property="og:description" content="{description ≤200}">
<meta property="og:image" content="{absolute image url}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title ≤60}">
<meta name="twitter:description" content="{description ≤200}">
<meta name="twitter:image" content="{absolute image url}">
<script type="application/ld+json">{…}</script>
```

`og:image` (FR-005, FR-006) is the meme's OWN unfurl address, `https://online-trash.com/og/{hash}.jpg`,
never a media file — amended 2026-08-22. X's card crawler produces no image at all from a WebP
`og:image`, and a WebP upload has WebP renditions all the way down, so linking the media cost every
such meme its card while the title and description still arrived (measured against three live posts).
`OgImageController` answers that address with a JPEG transcoded from the meme's own bytes on first
request and cached on the public disk thereafter.

Which bytes it derives from: the widest rendition on disk that is at most 1200px wide — the full-size
`original` when the upload was small enough, otherwise the widest downscale — else the stored YouTube
thumbnail. The cap has a floor behind it: a 400×200 upload has no downscale wider than 300, and
300×150 is under X's 300×157 minimum for a large-image card, so skipping the original would lose the
card for the opposite reason. A meme with no bytes at all still falls back to the branded
`logo-light.png`, and `twitter:card` degrades to `summary` exactly when that fallback was used.

A meme with no title uses `Untitled meme` in `{title}` and the site description in
`{description}`.

## Head block — every non-meme and non-public address

`/`, the `noindex` static addresses, a hidden meme, a `404`, and the FR-038 degraded response
all emit the **same** generic block, differing only in `canonical` and the presence of the
robots tag:

```html
<title>online-trash</title>
<meta name="description" content="{site description}">
<link rel="canonical" href="{canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="online-trash">
<meta property="og:url" content="{canonical}">
<meta property="og:title" content="online-trash">
<meta property="og:description" content="{site description}">
<meta property="og:image" content="https://online-trash.com/logo-light.png">
<meta name="twitter:card" content="summary">
…twitter:title / :description / :image mirroring the og values…
<meta name="robots" content="noindex, follow">   <!-- omitted for / only -->
```

**Canonical rules**

- `/?after={cursor}` → `https://online-trash.com/` (FR-033: query stripped, page cursors
  canonicalise to the home feed).
- every other address → itself, absolute, without query or fragment.

**Prohibited** (FR-010, tested explicitly): for a pending or soft-deleted meme, no part of that
meme's `title`, `description`, author name, or image URL may appear anywhere in the response —
including in `og:image`, in the canonical, or in JSON-LD — regardless of who is signed in. The
canonical still names the meme's own address, which is the hash the requester already has.

## Structured data (FR-024–FR-028)

Emitted only for a publicly visible meme. One `<script type="application/ld+json">` holding a
`@graph` of two nodes.

Image meme:

```json
{ "@context": "https://schema.org",
  "@graph": [
    { "@type": "ImageObject",
      "url": "https://online-trash.com/posts/{hash}",
      "contentUrl": "{absolute image url}",
      "name": "{title}",
      "description": "{description}",
      "datePublished": "{created_at ISO-8601}",
      "author": { "@type": "Person", "name": "{author}" } },
    { "@type": "BreadcrumbList", "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "online-trash", "item": "https://online-trash.com/" },
      { "@type": "ListItem", "position": 2, "name": "{title}" } ] }
  ] }
```

YouTube meme: the first node becomes

```json
{ "@type": "VideoObject",
  "url": "https://online-trash.com/posts/{hash}",
  "name": "{title}",
  "description": "{description}",
  "thumbnailUrl": "{absolute thumbnail url}",
  "embedUrl": "https://www.youtube.com/embed/{revalidated id}",
  "uploadDate": "{created_at ISO-8601}" }
```

The embed id is re-derived with `App\Utils\Youtube::extractId()` from the stored column; if it
no longer parses, `embedUrl` is omitted rather than composed from raw input (Principle VI).

Every value in the graph is read from the same `PageMeta` that produced the `og:` tags, so
FR-027 holds by construction.

## Escaping (FR-007, Principle VI)

- Attribute values: `htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')`.
- JSON-LD: `json_encode(…, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG |
  JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT)`; **no** HTML escaping on top.

Test vectors that must round-trip without altering document structure:

| Title | Must not produce |
|---|---|
| `He said "hi"` | an attribute break |
| `<script>alert(1)</script>` | a live `<script>` element, or a closed `</script>` inside JSON-LD |
| `Tom & Jerry` | a broken entity |
| `" /><script>x</script><meta a="` | any injected element |
| `'; alert(1); //` | executable content inside the JSON-LD block |

## Unchanged behaviour (FR-009, FR-036)

- The document below `</head>` — including the `<div id="root">` and the asset `<script>` tag —
  is untouched. No extra round-trip is introduced before first render.
- `<meta name="viewport">` and `<link rel="icon">` remain exactly as the built shell has them
  (Principle VIII).
- The JSON API's routes, shapes, and status codes are unchanged. The SPA's own data fetching is
  unchanged: it still calls `GET /api/posts/{hash}` after boot and still decides `notFound`
  from that call, not from the shell's status.

## Caching (FR-039, FR-040)

The derived `PageMeta` is cached at `seo:meta:v1:{sha1(path)}` for 1 hour. Every visibility
transition (`activate`, `deactivate`, `delete`, `restore`, `purge`, and the trusted-uploader
auto-activation) forgets that meme's key, so the next request reflects the new state
immediately. The response itself carries `Cache-Control: no-cache` so no intermediary can
outlive that invalidation.
