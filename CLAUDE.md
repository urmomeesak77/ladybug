# CLAUDE.md

This file guides Claude Code when working in this repository.

## Project Overview

**Ladybug** is a meme-sharing site (think 9gag.com): users upload images, videos,
and YouTube links and browse an endless feed of entries. The stack is a **React 18
+ Vite (TypeScript)** frontend talking to a **Laravel 12 (PHP 8.2+) + Sanctum**
backend over a JSON API, backed by **MySQL** via Eloquent.

## Current State (as of 2026-07-20)

The project is **past planning**: both `backend/` (Laravel 12) and `frontend/`
(React 18 + Vite + TypeScript) are scaffolded and eleven features are implemented.
Features follow the Spec Kit flow (specify → plan → tasks → implement) under `specs/`:

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
  `ModerationService` and `MediaVisibilityService`, which moves a non-public meme's
  bytes off the `public` disk so hidden media is not URL-addressable.
- **011-user-rating-auto-activation** — a signed `users.rating` column (never exposed by
  any API) driven solely by `RatingService`: +1 while a meme is live, −1 once on
  deletion, settled atomically inside each moderation transition via the per-meme
  `rating_credited` / `rating_penalized` flags. Uploads are no longer activated
  unconditionally — `createPost()` activates only for an uploader at or above
  `TRUST_THRESHOLD = 15` or holding admin+; everyone else's upload is created **pending**
  with its media hidden until a moderator activates it. The moderation table shows each
  meme's owner rating ("no account" when unowned).

Not built yet: comments and password reset.

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
`specs/011-user-rating-auto-activation/plan.md` (feature: User Rating & Auto-Activation).
<!-- SPECKIT END -->
