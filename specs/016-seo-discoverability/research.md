# Research: SEO & Social-Sharing Discoverability

**Feature**: `016-seo-discoverability` | **Date**: 2026-07-29 | **Spec**: [spec.md](./spec.md)

Every NEEDS CLARIFICATION from Technical Context is resolved below. Each decision records
what was chosen, why, and what was rejected.

---

## Measured baseline (2026-07-29)

The spec's Context table is the observed production behaviour. The cause, read off the
deployed stack:

- `deploy/web/default.conf` `location /` ends in `try_files $uri $uri/ /index.html`. Every
  non-file path — `/posts/{hash}`, `/robots.txt`, `/sitemap.xml`, a typo — is answered with
  the same static `dist/index.html`, status `200`, `Content-Type: text/html`.
- That file is `frontend/index.html` with hashed asset tags substituted. Its only descriptive
  markup is `<title>online-trash</title>`.
- Titles are set in `useEffect` (`HomePage.tsx:21`, `PostPage.tsx:41`), i.e. after hydration.
  Link unfurlers and most crawlers never run that code.
- No `gzip` directive exists in either `deploy/web/default.conf` or
  `deploy/nginx-edge/online-trash.com.conf`, so nginx serves everything identity-encoded.

Nothing here is a bug in the SPA. It is a gap in what the **origin** emits before the SPA
boots, which is exactly the surface this feature changes.

---

## D1 — Where the metadata is composed

**Decision**: Route every non-asset HTML request through **Laravel**, which composes the
`<head>` and chooses the status code, then hands back the SPA shell unchanged in every other
respect. `deploy/web/default.conf` becomes:

```nginx
location = / {
    try_files /__shell__ @shell;   # see the root-path trap below
}
location / {
    try_files $uri @shell;   # real files (assets, favicon, logos) still served statically
}
location @shell {
    # same fastcgi_pass block the /api|/up|/sanctum location already uses
}
```

**The root-path trap.** `location /` alone does not cover `/`. The request URI for the home feed
is `/`, and a `try_files` term ending in a slash is a *directory* test, so `$uri` matches the
document root and nginx answers from the `index index.html;` directive — the static shell, with
no server-composed `<head>`. The exact-match location with an unsatisfiable first term forces the
fallback, and the `index` directive is removed so nothing can quietly resurrect the behaviour.
This failure mode is invisible to the test suite (PHPUnit calls Laravel with no nginx in front),
which is why the contract pins it and T040b verifies it against a real nginx build.

**Rationale**:

- It is the only option that can set an HTTP **status code** per address (FR-013, FR-015),
  which rules out every "inject markup" trick.
- The route table, the visibility rule, and the media URLs all already live in PHP. Composing
  metadata anywhere else would mean a second copy of all three.
- Requests for `/robots.txt` and `/sitemap.xml` are not files in `dist/`, so `try_files $uri`
  misses and they reach PHP for free — FR-022 is satisfied by the routing shape itself, with
  no extra nginx location. (Corollary: a `frontend/public/robots.txt` must **never** be added;
  it would become a real file and win the `try_files`. Recorded in the contract.)
- Zero new dependencies (FR-035, Principle I).

**Alternatives rejected**:

| Alternative | Why rejected |
|---|---|
| Node SSR / prerender sidecar (Next, `vite-plugin-ssr`, prerender.io) | New runtime dependency **and** a second deployed service, for metadata we can emit in ~200 lines of PHP. Principle I. |
| nginx SSI (`ssi on` + `<!--# include virtual="/_meta" -->`) | A subrequest cannot change the parent response's status code, so FR-013/FR-015 are unreachable. Also fragile against the `$uri` cache. |
| Build-time static HTML per route (`login.html`, `404.html`, …) | Cannot cover `/posts/{hash}` at all, and forces the SPA route table into nginx config, where it silently rots against `App.tsx`. |
| User-agent sniffing (serve crawlers a different document) | Cloaking risk, a second code path to keep in sync, and the spec explicitly forbids it (Assumptions → Delivery). |

---

## D2 — Where the shell template comes from

The composed response is the **built** `dist/index.html` (hashed asset tags), which today
exists only inside the `ladybug-web` image. PHP needs its own copy.

