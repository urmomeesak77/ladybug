# Implementation Plan: SEO & Social-Sharing Discoverability

**Branch**: `016-seo-discoverability` | **Date**: 2026-07-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/016-seo-discoverability/spec.md`

## Summary

Today every address on online-trash.com returns the same 462-byte SPA shell with
`<title>online-trash</title>`, status `200`, uncompressed. Shared meme links unfurl as blank
cards, crawlers see no snippet and no path past the newest ten memes, and `/robots.txt` and
`/sitemap.xml` return HTML.

The fix is to move **the `<head>` and the status code** — and only those — to the server.
`deploy/web/default.conf` stops falling back to the static `index.html` and instead forwards
every non-file address to Laravel (`try_files $uri @shell`). A new `ShellController` resolves
the address's metadata, injects it into the built shell, and answers `200` or `404` as
appropriate. `/robots.txt` and a chunked `/sitemap.xml` become real Laravel routes. nginx gains
`gzip`. The SPA's routing, data fetching, views, and rendered output are untouched; the only
frontend change in the whole feature is an `<h1>` on the home feed.

No new dependency, no schema change, no new stored data.

## Technical Context

**Language/Version**: PHP 8.3 (Laravel 12) backend; TypeScript 5.x / React 18 (Vite) frontend;
nginx (alpine) at two layers.

**Primary Dependencies**: None added (FR-035, Principle I). Everything uses what is already
installed: Laravel's router/cache/Storage, `App\Utils\Youtube`, `TrashpostImageService`,
nginx's built-in `ngx_http_gzip_module`.

**Storage**: MySQL 8.0 via Eloquent — **read-only** for this feature, no migration. Derived
metadata and rendered sitemaps live in the existing cache store (`CACHE_STORE=file`).

**Testing**: PHPUnit (backend, mirrored under `backend/tests/`, sqlite `:memory:` only);
Vitest + Testing Library (frontend, mirrored under `frontend/tests/`); ≥90% line coverage
gated in CI on both stacks. Compression is nginx configuration and is verified by `curl`
against a real nginx (production or a locally built `deploy/web` image), documented in
`quickstart.md` §4.

**Target Platform**: Linux containers on a 1 vCPU / 960 MiB Zone.eu VPS; edge nginx →
`ladybug-web` (nginx, SPA + media) → `ladybug-php` (php-fpm) → `ladybug-mysql`.

**Project Type**: Web application — decoupled Laravel API + React SPA, single canonical origin
in production (`https://online-trash.com`, `www` already 301s to apex).

**Performance Goals**: Shell response ≤300 ms server time at p95 on a **cold** metadata cache
(SC-011). Warm path is a single file-cache read. First-visit transfer down ≥60% (SC-005).

**Constraints**:

- The **served document** must stay byte-identical below `</head>` and introduce no extra
  round-trip before first render (FR-009, SC-009). The one permitted change to the *rendered*
  page is the home feed's `<h1>` (FR-032), which React mounts inside `#root` after boot and
  which FR-009 names as its sole exception; nothing else visible may move.
- A metadata failure must degrade to generic metadata + `noindex` at the normal status, never
  to a `5xx` (FR-038).
- Metadata is a function of public visibility **only**, never of the requester — this is what
  makes one cache entry per address correct (FR-039).
- No user-agent branching: everyone gets the same response for the same address.

**Scale/Scope**: ~10–50k memes today, growing slowly. 6 user stories, 40 functional
requirements. ~9 new backend classes + 3 controllers, 1 new config file, 1 model scope, 1
frontend heading, 4 deployment-config edits. No API change.

## Constitution Check

*GATE: evaluated before Phase 0, re-evaluated after Phase 1 design.*

