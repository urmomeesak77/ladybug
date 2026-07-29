# Quickstart: validating SEO & Social-Sharing Discoverability

**Feature**: `016-seo-discoverability` | **Contracts**: [shell-response](./contracts/shell-response.md) ·
[sitemap](./contracts/sitemap.md) · [robots-and-compression](./contracts/robots-and-compression.md)

This is a **validation guide**, not an implementation guide. Every scenario below is something
you run and read the output of. Implementation detail belongs in `tasks.md`.

The instrument for most of this is `curl`, not a browser — the entire point of the feature is
what the origin emits *before* any JavaScript runs, and a browser's devtools show you the
post-hydration DOM.

---

## Prerequisites

- Docker Desktop running. There is no local PHP — every backend command goes through a
  container (project convention).
- Dev stack up: `docker compose up -d` (backend `:8000`, frontend `:5173`, MySQL `:4444`).
- After any PHP edit: `docker compose restart backend` (dev opcache runs with
  `validate_timestamps=0`).

---

## 1. Automated gates (run these first — they are what CI enforces)

```powershell
# Backend: lint, then tests with coverage. Never against the dev DB — phpunit.xml pins
# sqlite :memory: and Tests\TestCase hard-aborts if anything else is configured.
docker compose exec backend vendor/bin/pint --test
docker compose exec backend php artisan test --coverage-clover=coverage.xml
docker compose exec backend php ../.github/scripts/check_coverage.py coverage.xml   # ≥90% gate

# Frontend
docker compose exec frontend npm run lint
docker compose exec frontend npm run test -- --coverage
```

New/extended suites to expect green (mirroring source, Principle VII):

| Source | Test |
|---|---|
| `app/Http/Controllers/ShellController.php` | `tests/Feature/Http/Controllers/ShellControllerTest.php` |
| `app/Http/Controllers/SitemapController.php` | `tests/Feature/Http/Controllers/SitemapControllerTest.php` |
| `app/Http/Controllers/RobotsController.php` | `tests/Feature/Http/Controllers/RobotsControllerTest.php` |
| `app/Services/PageMetaService.php` | `tests/Unit/Services/PageMetaServiceTest.php` |
| `app/Services/SitemapService.php` | `tests/Unit/Services/SitemapServiceTest.php` |
| `app/Support/{SpaRoutes,ShellRenderer,StructuredData,PageMeta}.php` | `tests/Unit/Support/*Test.php` |
| `app/Services/ModerationService.php` (cache invalidation) | existing `tests/Unit/Services/ModerationServiceTest.php`, extended |
| `src/pages/HomePage.tsx` (the `<h1>`) | `tests/pages/HomePage.test.tsx` |

---

## 2. Shell metadata — the US1 acceptance path

The dev SPA at `:5173` is served by Vite and does **not** go through Laravel (research D2), so
point `curl` at the API origin, where the shell route answers.

```bash
# Pick a real, publicly visible meme
HASH=$(curl -s http://localhost:8000/api/posts | python -c "import sys,json;print(json.load(sys.stdin)['data'][0]['hash'])")

# The whole head, with no JavaScript anywhere in the loop
curl -s http://localhost:8000/posts/$HASH | sed -n '/<head>/,/<\/head>/p'
```

**Expected**: exactly one `<title>` carrying the meme's title plus ` - online-trash`; a
`description`; a `canonical` pointing at the meme's own absolute address; the full `og:` and
`twitter:` sets; an `og:image` that is an absolute `/storage/...` URL; one
`<script type="application/ld+json">`. No `noindex`.

```bash
# Home feed → site-level metadata, no noindex, canonical = origin root
curl -s http://localhost:8000/ | grep -E 'og:|canonical|robots'

# Page cursor canonicalises to the home feed (FR-033)
curl -s "http://localhost:8000/?after=$HASH" | grep canonical
```

**Expected**: `<link rel="canonical" href="http://localhost:8000/">` — no query string.

### Hidden memes must leak nothing (FR-010, SC-003)

```bash
# Deactivate one as an admin, then look at its permalink as an anonymous requester
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/posts/$HASH   # → 200
curl -s http://localhost:8000/posts/$HASH | grep -i "$KNOWN_TITLE"           # → no match
curl -s http://localhost:8000/posts/$HASH | grep robots                      # → noindex, follow
```

