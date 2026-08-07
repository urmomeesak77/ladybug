# CLAUDE.md

This file guides Claude Code when working in this repository.

## Project Overview

**Ladybug** is a meme-sharing site (think 9gag.com): users upload images, videos,
and YouTube links and browse an endless feed of entries. The stack is a **React 18
+ Vite (TypeScript)** frontend talking to a **Laravel 12 (PHP 8.2+) + Sanctum**
backend over a JSON API, backed by **MySQL** via Eloquent.

## Current State (as of 2026-08-07)

The project is **past planning**: both `backend/` (Laravel 12) and `frontend/`
(React 18 + Vite + TypeScript) are scaffolded and twenty-one features are implemented.
Features follow the Spec Kit flow (specify → plan → tasks → implement) under `specs/`:

**Documentation gap:** 016-seo-discoverability, 017-google-oauth-login,
018-remember-me-login, 019-video-upload and 020-youtube-shorts-support are implemented
and on `master` but have no entry below — read their `specs/` directories directly.

- **001-infra-scaffold** — `backend/` + `frontend/` skeletons, lint/test tooling,
  CI wired, `/api/health` probe.
- **002-database-schema** — `trashposts` + `users` tables/migrations; posts carry a
  **10-char unique `hash`** public identifier.
- **003-media-storage** — image storage tree with size variants on the `public`
  disk (real media + the ~1.3 GB tree live under `LADYBUG_DATA_ROOT`
  (default `C:\docker_permanent`) at `…\ladybug-storage`, bind-mounted).
- **004-read-feed-api** — read-side JSON API: `GET /api/posts` (newest-first keyset
  feed, 10/page) and `GET /api/posts/{hash}`, including per-image-size URLs.
- **005-frontend-mainpage** — React Home feed (`HomePage`) that consumes the 004 API:
  infinite-scroll feed, image + YouTube rendering, `prefers-color-scheme` theming,
  permalinks (`/posts/{hash}`) on every entry.
- **006-trashpost-page** — single-meme view (`PostPage` at `/posts/{hash}`): title +
  media (image or embedded YouTube) inside the shared site layout, fed by
  `GET /api/posts/{hash}`; `NotFoundPage` for unknown hashes.
- **007-auth-ui** — full-stack auth slice. Backend `AuthController` over **Sanctum
  SPA cookie-session** (`POST /api/register`, `POST /api/login`,
  `POST /api/logout`, `GET /api/user`); frontend `LoginPage`, `RegisterPage`,
  `AccountPage` at `/login`, `/register`, `/account` with inline server-side
  validation, redirect rules, and accessible/themed/responsive forms.
- **008-register-email-verification** — uploading (`POST /api/posts`, `UploadPage` at
  `/upload`) behind a verified-e-mail gate; in-house **ext-gd** image processing with
  size variants (`gifsicle` for animated GIFs) and YouTube link + thumbnail handling;
  signed verification links, resend, `VerifyEmailPage` / `VerifyEmailNoticePage`.
- **009-user-roles** — the closed, ordered role set guest < member < admin < superuser
  (`App\Enums\Role`, `role` column out of `$fillable`), the `role:` middleware, the
  `make:superuser` bootstrap command, and the frontend `RequireRole` guard.
- **010-admin-meme-moderation** — admin console at `/admin/trashposts` over
  `GET /api/admin/posts` + activate / deactivate / soft-delete / restore / purge;
  `ModerationService`. Media stays on the `public` disk in every state so admins can
  view hidden memes; the public API filters hidden memes out at the query level. The
  one-time `php artisan media:republish` (`MediaRepublishCommand`, backed by
  `MediaOwnershipService::ownedPaths`) moves any already-hidden meme's bytes that the
  old move-on-hide code left on the private disk back to `public`; idempotent, safe
  to re-run.