**Decision**: Add a `node:20` build stage to `deploy/php/Dockerfile` and copy just
`dist/index.html` to `/var/www/html/resources/spa/index.html`. The path is config-driven
(`config('seo.shell_path')`) so tests point at a fixture and dev points at the unbuilt
`frontend/index.html`. `deploy/php/entrypoint.sh` asserts the file is readable at boot and
dies loudly if not — the same shape as its existing `.env` assertion.

**Rationale**:

- `release.yml` builds both images from the **same commit SHA** in one matrix, and `deploy.sh`
  pins one `LADYBUG_TAG` for both. Vite's asset hashes are content-derived and deterministic,
  so the `index.html` baked into the php image references exactly the assets baked into the
  web image. There is no window in which they can disagree.
- No runtime coupling between containers, no network hop on the request path, no volume
  lifecycle to reason about.
- Buildx's `cache-from/to: scope=ladybug-php` caches the `npm ci` and `vite build` layers, so
  the added cost is paid once and then only when `frontend/` actually changes.

**Alternatives rejected**:

| Alternative | Why rejected |
|---|---|
| Shared named volume populated by `ladybug-web` | Named volumes seed from the image only on **first** creation; after a deploy the volume keeps the previous release's `index.html` pointing at assets that no longer exist → white screen. Fixable only with a copy-on-start entrypoint, i.e. more moving parts than the build stage. |
| PHP fetches `http://ladybug-web/index.html` at runtime and caches it | Attractive (self-updating, no build change) but introduces a runtime dependency from php→web, and any persisted cache survives a deploy and goes stale exactly as above. In-process-only caching avoids staleness but re-fetches per worker recycle. Net: more failure modes than a baked file. |
| A copy of the shell checked into `backend/` | Drifts from the real asset hashes on the next `vite build`. Guaranteed to break silently. |
| Build the frontend once in a prep job of `release.yml` and pass `dist/` to both image builds as an artifact | Genuinely cleaner on CI minutes, but it restructures the release workflow and couples the two matrix legs. Recorded as the follow-up if the php image build time becomes a problem; not needed now. |

**Dev consequence** (accepted, documented): the dev stack keeps Vite serving the shell at
`:5173`, so browsing dev never exercises the Laravel shell route. The route is still reachable
at the API origin (`http://localhost:8000/posts/{hash}`) for `curl` verification, and
`docker-compose.yml` mounts `frontend/index.html` at the configured shell path so it answers
there. Metadata is verified by `curl` and by PHPUnit, not by looking at a dev browser — which
is the correct instrument anyway, since the whole point is what happens *without* JavaScript.

---

## D3 — Status codes and the SPA route table

**Decision**: A single `App\Support\SpaRoutes` holds the address table, mirroring `App.tsx`:

- **Known, indexable**: `/`, `/posts/{hash}`
- **Known, `noindex`** (FR-012): `/login`, `/register`, `/account`, `/upload`, `/verify-email`,
  `/verify-email/{hash}`, `/admin/trashposts`, `/admin/users`
- **Anything else** → `404`

For `/posts/{hash}` the status is decided by a single lookup:

| Row state | Status | Metadata |
|---|---|---|
| activated and not soft-deleted | `200` | the meme's own (FR-001–FR-006) |
| exists but pending or soft-deleted | `200` | generic site metadata + `noindex` (FR-015, FR-011) |
| no row at all (never existed, or purged) | `404` | generic site metadata + `noindex` (FR-013) |

**Rationale**: The three-way split is exactly the spec's clarification session. `withTrashed()`
is what distinguishes "hidden" from "gone", and it is one query either way.

**Known duplication, accepted**: the route list exists in `App.tsx` and in `SpaRoutes`. There
is no cheap cross-stack check for it. Mitigation: a cross-referencing comment in both files
naming the other, plus a `SpaRoutesTest` case per address. A generated manifest was considered
and rejected as more machinery than the risk warrants for a table that changes once a feature.

**Guard**: the catch-all `Route::get('/{path?}')->where('path', '.*')` in `routes/web.php` must
exclude `api|up|sanctum|storage`. In production nginx never routes those to it, but PHPUnit
calls the app directly with no nginx in front, and an unguarded catch-all would shadow them in
tests. The existing `Route::get('/', fn () => abort(404))` (which exists only to hide the stock
welcome page) is replaced by the shell route.

---

## D4 — Metadata caching and invalidation