| Principle | Verdict | Basis |
|---|---|---|
| **I. Minimal Dependencies** | **PASS** | Zero new npm/Composer packages (FR-035). Metadata composition, JSON-LD, sitemap XML and word-boundary truncation are all in-house helpers of a few dozen lines. An SSR framework and a prerender service were both evaluated and rejected in research D1 precisely on this principle. gzip uses nginx's built-in module; brotli was rejected because it would require a custom nginx image (research D10). |
| **II. Coding Conventions** | **PASS** | PHP: `declare(strict_types=1)`, PSR-12, 4-space, typed signatures, functions <30 lines — the class split in Project Structure exists to keep them there. TS: 2-space, semicolons. Comments explain *why* (e.g. why `gzip_proxied any` is load-bearing), never *what*. No closures where a named method will do (`SpaRoutes`, `PageMetaService` are classes of methods; the sitemap keyset walk is an explicit loop, not a `chunk()` callback). |
| **III. Browser-Native Navigation** | **PASS** | Strengthens it: every view already had a real URL, and now that URL also reports an honest status and declares a canonical. The feed's 10-per-batch / 200-then-Load-more behaviour and scroll restoration are untouched. Verification obligation: the shell's `404` must not change how the SPA routes — it renders the same `NotFoundPage` it does today (FR-014, quickstart §5.4). |
| **IV. Theme & Accessibility** | **PASS** | The one piece of new visible markup is the home feed's `<h1>` (FR-032). It is a real, visible heading styled against the existing theme custom properties — legible in both appearances, not `sr-only`. Heading order stays sequential (`h1` → `FeedItem`'s existing `h2`). No information is conveyed by colour. `<meta name="viewport">` and existing `alt`/`aria` are unchanged. |
| **V. Stable Meme Identifiers** | **PASS** | Sitemap `<loc>`, canonical, `og:url`, JSON-LD `url` and the metadata cache key all use the 10-char `hash`. No database id appears in any emitted document. The cache key is `sha1(path)`, which contains the hash but never an id. |
| **VI. Security & Input Validation** | **PASS, with named obligations** | (a) Meme-supplied values are escaped **per position**: `htmlspecialchars(ENT_QUOTES\|ENT_SUBSTITUTE)` in attributes, `json_encode` with `JSON_HEX_TAG\|JSON_HEX_AMP\|JSON_HEX_APOS\|JSON_HEX_QUOT` in JSON-LD — never one rule for both (research D5). Injection vectors are enumerated as test vectors in the shell-response contract. (b) YouTube embed URLs are composed from a **re-validated** id via `App\Utils\Youtube::extractId()`, never from the raw column. (c) All queries go through Eloquent; the sitemap keyset walk binds its parameters. (d) A non-public meme's title, description, author and image must appear nowhere in the response for **any** requester — an invariant of `PageMeta`, with its own tests (SC-003). (e) The new routes are public and read-only; none accepts a body, and none is reachable at `/api`. |
| **VII. Test Coverage & Organization** | **PASS** | ≥90% line coverage on both stacks (FR-037). Every new source file has a mirrored test listed in `quickstart.md` §1. Design is testable by construction: `PageMetaService` takes a path and returns a value object; `ShellRenderer` takes a template string and a `PageMeta`; `SpaRoutes` is pure. The shell template path is config-driven so tests use a fixture instead of a build artifact. |
| **VIII. Responsive Layout** | **PASS** | Only the `<h1>` is added to the rendered page; it uses relative units and inherits the existing fluid layout. Verified at 320 px / tablet / desktop (quickstart §5.3). Nothing in the `<head>` affects layout. |

**Technology & Architecture Constraints**: no stack deviation. Laravel + Sanctum, MySQL via
Eloquent, React 18 + React Router + Vite all unchanged. The changes to `deploy/web/default.conf`,
`deploy/nginx-edge/online-trash.com.conf` and `deploy/php/Dockerfile` are deployment
configuration, not stack additions.

**Post-Phase-1 re-evaluation**: re-run against the completed design (research D1–D14, the three
contracts, and the data model). **No gate changed verdict.** Two things were tightened during
design rather than after it: the `PageMeta::site()` single-constructor rule (which turns
Principle VI obligation (d) from a review item into a structural invariant), and the promotion
of the visibility rule to `Trashpost::scopePubliclyVisible()` so the sitemap cannot develop a
second definition of "public".

## Project Structure

### Documentation (this feature)