**Expected**: status stays `200` (FR-015 — a permitted viewer still gets a working page), the
meme's title/author/image appear **nowhere**, and the robots tag is present. Reactivate and
confirm the meme's own metadata returns on the *very next* request — not an hour later
(FR-040).

### Escaping (FR-007)

Upload (or seed) a meme titled `" /><script>alert(1)</script><meta a="` and confirm the
response contains no injected element and the JSON-LD still parses:

```bash
curl -s http://localhost:8000/posts/$EVILHASH | grep -c '<script>alert'      # → 0
curl -s http://localhost:8000/posts/$EVILHASH \
  | sed -n 's/.*application\/ld+json">\(.*\)<\/script>.*/\1/p' | python -m json.tool
```

### Status codes (US4)

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/posts/zzzzzzzzzz   # → 404
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/nonexistent-route  # → 404
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/login              # → 200 + noindex

# Near-misses on the catch-all's exclusion list (FR-014). Each must return the SHELL with a
# 404, never Laravel's own error page — the guard excludes whole segments, not prefixes.
for p in uptime apixyz storage-wars; do
  curl -s http://localhost:8000/$p | grep -c 'id="root"'                          # → 1
done
```

---

## 3. Sitemap and robots (US2)

```bash
curl -sI http://localhost:8000/robots.txt | grep -i content-type    # → text/plain
curl -s  http://localhost:8000/robots.txt
curl -sI http://localhost:8000/sitemap.xml | grep -i content-type   # → application/xml
curl -s  http://localhost:8000/sitemap.xml
curl -s  http://localhost:8000/sitemaps/posts-1.xml | grep -c '<loc>'
```

**Expected**: `robots.txt` is plain text, names the sitemap, and disallows the six private
areas without disallowing `/storage/`. `/sitemap.xml` is a `<sitemapindex>`. The post chunk's
`<loc>` count equals the number of publicly visible memes (capped at 50,000), newest first.

**Membership check** — the count in `posts-1.xml` must equal:

```powershell
docker compose exec backend php artisan tinker --execute="echo App\Models\Trashpost::publiclyVisible()->count();"
```

Deactivate a meme, wait out the cache (or `php artisan cache:clear`), and confirm it leaves the
listing (AS2.5). Retrieve the listing twice inside the interval with the query log on and
confirm the second retrieval issues no query (AS2.6).

---

## 4. Compression (US3)

Compression is nginx configuration and therefore only observable on a stack that runs nginx —
i.e. production or a locally built `deploy/web` image. The dev stack (Vite + `artisan serve`)
does not exercise it.

```bash
# Against production, or a locally built ladybug-web container
curl -sI -H 'Accept-Encoding: gzip' https://online-trash.com/assets/index-*.js \
  | grep -iE 'content-encoding|vary'
# → content-encoding: gzip   /   vary: Accept-Encoding

# Byte-identity after decompression
curl -s --compressed https://online-trash.com/ > a.html
curl -s -H 'Accept-Encoding: identity' https://online-trash.com/ > b.html
cmp a.html b.html && echo "identical"

# Media must NOT be re-compressed
curl -sI -H 'Accept-Encoding: gzip' https://online-trash.com/storage/image/trash/800/a/xxx.jpg \
  | grep -i content-encoding    # → no output