**Decision**: `Cache::remember("seo:meta:v1:" . sha1($path), 3600, …)` in `PageMetaService`,
using the configured store (`CACHE_STORE=file` in prod). The key is derived from the **path
only**. Invalidation is an **explicit** `PageMetaService::forget($hash)` call from each
visibility transition:

- `ModerationService::activate` / `deactivate` / `delete` / `restore` / `purge`
- `TrashpostService::activate` (the trusted-uploader auto-activation path)

**Rationale**:

- Keying on path alone is safe *because* the spec fixes the metadata as a function of public
  visibility only, never of the requester (Assumptions → Visibility). One entry serves
  everyone, which is what makes it cacheable at all (FR-039). The `sha1($path)` prefix makes
  the "one meme's metadata under another meme's address" collision impossible.
- The `v1:` segment lets a future change to the emitted tag set invalidate the whole namespace
  by bumping a constant, rather than waiting an hour after every deploy.
- Explicit `forget()` calls match how `RatingService` is already wired into `ModerationService`
  — visible at the call site, trivially testable, and it keeps the transition and its cache
  effect inside the same method the reader is already looking at.

**Alternative rejected**: an Eloquent `TrashpostObserver`. DRYer, but it hides the effect from
the transition code, fires on writes that are not visibility changes, and is harder to assert
against than a direct call. The codebase's existing style is explicit service calls.

**Sitemap caching is separate** and needs no invalidation: FR-020 makes the 1-hour interval the
*contract* for the listing, not an upper bound (contrast FR-040, which is about permalinks).

---

## D5 — Escaping (Principle VI, FR-007)

Two positions, two rules — both applied at render time, never at storage time:

- **HTML attribute** (`<meta content="…">`, `<link href="…">`, `<title>`):
  `htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')`. `ENT_QUOTES` closes the
  attribute-breakout vector; `ENT_SUBSTITUTE` turns invalid UTF-8 into U+FFFD instead of
  returning an empty string, so a mangled legacy title degrades to visible replacement
  characters rather than silently emitting nothing.
- **JSON-LD body** (`<script type="application/ld+json">`): `json_encode($data,
  JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP |
  JSON_HEX_APOS | JSON_HEX_QUOT)`. The four `HEX_*` flags escape `< > & ' "` to `\uXXXX`,
  which is what makes `</script>` inside a title impossible to express. `htmlspecialchars`
  must **not** be applied here — inside a `<script>` element the content is not HTML-parsed,
  and double-escaping would corrupt the values (FR-027 requires them to match the visible
  content exactly).

**Title collision**: the shell template already contains `<title>online-trash</title>`.
The renderer **strips any existing `<title>…</title>`** before injecting its block ahead of
`</head>`, so a document never carries two. Stripping (rather than requiring a placeholder
comment in `frontend/index.html`) keeps the source shell valid and self-serving in dev.

---

## D6 — Field limits and truncation (FR-008)

| Field | Limit | Source |
|---|---|---|
| `<meta name="description">` | 155 chars | Google's typical snippet cut |
| `og:title` / `twitter:title` | 60 chars | Common unfurl card cut |
| `og:description` / `twitter:description` | 200 chars | Common unfurl card cut |
| `<title>` | **not truncated** | The browser tab already elides; truncating would change existing behaviour (FR-009) |

Truncation is a new pure helper `App\Utils\Str::truncateWords(string $value, int $limit)`:
returns `$value` untouched when short enough, else cuts at the last word boundary at or before
`$limit - 1` and appends `…`. Never cuts mid-word; never truncates visible page content
(there is none — the body is unchanged).

---

## D7 — Preview image selection (FR-005, FR-006)

Resolution order, first hit wins:

1. **Image meme** — the widest numeric size that exists on disk. `MediaPath::IMAGE_SIZES` is
   `['original', '1200', '800', '500', '300', '100']`, and `TrashpostImageService::numericSizes()`
   drops the `original` entry (its array key stays a string where the numeric ones are cast to
   int), so `imageData()['sizes']` is the numeric variants alone, widest-first — i.e. this is
   `$image['sizes'][0]['url']`.
2. **Image meme with no variants** — `$image['original']`.
3. **YouTube meme** — `Storage::disk('public')->url($post->youtube_thumbnail)`, the still already
   downloaded once at upload time by `YoutubeThumbnailService`. **No network call is made from
   the shell route**; a row with a null `youtube_thumbnail` falls through to (4).