```text
specs/016-seo-discoverability/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 — decisions D1–D14
├── data-model.md        # Phase 1 — derived entities, cache keys, config
├── contracts/           # Phase 1
│   ├── shell-response.md
│   ├── sitemap.md
│   └── robots-and-compression.md
├── quickstart.md        # Phase 1 — validation guide
└── tasks.md             # Phase 2 — created by /speckit-tasks, NOT by this command
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── Http/Controllers/
│   │   ├── ShellController.php          # NEW — composes the shell, chooses the status
│   │   ├── SitemapController.php        # NEW — index + static + posts-{page}
│   │   └── RobotsController.php         # NEW — text/plain, generated from SpaRoutes
│   ├── Models/
│   │   └── Trashpost.php                # scopePubliclyVisible() — the single visibility rule
│   ├── Services/
│   │   ├── PageMetaService.php          # NEW — resolve per path, cache, forget on transition
│   │   ├── SitemapService.php           # NEW — keyset chunks, cached XML
│   │   ├── ModerationService.php        # + forget the meme's metadata on every transition
│   │   └── TrashpostService.php         # + forget on auto-activate; visible() → the new scope
│   ├── Support/
│   │   ├── PageMeta.php                 # NEW — the value object (3 construction paths)
│   │   ├── SpaRoutes.php                # NEW — address table, mirrors frontend/src/App.tsx
│   │   ├── ShellRenderer.php            # NEW — strip <title>, inject head block, escape
│   │   └── StructuredData.php           # NEW — ImageObject / VideoObject / BreadcrumbList
│   └── Utils/
│       └── Str.php                      # + truncateWords()
├── config/
│   └── seo.php                          # NEW — site name/description, shell path, limits
├── resources/spa/index.html             # build artifact (baked by deploy/php/Dockerfile)
├── routes/web.php                       # robots + sitemap routes, then the shell catch-all
└── tests/
    ├── Feature/Http/Controllers/{Shell,Sitemap,Robots}ControllerTest.php
    └── Unit/
        ├── Services/{PageMetaService,SitemapService}Test.php
        ├── Support/{PageMeta,SpaRoutes,ShellRenderer,StructuredData}Test.php
        └── Utils/StrTest.php            # + truncateWords cases

frontend/
├── src/
│   ├── pages/HomePage.tsx               # + the single <h1> (FR-032)
│   └── styles/theme.css                 # + its themed, responsive styling
└── tests/pages/HomePage.test.tsx        # + heading-level assertions

deploy/
├── web/default.conf                     # try_files $uri @shell; + @shell fastcgi; + gzip
├── nginx-edge/online-trash.com.conf     # + gzip
├── php/Dockerfile                       # + node build stage → resources/spa/index.html
└── php/entrypoint.sh                    # + assert the shell template is readable

docker-compose.yml                       # dev: mount frontend/index.html as the shell template
docs/DEPLOYMENT.md                       # + how the shell is served, sitemap/robots, gzip
```

**Structure Decision**: the existing decoupled two-app layout is kept exactly as-is. This
feature adds no directory and no fourth surface — the backend gains three controllers, two
services and four support classes under the directories they already belong in, and the
frontend gains one heading. The only genuinely new thing in the tree is
`backend/resources/spa/index.html`, which is a **build artifact** copied in by the php image's
new node stage (research D2) and is git-ignored, not committed.

### Recommended build order

The user stories are independently valuable and are built in priority order, each shippable
alone:

1. **Foundation** — `SpaRoutes`, `PageMeta`, `ShellRenderer`, `config/seo.php`, the nginx
   `@shell` fallback, the php image's node stage, and `Str::truncateWords`. Nothing is
   user-visible yet; the shell serves through Laravel with site-level metadata.
2. **US1 (P1)** — `PageMetaService` + `ShellController` meme path, caching, invalidation. This
   is the story that converts every existing permalink from worthless to shareable.
3. **US2 (P2)** — `SitemapService`, `SitemapController`, `RobotsController`.
4. **US3 (P3)** — gzip at both nginx layers. Fully independent of 1–3; could ship first if a
   quick win is wanted. It is also the only step that runs a real nginx, so it carries the
   verification that the foundation's `try_files`/`@shell` wiring actually routes `/` and
   `/posts/{hash}` to Laravel — a check the PHPUnit suite structurally cannot make.
5. **US4 (P4)** — the `404` paths. Mostly falls out of the foundation's route table; the work
   is the three-way `/posts/{hash}` status split and its tests.
6. **US5 (P5)** — `StructuredData`.
7. **US6 (P6)** — the home-feed `<h1>` and the `?after=` canonical. Deliberately last: it is
   the only change that touches the visible page, so it carries the most regression risk per
   unit of value.

## Complexity Tracking

**No Constitution violations.** Nothing in this design requires justification against a
principle, so the table stays empty.

Two design choices will nonetheless draw a reviewer's eye. Neither is a violation; both are
recorded here so the answer is written down rather than re-litigated:

| Accepted risk | Why it is accepted | What keeps it safe |
|---|---|---|
| The SPA route table exists in both `frontend/src/App.tsx` and `App\Support\SpaRoutes` | Only the server can set a per-address status code, and the server therefore has to know which addresses exist. Every alternative (nginx-encoded route list, generated manifest, catch-all `200`) is worse: two of them scatter the duplication further, the third abandons FR-013 entirely. | A cross-referencing comment in both files naming the other, a `SpaRoutesTest` case per address, and a table that changes roughly once per feature. |
| `deploy/php/Dockerfile` builds the frontend a second time to obtain `dist/index.html` | The php container must serve the **built** shell with its content-hashed asset tags, and it has no other way to get it. Both images are built from the same commit in one `release.yml` matrix and deployed under one `LADYBUG_TAG`, and Vite's hashes are deterministic, so they cannot disagree. | Buildx `gha` layer cache makes the repeat build cheap after the first. `entrypoint.sh` asserts the artifact exists at boot. `quickstart.md` §7 verifies every asset the served shell references answers `200`. If CI time later becomes the binding constraint, the recorded follow-up is to build the frontend once in a `release.yml` prep job and pass `dist/` to both image builds. |
