# Tasks: SEO & Social-Sharing Discoverability

**Input**: Design documents from `/specs/016-seo-discoverability/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. FR-037 and Constitution Principle VII put this feature under the ≥90%
line-coverage gate on both stacks, and `quickstart.md` §1 names every mirrored suite. Test tasks
are therefore first-class here and are written **before** the code they cover.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and
shipped on its own, in the priority order the plan's "Recommended build order" sets out.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: `[US1]`…`[US6]` — the spec user story this task serves
- Every task names its exact file path

## Path Conventions

Web application, decoupled two-app layout (plan.md → Project Structure):

- Backend: `backend/app/`, `backend/config/`, `backend/routes/`, tests mirrored under `backend/tests/`
- Frontend: `frontend/src/`, tests mirrored under `frontend/tests/`
- Deployment: `deploy/`, `docker-compose.yml`

**Toolchain note**: there is no local PHP. Every backend command runs through Docker
(`docker compose exec backend …`), and any PHP edit needs `docker compose restart backend`
before it takes effect (dev opcache runs `validate_timestamps=0`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The configuration and pure helpers everything else reads. No behaviour change yet.

- [x] T001 [P] Create `backend/config/seo.php` with the keys from data-model.md → Configuration: `site_name` (`online-trash`), `site_description` (new copy, written here — research.md leaves this deliberately to implementation), `shell_path` (`base_path('resources/spa/index.html')`), `fallback_image` (`/logo-light.png`), `sitemap_chunk` (`50000`), `cache_ttl` (`3600`), `untitled_label` (`Untitled meme`)
- [x] T002 [P] Extend `backend/tests/Unit/Utils/StrTest.php` with `truncateWords` cases: shorter-than-limit returns untouched, exactly-at-limit untouched, long value cuts at the last word boundary at or before `limit - 1` and appends `…`, no mid-word cut, a single word longer than the limit, an empty string, and a multibyte value
- [x] T003 Implement `App\Utils\Str::truncateWords(string $value, int $limit): string` in `backend/app/Utils/Str.php` per research D6, making T002 pass
- [x] T004 [P] Add the shell test fixture `backend/tests/fixtures/spa-shell.html` (lower-case
  `fixtures/`, matching the four existing references in the suite — the directory is real on a
  case-sensitive filesystem) — a minimal built-shell lookalike carrying `<title>online-trash</title>`, `<meta name="viewport">`, `<link rel="icon">`, `<div id="root">` and a hashed `/assets/index-*.js` tag, so tests never depend on a Vite build artifact

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The one visibility rule, the address table, the value object, the renderer, the
route, and the deployment plumbing that carries the shell. After this phase every address serves
through Laravel with **site-level** metadata and status `200` — nothing user-visible has changed,
but every user story below has something to build on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### The single visibility rule (research D8)

- [x] T005 [P] **Extend** the existing `backend/tests/Unit/Models/TrashpostTest.php` (do not overwrite it) with cases covering `scopePubliclyVisible`: includes an activated, non-deleted post; excludes a pending post (`activated_at` null); excludes a soft-deleted post; excludes a pending **and** soft-deleted post
- [x] T006 Implement `scopePubliclyVisible(Builder $query): Builder` on `backend/app/Models/Trashpost.php` (`whereNotNull('activated_at')`; `SoftDeletes` already excludes trashed rows), with a comment naming it as the feature's single definition of public visibility
- [x] T007 Rewrite `TrashpostService::visible()` (`backend/app/Services/TrashpostService.php:199`) to delegate to `Trashpost::publiclyVisible()`, and confirm `backend/tests/Unit/Services/TrashpostServiceTest.php` still passes unchanged — the feed's behaviour must not move

### The address table (research D3)

- [x] T008 [P] Add `backend/tests/Unit/Support/SpaRoutesTest.php` with one case per address in the data-model.md → `SpaRoute` table: `/` static+indexable; `/posts/{hash}` dynamic; `/login`, `/register`, `/account`, `/upload`, `/verify-email`, `/admin/trashposts`, `/admin/users` static+non-indexable; `/verify-email/{hash}` dynamic+non-indexable; `/nope`, `/posts`, `/posts/x/y` unmatched; plus `disallowedPaths()` returning exactly the six robots.txt prefixes. Also assert the **hash format** is enforced by the pattern, not by a query: `/posts/abc` (too short) and `/posts/aB3dEf7GhJx` (11 chars) are unmatched, while a conforming 10-char `[A-Za-z0-9-_]` value matches (Constitution V) — a malformed identifier must never reach the database
- [x] T009 Implement `backend/app/Support/SpaRoutes.php` — a class of static methods exposing `match(string $path): ?string`, `isIndexable(string $path): bool`, `indexableStaticPaths(): list<string>` and `disallowedPaths(): list<string>`. Named methods and an explicit table, no closures. Add a cross-referencing comment naming `frontend/src/App.tsx` as the mirror that must be kept in step

### The value object and the renderer

- [x] T010 [P] Add `backend/tests/Unit/Support/PageMetaTest.php` covering the `PageMeta::site()` path and the data-model.md invariants: `imageUrl` never null and always absolute; `structuredData !== null` implies `isIndexable === true`; a non-indexable `PageMeta` carries only site-level title/description/image; cache round-trip (`toArray()` → `fromArray()`) reproduces an identical object
- [x] T011 Implement `backend/app/Support/PageMeta.php` — an immutable value object with the nine fields from data-model.md, the `PageMeta::site(string $canonical, bool $isIndexable)` constructor, and `toArray()`/`fromArray()` for the cache. `forPost()` is added in Phase 3; this phase ships the single generic constructor that FR-011/FR-013/FR-015/FR-038 all share
- [x] T012 [P] Add `backend/tests/Unit/Support/ShellRendererTest.php`: an existing `<title>` in the template is stripped so the output holds exactly one; the injected block lands immediately before `</head>`; everything below `</head>` is byte-identical to the input template; attribute values are escaped with `ENT_QUOTES | ENT_SUBSTITUTE`; each escaping vector from contracts/shell-response.md → Escaping produces no injected element; `robots` is emitted only when `isIndexable === false`; a template with no `</head>` is handled without corrupting the document
- [x] T013 Implement `backend/app/Support/ShellRenderer.php` — takes a template string plus a `PageMeta` and returns the composed document, per contracts/shell-response.md → Head block. JSON-LD emission is stubbed until Phase 7; escaping rules are final here (research D5)

### The route and the controller skeleton

- [x] T014 Replace the `Route::get('/', fn () => abort(404))` stub in `backend/routes/web.php` with the shell catch-all `Route::get('/{path?}', [ShellController::class, 'show'])->where('path', '^(?!(api|up|sanctum|storage)(/|$)).*$')`, with a comment recording why the exclusion is needed (PHPUnit calls the app with no nginx in front, so an unguarded catch-all would shadow the API routes in tests — research D3 → Guard). The `(/|$)` is load-bearing: the exclusion must match a whole **path segment**, not a prefix. A bare `(?!api|up|sanctum|storage)` also drops `/uptime`, `/apixyz` and `/storage-wars` out of the shell route, and they would then answer with the framework's own error page instead of the site's not-found view — a direct FR-014 breach
- [x] T015 Implement `backend/app/Http/Controllers/ShellController.php` `show()` — read the template from `config('seo.shell_path')` (memoised per process), build a `PageMeta::site()` from `SpaRoutes`, render, and return `200` with `Content-Type: text/html; charset=UTF-8` and `Cache-Control: no-cache`. The per-meme path and the status split come in Phases 3 and 6
- [x] T016 Add `backend/tests/Feature/Http/Controllers/ShellControllerTest.php` with the baseline cases: `/` returns `200` with site metadata and **no** `robots` tag; `/login` returns `200` **with** `noindex, follow`; the response body below `</head>` matches the fixture byte-for-byte; the `Cache-Control: no-cache` header is present; `/api/*`, `/up` and `/sanctum/*` are **not** shadowed by the catch-all; and the **near-miss** addresses `/uptime`, `/apixyz` and `/storage-wars` still resolve through the shell route (a `404` carrying the shell body, never a framework error page — FR-014, the T014 segment-anchoring guard)

### Shell template delivery (research D2)

- [x] T017 [P] Add `backend/resources/spa/` to `backend/.gitignore` — the shell is a build artifact copied in by the php image, never committed
- [x] T018 [P] Mount `frontend/index.html` at the configured shell path in the `backend` service of `docker-compose.yml`, so the dev API origin can answer the shell route for `curl` verification (the dev SPA at `:5173` keeps being served by Vite and does not go through Laravel)
- [x] T019 [P] Rework the SPA fallback in `deploy/web/default.conf`:
  1. Change `location /` from `try_files $uri $uri/ /index.html` to `try_files $uri @shell` — note there is **no** `$uri/` term any more, deliberately.
  2. Add an **exact-match** `location = / { try_files /__shell__ @shell; }` **and remove the `index index.html;` directive** from the server block.
  3. Add a `location @shell` block duplicating the existing `^/(api|up|sanctum)` fastcgi block (including the `resolver` + `set $upstream` pattern, which exists so nginx starts even when php is not yet resolvable).

  Steps 1 and 2 are one change, not two: for `GET /` the request URI is `/`, and a `try_files` term ending in a slash is a **directory** test — `$uri` matches the document root itself, so `try_files $uri @shell` alone would hand `/` to the index module and serve the static `dist/index.html`, never reaching Laravel. The home feed would silently keep today's empty `<head>` in production while every PHPUnit test passed, because PHPUnit calls Laravel with no nginx in front. The exact-match location with an unsatisfiable first term forces `/` into `@shell`; dropping `index` removes the fallback that made the bug quiet. Record this reasoning in a comment — it is the least obvious line in the file
- [x] T020 [P] Add a `node:20` build stage to `deploy/php/Dockerfile` that runs `npm ci && npm run build` in `frontend/` and copies **only** `dist/index.html` to `/var/www/html/resources/spa/index.html`, with a comment recording why the php image builds the frontend a second time (plan.md → Complexity Tracking)
- [x] T021 [P] Add a readable-shell-template assertion to `deploy/php/entrypoint.sh`, matching the shape of its existing `.env` assertion — a packaging error must fail loudly at boot, not silently at request time (research D11)

**Checkpoint**: `curl http://localhost:8000/` returns the shell with a real `<head>`; the SPA at
`:5173` is untouched; `docker compose exec backend php artisan test` is green.

> ⚠️ The dev origin is `artisan serve` with **no nginx**, so this checkpoint cannot prove T019 is
> correct. The nginx routing of `/` and `/posts/{hash}` is verified against a locally built
> `deploy/web` image in T040, which is the only task in the feature that runs a real nginx. Do not
> treat Phase 2 as done on the dev curl alone.

---

## Phase 3: User Story 1 — A shared meme link shows what it is (Priority: P1) 🎯 MVP

**Goal**: Every publicly visible meme permalink carries its own title, description, canonical
address, and preview image in the initial response, with nothing leaked for a hidden meme.

**Independent Test**: `curl -s http://localhost:8000/posts/$HASH | sed -n '/<head>/,/<\/head>/p'`
shows that meme's title, description, canonical and `og:image` with no JavaScript in the loop;
the same address opened in a browser renders exactly as it does today.

### Tests for User Story 1 ⚠️

> Write these first and confirm they fail before implementing T024–T027.

- [x] T022 [P] [US1] Add `backend/tests/Unit/Services/PageMetaServiceTest.php`: resolves a publicly visible meme to its own metadata; resolves a pending meme and a soft-deleted meme to site-level metadata with `isIndexable === false`; the key is `seo:meta:v1:{sha1(path)}` so two addresses can never collide; a second resolve inside the TTL performs **no** query; `forget($hash)` drops exactly that key
- [x] T023 [P] [US1] Extend `backend/tests/Feature/Http/Controllers/ShellControllerTest.php` with the AS1.1–AS1.6 scenarios: an image meme's own title/description/canonical/`og:`/`twitter:` set; a YouTube meme carrying its stored thumbnail and `twitter:card=summary_large_image`; a meme with no title falling back to `Untitled meme` + the site description; a meme with no media falling back to `logo-light.png` with `twitter:card=summary`; a pending meme and a soft-deleted meme leaking **no** part of their title, description, author or image to any requester **including an admin** (FR-010, SC-003); and each escaping vector from contracts/shell-response.md

### Implementation for User Story 1

- [x] T024 [US1] Add `PageMeta::forPost(Trashpost $post): self` to `backend/app/Support/PageMeta.php` — title as `{title} - online-trash`, description and social fields truncated via `Str::truncateWords` to the D6 limits (155 / 60 / 200), canonical as the absolute permalink
- [x] T025 [US1] Implement the preview-image resolution order of research D7 in `backend/app/Support/PageMeta.php`: widest existing numeric variant from `TrashpostImageService::imageData()` → `original` → the stored `youtube_thumbnail` via the `public` disk URL → `config('seo.fallback_image')` absolutised against `APP_URL`, setting `isLargeImageCard` false only for the fallback. **No** `YoutubeThumbnailService::ensure()` call on this path — it makes a 5 s HTTP request and would breach SC-011
- [x] T026 [US1] Implement `backend/app/Services/PageMetaService.php` — `forPath(string $path): PageMeta` doing the `Cache::remember("seo:meta:v1:".sha1($path), config('seo.cache_ttl'), …)` lookup, and `forget(string $hash): void`. The meme lookup uses `withTrashed()` so a hidden row is distinguishable from a purged one, and a non-public row returns `PageMeta::site()` unchanged
- [x] T027 [US1] Wire `PageMetaService` into `ShellController::show()` in `backend/app/Http/Controllers/ShellController.php` so a `/posts/{hash}` address resolves per-meme metadata; every other address keeps the Phase 2 site-level path

### Cache invalidation (FR-040)

- [x] T028 [US1] Add a `PageMetaService::forget($hash)` call to each of `activate`, `deactivate`, `delete`, `restore` and `purge` in `backend/app/Services/ModerationService.php`, injected via the constructor in the same explicit style `RatingService` already uses (research D4 — no observer)
- [x] T029 [US1] Add the same `forget()` call to the trusted-uploader auto-activation path `TrashpostService::activate()` (`backend/app/Services/TrashpostService.php:127`)
- [x] T030 [US1] Extend `backend/tests/Unit/Services/ModerationServiceTest.php` and `backend/tests/Unit/Services/TrashpostServiceTest.php` to assert every one of those six transitions forgets that meme's metadata key — a deactivated meme's permalink must degrade on the **very next** request, not an hour later

**Checkpoint**: US1 is shippable alone. Every existing permalink now unfurls with its own title
and image; hidden memes leak nothing.

---

## Phase 4: User Story 2 — Search engines can reach every meme (Priority: P2)

**Goal**: A crawler starting at `/robots.txt` reaches every publicly visible meme through a
chunked sitemap index, and is told plainly which areas to skip.

**Independent Test**: `curl -s http://localhost:8000/sitemap.xml` returns a `<sitemapindex>`;
the `<loc>` count in `posts-1.xml` equals `Trashpost::publiclyVisible()->count()`;
`curl -sI http://localhost:8000/robots.txt` reports `text/plain`.

### Tests for User Story 2 ⚠️

- [x] T031 [P] [US2] Add `backend/tests/Unit/Services/SitemapServiceTest.php`: the index always lists `static.xml` plus `ceil(visibleCount / chunk)` post children, and stays valid with zero visible memes (spec edge case "Empty site"); a chunk holds descending-`id` (newest-first) permalinks with ISO-8601 `<lastmod>` from `created_at` and no `<changefreq>`/`<priority>`; pending and soft-deleted memes never appear (FR-017); an out-of-range or non-numeric page yields nothing; a second render inside the TTL issues **no** query (AS2.6). **Plus the split path (FR-019, AS2.3)**: with `config('seo.sitemap_chunk')` overridden to `2` and three visible memes seeded, the index lists `posts-1.xml` and `posts-2.xml`, the two chunks **partition** the set with no overlap and no gap across the keyset boundary, and `posts-3.xml` yields nothing. At the production chunk of 50,000 a realistic fixture never crosses a boundary, so without the override the only genuinely risky line in the walk — the `where('id', '<', $lastId)` hand-off — is never executed
- [x] T032 [P] [US2] Add `backend/tests/Feature/Http/Controllers/SitemapControllerTest.php`: all three routes return `application/xml; charset=UTF-8` with `Cache-Control: public, max-age=3600`; `/sitemaps/posts-99.xml` and `/sitemaps/posts-abc.xml` return `404`; the routes are **not** intercepted by the shell catch-all (FR-022)
- [x] T033 [P] [US2] Add `backend/tests/Feature/Http/Controllers/RobotsControllerTest.php`: `Content-Type` is `text/plain; charset=UTF-8` — asserted as a regression guard against today's `text/html` shell response, not merely that the body looks right; the body disallows exactly the six `SpaRoutes::disallowedPaths()` prefixes; `/storage/` and `/assets/` are **not** disallowed (FR-023); the `Sitemap:` line is absolutised from `APP_URL`

### Implementation for User Story 2

- [x] T034 [US2] Implement `backend/app/Services/SitemapService.php` — `index()`, `staticUrls()` and `postsPage(int $page)` returning rendered XML, each cached under `seo:sitemap:v1:*` for `config('seo.cache_ttl')`. The post walk is an explicit **newest-first** keyset loop (`where('id', '<', $lastId)->orderByDesc('id')->limit($chunk)`) over `Trashpost::publiclyVisible()`, never `offset()` and never a `chunk()` callback (research D8, Principle II)
- [x] T035 [US2] Implement `backend/app/Http/Controllers/SitemapController.php` with `index()`, `static()` and `posts(string $page)`, returning `404` for a non-numeric or out-of-range page
- [x] T036 [P] [US2] Implement `backend/app/Http/Controllers/RobotsController.php` — `text/plain; charset=UTF-8`, body generated from `SpaRoutes::disallowedPaths()` plus a `Sitemap:` line absolutised from `APP_URL`, so FR-012 and FR-021 cannot drift apart (research D9)
- [x] T037 [US2] Register `/robots.txt`, `/sitemap.xml`, `/sitemaps/static.xml` and `/sitemaps/posts-{page}.xml` in `backend/routes/web.php` **above** the shell catch-all from T014, with a comment recording that `frontend/public/robots.txt` and `frontend/public/sitemap.xml` must never be added — anything in `public/` becomes a real file in `dist/` and would win nginx's `try_files`, silently shadowing these routes

**Checkpoint**: US1 and US2 both work independently. The whole archive is crawlable.

---

## Phase 5: User Story 3 — Pages load fast enough to rank (Priority: P3)

**Goal**: Text responses transfer compressed; media does not.

**Independent Test**: `curl -sI -H 'Accept-Encoding: gzip'` against a JS asset reports
`content-encoding: gzip` and `vary: Accept-Encoding`; the same against a `/storage/` image
reports neither.

**Note**: the compression work itself (T038–T040) is fully independent of Phases 3–4 and could
ship first if a quick win is wanted. It is nginx configuration only, so it is verified by `curl`
against a real nginx (production or a locally built `deploy/web` image), not by PHPUnit; the dev
stack does not exercise it. **T040b is the exception**: it rides along on the same locally built
image to prove T019's shell routing, so it depends on Phase 2 having landed.

- [x] T038 [P] [US3] Add the gzip block from contracts/robots-and-compression.md to `deploy/web/default.conf` (`gzip on; gzip_vary on; gzip_proxied any; gzip_comp_level 5; gzip_min_length 1024;` plus the `gzip_types` list), with a comment recording that `text/html` must **not** appear in `gzip_types` — `gzip on` already covers it and nginx rejects the duplicate — and that `gzip_proxied any` is load-bearing because the origin's responses arrive proxied from the edge
- [x] T039 [P] [US3] Add the identical gzip block to `deploy/nginx-edge/online-trash.com.conf`, so the behaviour holds however the stack is reached
- [x] T040 [US3] Verify per quickstart.md §4 against a locally built `deploy/web` image: a JS asset is gzipped, a `--compressed` fetch of `/` is byte-identical to an `Accept-Encoding: identity` fetch (FR-029), an `identity` request gets a valid uncompressed response (FR-030), and a `/storage/` image carries no `Content-Encoding` (FR-031). For SC-005, sum the compressed vs uncompressed sizes of the **whole compressible payload of a first visit** — the document plus every `/assets/*.js` and `/assets/*.css` it references — and record the ratio against that same set uncompressed (the 250,120 B `index-*.js` is the dominant term but not the whole measurement); meme media is excluded by SC-005 itself
- [x] T040b [US3] **This is the only task in the feature that runs a real nginx, so it also carries T019's routing proof** (see the Phase 2 checkpoint warning). Against the same locally built `deploy/web` image: `GET /` returns the **Laravel-composed** shell — assert a `<link rel="canonical">` is present, which the static `dist/index.html` can never have — and `GET /posts/{hash}` likewise; `GET /assets/{real hashed asset}` is still served **statically** by nginx and does not reach PHP; `GET /storage/{real media path}` still serves off the bind mount with `Cache-Control: public, immutable`. A pass on `/posts/{hash}` with a fail on `/` is the exact signature of the `index index.html` / directory-match trap T019 exists to avoid

**Checkpoint**: SC-005's ≥60% first-visit reduction is measured, not assumed.

---

## Phase 6: User Story 4 — Missing pages report as missing (Priority: P4)

**Goal**: The three-way status split on `/posts/{hash}`, `404` for unmatched addresses, and the
FR-038 guarantee that a metadata failure never becomes a `5xx`.

**Independent Test**: `/posts/zzzzzzzzzz` → `404`, `/nonexistent-route` → `404`, a hidden meme →
`200`, a public meme → `200`; all four still render the SPA's existing views in a browser.

### Tests for User Story 4 ⚠️

- [x] T041 [P] [US4] Extend `backend/tests/Feature/Http/Controllers/ShellControllerTest.php` with the contracts/shell-response.md → Status codes table: publicly visible meme `200`; pending meme `200`; soft-deleted meme `200`; purged/never-existing hash `404`; unmatched address `404`; every `noindex` static address `200`. Assert the `404` body is the **same** shell so the SPA renders its existing `NotFoundPage` (FR-014)
- [x] T042 [US4] Add the FR-038 degradation case to the same file `backend/tests/Feature/Http/Controllers/ShellControllerTest.php` (sequential after T041 — same file): with `PageMetaService` bound to a double that throws, every public address still returns its normal status with generic site metadata plus `noindex` — never a `5xx`. Assert separately that a **missing shell template** is deliberately *not* covered by the fallback and surfaces as a `500` (research D11)

### Implementation for User Story 4

- [x] T043 [US4] Implement the three-way status split in `backend/app/Http/Controllers/ShellController.php`: `SpaRoutes::match()` decides matched-vs-`404`, and for `/posts/{hash}` the `withTrashed()` lookup already in `PageMetaService` distinguishes hidden (`200`) from absent (`404`)
- [x] T044 [US4] Wrap **only** the metadata resolution in `ShellController::show()` in `try/catch (Throwable)`, `report()` the exception, and fall back to `PageMeta::site($canonical, isIndexable: false)` at the status the route table already decided. The `catch` must not enclose the rendering call — a renderer bug has to surface as a real error rather than be swallowed into generic metadata (research D11)

**Checkpoint**: SC-004 holds — no address that does not resolve to real content reports success.

---

## Phase 7: User Story 5 — Memes qualify for rich search results (Priority: P5)

**Goal**: Every publicly visible meme carries a valid JSON-LD `@graph`; no non-public meme
carries any.

**Independent Test**: a meme permalink's `<script type="application/ld+json">` parses as JSON and
passes https://validator.schema.org/ with 0 errors.

### Tests for User Story 5 ⚠️

- [x] T045 [P] [US5] Add `backend/tests/Unit/Support/StructuredDataTest.php`: an image meme yields an `ImageObject` with `url`, `contentUrl`, `name`, `description`, `datePublished` and a `Person` author; a YouTube meme yields a `VideoObject` with `thumbnailUrl`, `uploadDate` and an `embedUrl` composed from a **re-validated** id; a meme whose stored `youtube` value no longer parses **omits** `embedUrl` rather than composing one from raw input (Principle VI); every graph carries a two-item `BreadcrumbList` (FR-026); a `VideoObject` with no meme description falls back to the site description; encoding uses the six `json_encode` flags from research D5 so `</script>` inside a title is inexpressible, with **no** `htmlspecialchars` on top

### Implementation for User Story 5

- [x] T046 [US5] Implement `backend/app/Support/StructuredData.php` building the `@graph` per contracts/shell-response.md → Structured data, reading **every** value off the same `PageMeta` that produced the `og:` tags so FR-027 holds by construction
- [x] T047 [US5] Populate `PageMeta::$structuredData` in `PageMeta::forPost()` (`backend/app/Support/PageMeta.php`) and leave it `null` in `PageMeta::site()`, so a non-public meme emits **no** JSON-LD at all rather than an empty graph (FR-028)
- [x] T048 [US5] Replace the T013 stub in `backend/app/Support/ShellRenderer.php` with the real `<script type="application/ld+json">` emission, skipped entirely when `structuredData` is `null`
- [x] T049 [US5] Extend `backend/tests/Feature/Http/Controllers/ShellControllerTest.php`: a public image meme and a public YouTube meme each emit exactly one parseable JSON-LD block whose values match the page's `og:` tags; a pending and a soft-deleted meme emit none

**Checkpoint**: SC-007 — 100% of publicly visible permalinks pass a structured-data validator.

---

## Phase 8: User Story 6 — Page structure reads correctly (Priority: P6)

**Goal**: One `<h1>` on the home feed, and `?after=` cursors canonicalising to the bare origin.

**Independent Test**: `document.querySelectorAll('h1').length === 1` on `/`, meme titles still
`<h2>`; `curl -s "http://localhost:8000/?after=$HASH" | grep canonical` shows the un-cursored
origin.

**Note**: deliberately last — it is the only change in the feature that touches the visible page.

### Tests for User Story 6 ⚠️

- [x] T050 [P] [US6] Extend `frontend/tests/pages/HomePage.test.tsx` with heading-level assertions: exactly one `role="heading"` at level 1, its accessible name names the site or the feed, and `FeedItem` titles remain at level 2 with no skipped level between them
- [x] T051 [P] [US6] Extend `backend/tests/Feature/Http/Controllers/ShellControllerTest.php` with the FR-033 canonical cases: `/?after={cursor}` canonicalises to the bare origin with the query stripped, and every other address canonicalises to itself, absolute, without query or fragment

### Implementation for User Story 6

- [x] T052 [US6] Add a real, visible `<h1>` to `frontend/src/pages/HomePage.tsx` inside the existing `<section aria-label="Memes">`. It must **not** be `sr-only` — a screen-reader-only heading satisfies a checker while leaving the page looking unlabelled (research D13)
- [x] T053 [US6] Style the heading in `frontend/src/styles/theme.css` against the existing theme custom properties and in relative units, so it is legible in both appearances and intact at 320 px, tablet and desktop (Principles IV and VIII, FR-034)
- [x] T054 [US6] **Extend** the canonical built in Phase 2 (T011/T015 already emit one, and T016 already asserts it for `/`) so that it strips the query string and fragment in `backend/app/Http/Controllers/ShellController.php` / `PageMeta::site()`. This is a refinement of existing behaviour, not a new code path. It must stay **server-side** — doing it client-side would put it behind the JavaScript crawlers do not run, which is the exact failure this feature exists to fix
- [ ] T055 [US6] **BLOCKED — needs a browser.** The Chrome extension is not connected, so
  quickstart §5 steps 2–5 (both appearances, 320 px/tablet/desktop, Back/Forward/Refresh, the
  Network panel round-trip check) are unrun. Step 1 (heading order) IS verified automatically by
  T050's two jsdom cases. Verify per quickstart.md §5 in the dev SPA: heading order sequential, both appearances legible, no horizontal scroll at 320 px, Back/Forward/Refresh still restore view and scroll anchor on `/`, `/?after=…` and `/posts/{hash}` (Principle III), and the Network panel shows the same request sequence as before the feature with only a larger document response. The new `<h1>` is the **one** permitted visible difference (FR-009's sole exception, SC-009); anything else that moved on the page is a regression

**Checkpoint**: all six stories functional and independently verifiable.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T056 [P] Add the cross-referencing comment to `frontend/src/App.tsx` naming `backend/app/Support/SpaRoutes.php` as the server-side mirror of the route table, closing the loop opened in T009 (plan.md → Complexity Tracking)
- [ ] T057 [P] Document in `docs/DEPLOYMENT.md` how the shell is served (nginx `@shell` → Laravel, and the php image's node stage that bakes `resources/spa/index.html`), the sitemap and robots routes, the gzip settings, and the post-deploy asset-integrity check from quickstart.md §7
- [ ] T058 Run the backend gates and hold the ≥90% line-coverage floor: `docker compose exec backend vendor/bin/pint --test`, then `php artisan test --coverage-clover=coverage.xml`, then `php ../.github/scripts/check_coverage.py coverage.xml` (SC-010, FR-037)
- [ ] T059 Run the frontend gates: `docker compose exec frontend npm run lint` and `npm run test -- --coverage`, holding the same floor across all of `src/`
- [ ] T060 Confirm **FR-035** by diffing the dependency manifests against `master` — `git diff master -- backend/composer.json backend/composer.lock frontend/package.json frontend/package-lock.json` must be **empty**. FR-035 otherwise has no verifying gate anywhere in this feature, and T020 adds an `npm ci` build stage, which makes an accidental frontend dependency easy to miss. Then confirm FR-036 by diffing `backend/routes/api.php` and `backend/app/Http/Resources/` against `master` (must be empty) and by re-running the untouched `backend/tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php`, `CreatePostTest.php` and `CommentControllerTest.php` — no JSON API route, response shape or status code may have moved, and the upload and media pipelines must be untouched
- [ ] T061 Walk quickstart.md §§2–3 end to end against the dev stack — shell metadata, hidden-meme leakage, escaping vectors, status codes, sitemap membership against `Trashpost::publiclyVisible()->count()`, and robots content type
- [ ] T062 Post-deploy validation per quickstart.md §§6–8: schema.org validator against a production permalink (SC-007), a real unfurl in Slack/Discord (SC-001), the shell's asset tags all answering `200` (the D2 failure mode), and the cold-cache p95 measured by the **procedure in quickstart §8** — clear the cache, 20 sequential timed requests to a permalink, 95th percentile of server time-to-first-byte, first (cold) request included — against the 300 ms budget (SC-011)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: depends on Phase 1 (`config/seo.php` and `Str::truncateWords`) — **blocks every user story**
- **US1 (Phase 3)**: depends on Phase 2
- **US2 (Phase 4)**: depends on Phase 2 (needs `SpaRoutes` and the route file's ordering). Independent of US1
- **US3 (Phase 5)**: T038–T040 depend on nothing in this feature — pure nginx config, could ship first. T040b depends on Phase 2 (it verifies the T019 shell routing on the same nginx build)
- **US4 (Phase 6)**: depends on Phase 2 for the route table and on US1 for the `withTrashed()` lookup that separates hidden from purged
- **US5 (Phase 7)**: depends on US1 — JSON-LD reads its values off `PageMeta::forPost()`
- **US6 (Phase 8)**: the `<h1>` depends on nothing; the canonical rule depends on Phase 2
- **Polish (Phase 9)**: depends on whichever stories shipped

### User Story Dependencies

- **US1 (P1)**: after Phase 2. No dependency on another story — the MVP
- **US2 (P2)**: after Phase 2. Independent of US1, though a crawlable archive of metadata-less pages is worth little, which is why US1 comes first
- **US3 (P3)**: the compression work is fully independent of every other story; only T040b's routing proof needs Phase 2
- **US4 (P4)**: builds on US1's lookup; the rest falls out of Phase 2's route table
- **US5 (P5)**: strictly additive on top of US1
- **US6 (P6)**: independent, sequenced last for regression risk

### Within Each Story

- Tests are written and failing before the implementation they cover
- Value objects (`PageMeta`) before services (`PageMetaService`) before controllers (`ShellController`)
- `SpaRoutes` before anything that asks whether an address exists or is indexable

### Parallel Opportunities

- **Phase 1**: T001, T002 and T004 all touch different files — run together; T003 follows T002
- **Phase 2**: three independent test/impl pairs — T005–T007 (model), T008–T009 (`SpaRoutes`), T010–T013 (`PageMeta` + `ShellRenderer`) — plus the four deployment tasks T018–T021, which touch four separate files and nothing else in the phase
- **Phase 3**: T022 and T023 in parallel; then T024→T025 (same file, sequential), T026, T027; then T028/T029 in parallel
- **Phase 4**: all three test tasks (T031–T033) in parallel; `RobotsController` (T036) is independent of the sitemap work
- **Phase 5**: T038 and T039 are different files; T040 and T040b both need the built image, so run them together against one build
- **Phases 6–8**: test tasks within each phase are parallel; implementation tasks touching `ShellController.php` or `PageMeta.php` are not
- **Across stories**: with more than one developer, US2, US3 and the US6 `<h1>` can all proceed alongside US1 once Phase 2 lands

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Three independent test-first pairs, plus the deployment plumbing:
Task: "SpaRoutesTest in backend/tests/Unit/Support/SpaRoutesTest.php"       # T008
Task: "PageMetaTest in backend/tests/Unit/Support/PageMetaTest.php"         # T010
Task: "ShellRendererTest in backend/tests/Unit/Support/ShellRendererTest.php" # T012
Task: "TrashpostTest in backend/tests/Unit/Models/TrashpostTest.php"        # T005

# Four deployment files, no overlap:
Task: "docker-compose.yml shell-template mount"                             # T018
Task: "deploy/web/default.conf try_files $uri @shell"                       # T019
Task: "deploy/php/Dockerfile node build stage"                              # T020
Task: "deploy/php/entrypoint.sh shell assertion"                            # T021
```

## Parallel Example: User Story 1

```bash
# Both test suites first, in parallel:
Task: "PageMetaServiceTest in backend/tests/Unit/Services/PageMetaServiceTest.php"  # T022
Task: "US1 scenarios in backend/tests/Feature/Http/Controllers/ShellControllerTest.php" # T023

# Then the two invalidation call sites, which are different services:
Task: "forget() in backend/app/Services/ModerationService.php"                     # T028
Task: "forget() in backend/app/Services/TrashpostService.php"                      # T029
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 — Setup (T001–T004)
2. Phase 2 — Foundational (T005–T021) — **blocks everything**
3. Phase 3 — US1 (T022–T030)
4. **STOP and VALIDATE**: quickstart.md §2 end to end, especially the hidden-meme leakage checks (SC-003) and the escaping vectors
5. Deploy. Every existing permalink is now shareable — the single highest-value increment in the feature.

### Incremental Delivery

1. Setup + Foundational → the shell serves through Laravel, nothing user-visible changed
2. + US1 → shareable permalinks (**MVP**, ship it)
3. + US2 → the whole archive is crawlable
4. + US3 → ~68% off the dominant first-visit asset
5. + US4 → no soft-404s
6. + US5 → rich results
7. + US6 → correct heading structure and cursor canonicalisation

Each step is independently deployable and none breaks the one before it.

### Parallel Team Strategy

Phase 2 is the bottleneck and is worth staffing together — its four sub-groups (model scope,
`SpaRoutes`, `PageMeta`/`ShellRenderer`, deployment plumbing) split cleanly across four people.
Once it lands: developer A takes US1 → US4 → US5 (they share `ShellController` and `PageMeta`,
so one owner avoids constant conflicts), developer B takes US2, developer C takes US3 and US6.

---

## Notes

- `[P]` means a different file with no incomplete dependency. `ShellController.php` and
  `PageMeta.php` are each touched by four phases — tasks against them are never `[P]` with one
  another.
- Backend commands run through Docker; there is no local PHP. Restart the backend container after
  every PHP edit (`docker compose restart backend`) or opcache will keep serving the old code.
- Tests run on sqlite `:memory:` only — `Tests\TestCase` hard-aborts against anything else. Never
  point a test run at the dev database.
- Commit after each task or logical group; stop at any checkpoint to validate a story on its own.
- The two accepted risks from plan.md → Complexity Tracking (the duplicated route table, the
  second frontend build in the php image) are settled decisions. T056 and T020's comment are what
  keep them safe; do not re-litigate them mid-implementation.