4. **Fallback** — the branded site image, `frontend/public/logo-light.png`, served from the
   SPA origin.

All four are already absolute: the `public` disk's `url` is `APP_URL . '/storage'`
(`config/filesystems.php:46`) and `APP_URL` is the canonical origin in production. The logo is
absolutised against the same constant. FR-003's "single canonical origin" holds because
`deploy/nginx-edge/online-trash.com.conf` already 301s `www` → apex.

`twitter:card` is `summary_large_image` when the image came from (1)–(3), and `summary` when it
came from (4) — a square logo in a large-image card renders as a stretched banner.

**Not done**: generating a new social-card image size. The spec puts the variant pipeline out
of scope, and the 1200 variant already exists wherever the source was large enough.

---

## D8 — Sitemap shape (FR-016, FR-019, FR-020)

**Decision**: `/sitemap.xml` is **always a sitemap index**, never a flat urlset. It lists:

- `/sitemaps/static.xml` — the public static addresses (in practice `/` alone; everything else
  in the SPA route table is `noindex` per FR-012)
- `/sitemaps/posts-{n}.xml` — publicly visible permalinks, **50,000 per file**, newest first

**Rationale**:

- Always-an-index means the response shape never changes as the corpus grows, so there is no
  "crossed the threshold" transition to test or to get wrong. The chunk sits at FR-019's URL
  ceiling exactly (50,000) and nowhere near its byte ceiling (≈6 MB of the permitted 50 MB), so
  the archive fits in the fewest files the protocol allows — one, for any corpus this site is
  likely to reach — while still splitting correctly if it ever grows past 50,000.
- Chunk pages are read with a **keyset** walk on `id` (`where('id', '<', $last)
  ->orderByDesc('id')->limit(50000)`), not `offset()`. Offset paging re-scans the whole prefix
  per chunk, which is what would put the last chunk of a large archive over SC-011.
- The walk is **descending** so `posts-1.xml` opens with the newest uploads: a crawler that
  fetches only the first child, or budgets its crawl within a child, spends that budget on fresh
  memes. Descending means an upload shifts entries across page boundaries rather than appending
  to the last page — acceptable because each child is rebuilt whole every hour, so a boundary is
  never observed half-shifted.
- Each child and the index are cached independently for 1 hour (`seo:sitemap:v1:*`), so a
  crawler pulling every chunk in sequence costs one build, not N.
- `<lastmod>` is the meme's `created_at` (Assumptions: memes are immutable once uploaded).
  `<changefreq>` and `<priority>` are omitted deliberately — the major engines ignore them.

**Visibility**: the listing query must be the *same* rule as the public feed, not a second copy
(spec Assumptions: "This feature introduces no second definition of visibility"). `TrashpostService::visible()`
is currently `private`. Promote the rule to a local scope `Trashpost::scopePubliclyVisible()`
and have both `TrashpostService::visible()` and `SitemapService` call it — one definition, two
callers.

---

## D9 — robots.txt (FR-021)

Served by a Laravel route as `text/plain; charset=UTF-8`. Content is generated from the same
`SpaRoutes` `noindex` set that drives FR-012, so the two can never disagree:

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

`/storage/` is deliberately **not** disallowed (FR-023 — image crawlers must reach the media).
The `Sitemap:` line is absolutised from `APP_URL`, so the dev and e2e origins emit their own.

---

## D10 — Compression (FR-029, FR-030, FR-031)

**Decision**: `gzip` in `deploy/web/default.conf` (the origin that actually produces every
response), and the same block in `deploy/nginx-edge/online-trash.com.conf` so the setting holds
however the stack is reached:

```nginx
gzip              on;
gzip_vary         on;              # Vary: Accept-Encoding — required for correct caching
gzip_proxied      any;             # compress even though the request arrived proxied
gzip_comp_level   5;               # ~95% of the ratio at a fraction of level 9's CPU
gzip_min_length   1024;
gzip_types        text/plain text/css application/javascript application/xml
                  application/xml+rss application/json image/svg+xml;
```

**Rationale / details**:

- `text/html` is compressed by `gzip on` unconditionally and must **not** be listed in
  `gzip_types` (nginx errors on the duplicate). This covers the shell.
