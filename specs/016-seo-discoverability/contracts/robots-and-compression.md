# Contract: robots.txt and transfer compression

**Feature**: `016-seo-discoverability` | Covers FR-021, FR-023, FR-029–FR-031

---

## `GET /robots.txt`

A Laravel route registered before the shell catch-all (same reasoning as the sitemap routes).

```
Content-Type: text/plain; charset=UTF-8
Cache-Control: public, max-age=3600
Status: 200
```

Body:

```
User-agent: *
Disallow: /login
Disallow: /register
Disallow: /account
Disallow: /upload
Disallow: /verify-email
Disallow: /admin/

Sitemap: https://online-trash.com/sitemap.xml
```

**Generated, not hand-written.** The `Disallow` lines come from `SpaRoutes::disallowedPaths()`
— the same table that decides which addresses get `<meta name="robots" content="noindex">`
(FR-012). Adding a private SPA route to that table updates both surfaces at once; they cannot
drift.

`/verify-email` covers `/verify-email/{hash}` by prefix. `/admin/` covers both admin consoles.

**Not disallowed, deliberately** (FR-023): `/storage/` — image crawlers must be able to fetch
meme media, and blocking it would also cost the `og:image` its validation fetch. Likewise
`/assets/`; blocking script and style resources degrades rendering-based crawlers.

The `Sitemap:` line is absolutised from `APP_URL`, so the dev and e2e origins emit their own
rather than pointing crawlers at production.

**Regression guard**: the current production response for this address is `200 text/html` (the
SPA shell). A test asserts the `Content-Type` is `text/plain`, not merely that the body looks
right.

---

## Compression

Configured in `deploy/web/default.conf` (the origin that produces every response) and repeated
in `deploy/nginx-edge/online-trash.com.conf`, so the behaviour holds however the stack is
reached:

```nginx
gzip              on;
gzip_vary         on;
gzip_proxied      any;
gzip_comp_level   5;
gzip_min_length   1024;
gzip_types        text/plain text/css application/javascript application/xml
                  application/xml+rss application/json image/svg+xml;
```

### Guarantees

| Requirement | How it holds |
|---|---|
| FR-029 — text responses compressed when advertised | `gzip on` + the `gzip_types` list. `text/html` (the shell) is compressed unconditionally by `gzip on` and must **not** be listed in `gzip_types` — nginx rejects the duplicate. |
| FR-029 — decompresses byte-identically | gzip is lossless; nginx compresses the same bytes it would otherwise send. Asserted by diffing a `--compressed` fetch against a plain one. |
| FR-030 — no `Accept-Encoding: gzip` → valid identity response | nginx default. Asserted, not configured. |
| FR-031 — already-compressed media not re-compressed | `image/*` and video types are absent from `gzip_types`, so `/storage/` responses are untouched and keep their `Cache-Control: public, immutable`. |

### Why these values

- **`gzip_proxied any`** is load-bearing. The origin's responses are produced for a request that
  arrived from the edge proxy; the default (`off`) would skip compression for exactly the
  traffic that matters.
- **`gzip_vary on`** emits `Vary: Accept-Encoding`, without which any shared cache may serve a
  gzipped body to a client that cannot decode it.
- **`gzip_comp_level 5`** — near-level-9 ratio at a fraction of the CPU, which matters on a
  1 vCPU box shared with php-fpm, MySQL and two nginx instances.
- **Brotli is not used**: `ngx_brotli` is absent from `nginx:alpine`, so enabling it means
  building and maintaining a custom nginx image — a dependency decision (Principle I) for a
  marginal gain here.

### Expected effect (SC-005)

| Asset | Today | Compressed |
|---|---|---|
| `/assets/index-*.js` | 250,120 B | ≈80 KB |
| `/assets/index-*.css` | — | ≈20% of original |
| shell HTML | ~1.5 KB after this feature | ≈700 B |

SC-005 measures the **compressible payload** of a first visit — the document plus its stylesheets
and scripts — and explicitly excludes meme media, which is already compressed and deliberately not
re-compressed (FR-031). Against that set the reduction lands well past the 60% required; the JS
bundle alone accounts for ~68% of it. Measured by the loop in `quickstart.md` §4, not by the JS
asset in isolation.