- **011-user-rating-auto-activation** — a signed `users.rating` column (never exposed by
  any API) driven solely by `RatingService`. The model is **state-reflective** (redesign
  2026-07-21, `docs/superpowers/specs/2026-07-21-rating-state-reflective-design.md`): each
  method applies a fixed ±1 — **activate +1** (manual or auto), **deactivate −1**,
  **soft-delete −1**, **restore +1**, and **purge a flat −1** whatever the state. There is
  no per-meme ledger (the old `rating_credited` / `rating_penalized` flags were dropped);
  idempotency comes from the state guards in `ModerationService`, whose `find()` locks the
  row so a repeated/concurrent transition converges to a single delta, and each delta commits
  atomically inside the transition (FR-013). Deletion is now **reversible** (soft-delete −1 /
  restore +1 cancel), unlike the original permanent-penalty model. Uploads are not activated
  unconditionally — `createPost()` activates only for an uploader at or above
  `TRUST_THRESHOLD = 15` or holding admin+; everyone else's upload is created **pending** —
  hidden from the public API but visible with its image in the admin console. The rating
  is purely internal — it drives auto-activation only and is **not** surfaced in any list
  or API response.
- **012-admin-user-list** — admin account console at `/admin/users` over
  `GET /api/admin/users` + `POST .../{hash}/{disable,enable}` (`UserAdminService`,
  `AdminUserResource`), listing every account (name, e-mail, role, verified, created,
  disabled) 100/page. Two nullable `users` columns — `disabled_at` and self-referencing
  `disabled_by` (both out of `$fillable`; the resource exposes the actor's **name**, never
  the id) — carry the state. Disabling is **access revocation only** (research D9): it
  writes only the two columns and never touches the account's memes, activation, or rating.
  A single-click Disable/Enable per row is set-to-target (idempotent, so concurrent actions
  converge) and guarded by `Role::outranks` so an actor can act only on **strictly
  lower** ranks — peers, higher ranks and self are all refused in one comparison.
  Enforcement lives in `EnsureAccountEnabled` (api-group middleware: a disabled account's
  next request → `401`, session torn down) and `AuthController::login` (a disabled account
  signs in to a distinct `403 "This account is disabled."`, checked only **after**
  credentials verify so login is not an account-state oracle). Frontend shares the 010
  paging via `AdminPaging` / `AdminPagination`.
- **013-admin-action-menus** — both admin consoles present their per-row actions through one
  shared in-house kebab menu (`components/admin/ActionMenu.tsx` + the `useMenuKeyboard` hook):
  the WAI-ARIA menu-button pattern (trigger `aria-haspopup="menu"` / `aria-expanded` / text
  `aria-label`, `role="menuitem"` items with a text label + optional icon and additive
  destructive emphasis), keyboard-operable (open→first item, roving arrows, Enter/Space
  activate, Escape → trigger) and dismissible four ways (choose, Escape, outside pointer-down,
  focus-loss); an empty item list renders no trigger. The **only** new server surface is
  `DELETE /api/admin/users/{hash}` (`UserAdminService::destroy` + `UserAdminController::destroy`):
  a **hard delete** (User has no `SoftDeletes` — no tombstone, no audit trail, FR-020) guarded by
  the SAME strict-rank rule as disable/enable, re-checked on the `lockForUpdate`-loaded row inside
  the transaction (peer/higher/self → `403`; unknown hash → `404`). The account's uploaded memes
  are **orphaned, not cascaded** (`trashposts.user_id` → null) and any account it had disabled
  loses only the actor name (`users.disabled_by` → null) via the existing `nullOnDelete` FKs — no
  cascade code, no rating adjustment. The SPA drops the deleted row in place (`useUserAdmin.removeRow`
  / `UserAdminModel.dropRow`) after a `204`; any non-2xx leaves the row untouched. The moderation
  console change (US2) is **presentation-only**: `ModerationActions` renders its existing
  state-dependent action set and confirmations through the same `ActionMenu`, unchanged.