- `gzip_proxied any` is load-bearing: the origin's responses are produced for a request that
  arrived from the edge, and the default (`off`) would skip them.
- Images, GIF/WebP and video are absent from `gzip_types`, so they are never re-compressed
  (FR-031). Already-`immutable` `/storage/` responses stay byte-identical.
- A client without `Accept-Encoding: gzip` gets the identity response unchanged (FR-030) — this
  is nginx's default behaviour, asserted rather than configured.
- Brotli is **not** used: `ngx_brotli` is not in `nginx:alpine` and would mean building a custom
  image — a dependency decision (Principle I) for a marginal gain over gzip on a 1 vCPU box.

Expected effect on SC-005: the 250,120-byte `index-*.js` compresses to roughly 80 KB, i.e. a
~68% reduction on the dominant asset of a first visit.

---

## D11 — Degradation when metadata cannot be produced (FR-038)

**Decision**: `ShellController` wraps **only** the metadata resolution in `try/catch(Throwable)`.
On failure it `report()`s the exception and falls back to generic site metadata + `noindex`,
status `200`. The SPA boots and surfaces the failure through its existing error states.

A **missing shell template** is deliberately *not* covered by this fallback: there is no
useful page to serve without it, so it is a `500` and a loud log. The `entrypoint.sh` assertion
makes it a boot-time failure in practice, which is where a packaging error belongs. This carve-out
is recorded in the spec's Edge Cases ("The shell itself unavailable") so the `500` asserted by the
tests traces to a stated requirement rather than reading as an FR-038 breach.

The `catch` sits around resolution, not around rendering, so a bug in the renderer surfaces as
a real error instead of being silently swallowed into generic metadata.

---

## D12 — Structured data (FR-024–FR-028)

One `<script type="application/ld+json">` per meme page containing a `@graph` of two nodes:

- `ImageObject` (image meme) with `contentUrl`, `name`, `datePublished`, `author` (`Person`),
  `url` — or `VideoObject` (YouTube meme) with `thumbnailUrl`, `embedUrl`
  (`https://www.youtube.com/embed/{id}`, composed from the **re-validated** id via
  `App\Utils\Youtube::extractId`, never from the raw column), `uploadDate`, `name`.
- `BreadcrumbList` (FR-026): home feed → this meme.

Non-public memes emit **no** JSON-LD at all (FR-028) — not an empty graph. Every value is read
from the same `PageMeta` object that produced the `og:` tags, which is what makes FR-027
("every value matches the social preview metadata") true by construction rather than by
convention.

`VideoObject` requires `description`; the generic site description is used when a meme has none,
matching the `og:description` fallback.

---

## D13 — Page structure (US6)

- **FR-032**: `HomePage` gains a real, visible `<h1>`. `FeedItem` already renders titles at
  `<h2>` (`FeedItem.tsx:35`), so the level below is correct with no change there, and
  `PostPage`'s `<h1>` is on a different route. The heading is styled in
  `frontend/src/styles/theme.css` against the existing custom properties, so it is legible in
  both appearances and at every breakpoint (Principles IV and VIII, FR-034). It is **not**
  visually hidden — a screen-reader-only `h1` would satisfy the checker while leaving the page
  looking unlabelled.
- **FR-033**: the `?after=` canonical is emitted **server-side** by `ShellController` (the
  canonical for any `/` request is the bare origin, query stripped). Doing it client-side would
  put it behind the JavaScript that crawlers do not run — the exact failure this feature exists
  to fix.

---

## D14 — Latency (SC-011: 300 ms p95, cold cache)

Cold-cache work for `/posts/{hash}`: one indexed lookup on the unique `hash` column, up to six
`file_exists` calls via `TrashpostImageService::imageData()` against the mounted media tree, one
template read, and string assembly. All local, no network. The template read is memoised per
process. Warm requests are one file-cache read.

The one thing that could breach the budget is a `YoutubeThumbnailService::ensure()` call, which
performs a 5-second-timeout HTTP GET. D7 forbids it on this path: the shell route reads the
stored `youtube_thumbnail` column and falls back to the branded image if it is null.

---

## Open items deliberately left to implementation

- The exact site-level description copy (spec Assumptions: new copy, written during
  implementation). It lands in `config/seo.php`, not in code.
- Whether `/sitemaps/static.xml` grows beyond `/` — it will when a public author or tag page
  exists, neither of which does today.