```

Transfer-size check for SC-005 — the **compressible payload of a first visit**, i.e. the document
plus every `/assets/*.js` and `/assets/*.css` it references. Meme media is excluded by SC-005
itself (it is already compressed and deliberately not re-compressed, FR-031):

```bash
BASE=https://online-trash.com
ASSETS=$(curl -s $BASE/ | grep -o '/assets/[^"]*')
for enc in gzip identity; do
  total=0
  for u in / $ASSETS; do
    n=$(curl -s -o /dev/null -w '%{size_download}' -H "Accept-Encoding: $enc" "$BASE$u")
    total=$((total + n))
  done
  echo "$enc: $total bytes"
done
```

**Expected**: the gzip total is ≤40% of the identity total (SC-005's ≥60% reduction). The
250,120 B `index-*.js` → ≈80 KB is the dominant term but not the whole measurement.

### The shell really routes through Laravel (T019, T040b)

This is the only place in the feature where a real nginx is exercised, so it is where the
`try_files` wiring is proved. The dev stack is `artisan serve` with no nginx and cannot show it.

```bash
# Against a locally built deploy/web image (or production)
curl -s $BASE/            | grep -c 'rel="canonical"'   # → 1
curl -s $BASE/posts/$HASH | grep -c 'rel="canonical"'   # → 1
```

**Expected**: `1` for **both**. The static `dist/index.html` can never carry a canonical, so a `0`
means that address is still being served from disk and never reached Laravel. A pass on
`/posts/{hash}` with a fail on `/` is the exact signature of the root-path directory-match trap
(research D1) — check that `location = /` is present and `index index.html;` is gone.

```bash
# Static and media paths must NOT have been pulled into the shell route
curl -sI $BASE/assets/index-*.js  | grep -i cache-control   # → public, immutable (nginx, not PHP)
curl -sI $BASE/storage/...        | grep -i cache-control   # → public, immutable
```

---

## 5. Page structure and no visible regression (US6, SC-009, FR-009)

Browser work, in the dev SPA at `http://localhost:5173`:

1. **Heading order** — the home feed shows exactly one `<h1>`, meme titles stay `<h2>`. Check
   with the accessibility tree in devtools, or `document.querySelectorAll('h1').length === 1`.
2. **Both appearances** — toggle OS light/dark (or the site's override) and confirm the new
   heading is legible in both (Principle IV).
3. **Every width** — 320 px, tablet, desktop. No horizontal scroll, nothing clipped
   (Principle VIII).
4. **Navigation unchanged** — Back / Forward / Refresh on `/`, `/?after=…`, and `/posts/{hash}`
   restore the correct view and scroll anchor (Principle III).
5. **No extra round-trip** — the Network panel on a cold load shows the same request sequence as
   before this feature, with the document response merely larger.

---

## 6. External validators (US1, US5 — post-deploy)

Run once against production after the deploy:

- **Structured data** — https://validator.schema.org/ against `https://online-trash.com/posts/{hash}`.
  Expected: 0 errors (SC-007).
- **Open Graph / unfurl** — paste a meme permalink into a real client (Slack, Discord, Signal)
  and confirm a titled card with the meme's image (SC-001). Facebook's Sharing Debugger and
  X's Card Validator are useful for cache-busting a stale card.
- **Sitemap** — submit `https://online-trash.com/sitemap.xml` in Google Search Console and check
  that no soft-404s are reported (SC-004). Search Console *account setup and submission* are
  operational follow-ups, explicitly out of scope for the code in this feature.

---

## 7. Production-specific checks after deploy

```bash
# The shell template really made it into the php image (D2)
docker compose -f docker-compose.prod.yml exec ladybug-php ls -l resources/spa/index.html

# The asset tags in the served shell match assets that exist
curl -s https://online-trash.com/ | grep -o '/assets/[^"]*' | while read a; do
  curl -s -o /dev/null -w "%{http_code} $a\n" "https://online-trash.com$a"; done
```

**Expected**: every asset referenced by the shell answers `200`. A `404` here means the php and
web images were built from different commits — the one failure mode D2's design exists to
prevent, so it is worth the ten seconds to confirm.

---

## 8. Cold-cache latency (SC-011 — post-deploy)

SC-011's budget is 300 ms of **server** time at p95 against a cold metadata cache. The procedure
is fixed so two people measuring it get the same number:

```bash
docker compose -f docker-compose.prod.yml exec ladybug-php php artisan cache:clear

# 20 sequential requests; the first is the cold one and IS included in the percentile.
for i in $(seq 20); do
  curl -s -o /dev/null -w '%{time_starttransfer}\n' https://online-trash.com/posts/$HASH
done | sort -n | awk '{v[NR]=$1} END {printf "p95: %.3fs (n=%d)\n", v[int(NR*0.95+0.999)], NR}'
```

**Expected**: p95 ≤ `0.300`. `time_starttransfer` includes network latency to the VPS, so it is a
ceiling on server time rather than a measurement of it — if it passes, SC-011 passes; if it fails,
re-measure from inside the network before concluding the budget is breached.

The one thing that can blow this budget is a network call on the shell path. If p95 is measured in
seconds rather than milliseconds, check first that nothing reintroduced
`YoutubeThumbnailService::ensure()` into the metadata resolution (research D7, D14).