- **014-upload-page-polish** — presentation-only pass over the upload slice (008): the page is
  retitled **Upload**, the form restyled to match the auth (login/register) forms, the
  image/YouTube chooser reworked from checkboxes into an accessible **tablist** (only the active
  tab's input is ever in the DOM), a **required title** enforced client- and server-side, and the
  upload allow-list widened to **WebP** (static + animated, same GD/gifsicle variant pipeline).
- **015-comments-on-trashposts** — flat, plain-text comments on a trashpost's own page. New
  `comments` table (own 10-char `hash`, `trashpost_id` FK **cascadeOnDelete** — fires only on a
  real purge, not a soft delete — nullable `user_id` **nullOnDelete**, `username` snapshot, `body`,
  nullable `hidden_at`; `$fillable` is `body` only). `CommentService` carries the query + the
  create/hide/unhide/delete transitions (newest-first keyset batches of 10 over the comment-hash
  cursor, viewer-aware visibility, a public non-hidden `total` regardless of viewer; hide/unhide are
  set-to-target under `lockForUpdate`; delete is a hard delete). Public nested `CommentController`
  (`GET`/`POST /api/posts/{hash}/comments` — read is viewer-aware/404 like the post show; create is
  behind `auth:sanctum` + `verified` + `throttle:comments`) and admin `Admin\CommentModerationController`
  (`POST .../comments/{hash}/hide|unhide`, `DELETE .../comments/{hash}`) in the existing admin group.
  Frontend `CommentSection` on `PostPage` (composer gated guest→sign-in / unverified→verify /
  verified→form, count, newest-first list, load-more, empty state) over the `useComments` hook +
  `CommentApi`/`CommentModel`; admin+ get the shared `ActionMenu` per row (Hide/Unhide + a text
  "Hidden" badge, confirmed Delete) with counts adjusted only on a real state transition. Bodies are
  rendered as plain-text React children (never `dangerouslySetInnerHTML`). No new dependency.
- **021-gif-viewport-autoplay** — **frontend-only** (the sole `backend/` change is one e2e
  fixture): an animated GIF/WebP plays while it is on screen and freezes on its current frame
  when it leaves, resuming from that exact frame. `MemeImage` (the image branch split out of
  `MemeMedia`, used by both the feed and the permalink page) swaps its `<img>` for a
  `<canvas role="img" aria-label>` — one-way, no added chrome — once `AnimatedImage.probe`
  confirms a multi-frame track via **`ImageDecoder`**. The probe keys off the img's
  `currentSrc` (the srcset variant actually chosen), never `media.src`. `AnimationRegistry`
  holds an **LRU(12)** of decode sessions, pinned while playing so an on-screen post is never
  evicted, plus **page-lifetime** frame positions that outlive eviction; `AnimationPlayer`
  drives a `setTimeout` frame chain (never rAF) honouring `repetitionCount`.
  `useInViewport` starts on the same half-visible rule video uses but **stops on the ratio**,
  so an image freezes earlier than a video pauses — deliberate; `useVideoAutoplay` is
  untouched. A hidden tab freezes (`visibilitychange`). **Safari/iOS has no `ImageDecoder`
  and keeps today's always-animating `<img>`** — the fallback is the unchanged status quo,
  not a degradation. Existing memes need no re-upload or reprocessing. No new dependency.
  Note: dev and e2e serve media cross-origin (SPA :5173/:5174, media :8000/:8001), unlike
  production's single origin, so both nginx configs send `Access-Control-Allow-Origin` on
  `/storage/` — without it the probe's `fetch` is blocked and the takeover silently never
  happens outside prod.

Not built yet: password reset.

Supporting files:

- **`.specify/`** — Spec Kit setup (constitution, templates, scripts, and the
  `git` + `agent-context` extensions).
- **`.specify/memory/constitution.md`** — the binding **Ladybug Constitution
  (v1.2.0)**. Read it before doing anything; its principles are non-negotiable.
- **`docs/CODING_CONVENTIONS.md`** — binding style guide for HTML/CSS/JS/TS/PHP.
- **`docs/superpowers/`** — design specs and implementation plans (currently the
  CI lint+test pipeline).
- **`docs/*.png`** — UI reference screenshots (login, signup, mainpage).
- **`.github/workflows/ci.yml`** — CI pipeline: lint + test jobs for both stacks
  (the frontend Vitest coverage gate spans ALL of `src/`, not just `lib/`), plus an
  `e2e` job that boots the isolated `docker-compose.e2e.yml` stack and runs the
  Playwright specs; `.github/scripts/check_coverage.py` is the ≥90% Clover gate.
- **`deploy/`** — production deployment: Dockerfiles for the php-fpm and nginx+SPA
  images, the prod Compose stack, edge nginx config, and the setup/deploy/backup/
  restore scripts. Runbook in `docs/DEPLOYMENT.md`.

**Local toolchain note:** there is no local PHP — run backend tests/artisan/coverage
through the `php:8.3-cli` Docker container (project convention). The implemented code
uses the prototype's vocabulary (**`Trashpost`** / **`hash`**), not the "Meme" /
"public code" names used as placeholders in the structure sketch below.

**Durable dev data (`LADYBUG_DATA_ROOT`):** all data meant to survive Docker
teardown/uninstall lives OUTSIDE the repo under a single host dir,
`LADYBUG_DATA_ROOT` (default `C:\docker_permanent`): `…\ladybug-mysql` (MySQL
datadir, host bind-mount — not a named volume), `…\ladybug-storage` (media/storage
tree), and `…\ladybug-backups` (`.sql` dumps from `scripts/backup-db.ps1`).
`docker-compose.yml` bakes in the default via `${LADYBUG_DATA_ROOT:-C:/docker_permanent}`,
so the stack runs with zero config; override in a root `.env` (see `.env.example`)
to relocate everything. Because the DB is a bind-mount now, `docker compose down -v`
no longer wipes it — but keep dumping before teardown anyway.

## Existing Prototype — `C:\projects\trash`

A **working earlier prototype** of this same meme site lives at `C:\projects\trash`
(project name "Trashpost"). It is **not part of this repo** but is the best
reference for how the features were already built once. Consult it for patterns,
API shape, and data model before reinventing. Highlights:

- **Backend (Laravel 10):**
  - Controllers: `TrashpostsApiController` (feed `GET /api/posts`, single post
    `GET /api/posts/{hash}`), `AuthController` (Sanctum register/login/logout/user).
  - Models: `Trashpost`, `User`. Migration `create_trashposts_table`.
  - Services: `TrashpostService`, `TrashpostPathService`, `TrashpostPicService`,
    `FileService`, `ImageService`, `UserService`.
  - Utils: `Base64`, `Json`, `Str`. Uses an opaque `{hash}` as the public post
    identifier (compare Constitution Principle V's 10-char `[A-Za-z0-9-_]` code).
- **Frontend (React 18, in `resources/js/`):**
  - Pages: `HomePage`, `TrashPostPage`, `LoginPage`, `RegisterPage`,
    `AccountPage`, `PwdResetPage`, error pages.
  - Components: `Main`, `TopMenu`, `LeftMenu`, `PageLayout`, `TrashPostList`,
    `TrashPostItem`, `FormInputBox`, `NoticeDialog`.
  - Services: `HttpService`, `TrashPostService`, `UserService`; form helpers
    `FormHandler`, `FormValidators`.
  - Built with Vite; uses Bootstrap 5, `react-router-dom`,
    `react-infinite-scroll-component`, `react-player`, `react-youtube`.

Note the prototype predates the constitution — treat its choices as informative,
not authoritative. Where it conflicts with the constitution or
`docs/CODING_CONVENTIONS.md`, those win.

## Key Constraints (from the Constitution — read it in full)

- **Minimal dependencies (NON-NEGOTIABLE):** new npm/Composer deps require explicit
  human approval *before* install, with a written rationale. Prefer small in-house
  helpers over pulling packages.
- **Conventions:** `docs/CODING_CONVENTIONS.md` is binding (2-space JS/TS, semicolons,
  PSR-12 + 4-space + `declare(strict_types=1)` for PHP, functions <50 lines JS / <30
  PHP, braces on single-line bodies, comments explain *why*).
- **Navigation:** real shareable URLs for every view; Back/Forward/Refresh must
  restore state. Feed loads 10 at a time; after 200 entries an explicit "Load more"
  page break advances the page (reflected in the URL).
- **Theming & a11y:** follow `prefers-color-scheme`; persist any manual override;
  color is never the sole signal; `alt` text, `<label>`s, and `role`/`aria-*` required.
- **Meme IDs:** public identifier is an immutable 10-char `[A-Za-z0-9-_]` code (not the
  DB id) used in URLs and single-meme fetches; in the backend it is the `hash` column,
  generated by `App\Utils\Str::createUniqueHash`.
- **Security:** validate all uploads server-side (type/size/well-formedness; parse
  YouTube links, don't embed blindly); ORM/parameterized queries only; escape output
  per context; secrets in env only (`.env` never committed, provide `.env.example`).
- **Tests:** ≥90% line coverage (enforced in CI). Tests live under a top-level
  `tests/` dir mirroring source paths; cover happy path and edge cases.

## File Structure

A decoupled, two-app layout: a `backend/` Laravel API and a separate `frontend/`
React + Vite SPA (each with its own dependency lockfile and its own CI job). This
differs from the prototype, which served React from inside Laravel's `resources/js/`.
The current layout (real names — `Trashpost`/`hash`, not the constitution's
"Meme"/"public code" placeholders):

```
ladybug/
├── backend/                      # Laravel 12 API (PHP 8.2+, Sanctum, MySQL)
│   ├── app/
│   │   ├── Console/Commands/     # SeedMediaCommand
│   │   ├── Http/
│   │   │   ├── Controllers/      # TrashpostsApiController, AuthController
│   │   │   ├── Requests/         # LoginRequest, RegisterRequest
│   │   │   └── Resources/        # TrashpostResource, UserResource
│   │   ├── Models/               # Trashpost, User
│   │   ├── Services/             # TrashpostService, TrashpostImageService, UserService
│   │   ├── Support/              # MediaPath
│   │   └── Utils/                # Base64, Json, Str (Str::createUniqueHash)
│   ├── database/migrations/      # trashposts + users schema (10-char `hash`)
│   ├── routes/api.php            # /posts, /posts/{hash}, register/login/logout/user, /health
│   ├── tests/                    # PHPUnit — mirrors app/ (Principle VII)
│   │   ├── Feature/              # e.g. Http/Controllers/AuthControllerTest.php
│   │   └── Unit/                 # e.g. Services/TrashpostServiceTest.php
│   ├── .env.example
│   ├── composer.json
│   └── pint.json                 # lint config (vendor/bin/pint --test in CI)
│
├── frontend/                     # React 18 + Vite + TypeScript SPA
│   ├── src/
│   │   ├── pages/                # HomePage, PostPage, LoginPage, RegisterPage, AccountPage, NotFoundPage
│   │   ├── components/           # PageLayout, LeftMenu, Feed, FeedItem, MemeMedia,
│   │   │                         #   AuthProvider, AuthField, RequireAuth, RequireAnon, states/
│   │   ├── hooks/                # useFeed, usePost, useAuth, useTheme, useScrollRestoration
│   │   ├── lib/                  # Api, AuthApi, FeedModel/PostModel/AuthModel, FeedCache,
│   │   │                         #   Pagination, ScrollAnchor, Theme, Youtube, PublicCode,
│   │   │                         #   Csrf, UploadApi, UploadModel (one class per module)
│   │   ├── App.tsx               # router
│   │   └── main.tsx              # app entry
│   ├── tests/                    # Vitest + Playwright e2e — mirrors src/ (Principle VII)
│   ├── index.html
│   ├── vite.config.ts
│   ├── eslint config             # `npm run lint` must resolve (CI)
│   └── package.json              # incl. lint + test (vitest) scripts
│
├── docs/                         # conventions, design specs, plans, screenshots
├── .github/workflows/ci.yml      # backend + frontend lint/test jobs
└── .specify/                     # Spec Kit (constitution, templates, scripts)
```

Notes:
- **Tests mirror source** under each stack's `tests/` dir, per Constitution
  Principle VII (e.g. `app/Services/TrashpostService.php` →
  `tests/Unit/Services/TrashpostServiceTest.php`).
- Frontend has no `services/` or `types/` dir: HTTP/data access lives in `lib/`
  (`api.ts`, `authApi.ts`), and shared types are colocated in the `*Model.ts`
  modules they belong to.
- Every `lib/` module is a single class of `static` methods (e.g. `Api.fetchFeed`,
  `Pagination.reducer`, `Csrf.token`), per the `docs/CODING_CONVENTIONS.md` v1.3
  "always prefer classes over standalone functions/closures" rule — call through the
  class, never re-introduce loose exported functions. React function components and
  custom hooks stay as functions (class components can't use hooks); the rule applies
  to logic/helpers only.
- Each stack uses the lint/test tooling CI invokes: backend Pint + PHPUnit
  (+ `pcov` on the runner); frontend ESLint + Vitest (+ Playwright e2e). Adding
  anything beyond those baselines is a Principle I dependency decision.

## Workflow

Use the Spec Kit slash commands for feature work (specify, plan, tasks, implement,
analyze, clarify, checklist, constitution). The `git` extension automates feature
branches and commits. A plan's Constitution Check must pass before implementation.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
`specs/021-gif-viewport-autoplay/plan.md` (feature: Animated Image Viewport Autoplay).
<!-- SPECKIT END -->
