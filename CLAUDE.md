# CLAUDE.md

This file guides Claude Code when working in this repository.

## Project Overview

**Ladybug** is a meme-sharing site (think 9gag.com): users upload images, videos,
and YouTube links and browse an endless feed of entries. The stack is a **React 18
+ Vite** frontend talking to a **Laravel (PHP 8.1+) + Sanctum** backend over a JSON
API, backed by **MySQL** via Eloquent.

## Current State (as of 2026-06-08)

The project is in the **spec/planning phase** and has **no application code yet** —
there is no `backend/` or `frontend/` directory, no `composer.json`, and no
`package.json`. What exists today:

- **`.specify/`** — Spec Kit setup (constitution, templates, scripts, and the
  `git` + `agent-context` extensions). Features follow the Spec Kit flow:
  specify → plan → tasks → implement.
- **`.specify/memory/constitution.md`** — the binding **Ladybug Constitution
  (v1.1.0)**. Read it before doing anything; its principles are non-negotiable.
- **`docs/CODING_CONVENTIONS.md`** — binding style guide for HTML/CSS/JS/TS/PHP.
- **`docs/superpowers/`** — design specs and implementation plans (currently the
  CI lint+test pipeline).
- **`docs/*.png`** — UI reference screenshots (login, signup, mainpage).
- **`.github/workflows/ci.yml`** — CI pipeline (lint + test) for both stacks, plus
  `.github/scripts/check_coverage.py` (the ≥90% Clover coverage gate).

**The CI workflow is intentionally red** until `backend/` and `frontend/` are
scaffolded with their lint/test tooling and at least one passing test per stack.

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
    identifier (compare Constitution Principle V's 11-char `[A-Z0-9-]` code).
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
- **Meme IDs:** public identifier is an immutable 11-char `[A-Z0-9-]` code (not the
  DB id) used in URLs and single-meme fetches.
- **Security:** validate all uploads server-side (type/size/well-formedness; parse
  YouTube links, don't embed blindly); ORM/parameterized queries only; escape output
  per context; secrets in env only (`.env` never committed, provide `.env.example`).
- **Tests:** ≥90% line coverage (enforced in CI). Tests live under a top-level
  `tests/` dir mirroring source paths; cover happy path and edge cases.

## Suggested File Structure

The CI workflow already assumes a decoupled, two-app layout: a `backend/` Laravel
API and a separate `frontend/` React + Vite SPA (each with its own dependency
lockfile and its own CI job). This differs from the prototype, which served React
from inside Laravel's `resources/js/`. The suggested target layout:

```
ladybug/
├── backend/                      # Laravel API (PHP 8.1+, Sanctum, MySQL)
│   ├── app/
│   │   ├── Http/
│   │   │   ├── Controllers/      # MemeController, AuthController
│   │   │   ├── Requests/         # FormRequest validation (uploads, auth)
│   │   │   └── Resources/        # JSON API resources (MemeResource, ...)
│   │   ├── Models/               # Meme, User
│   │   ├── Services/             # MemeService, ImageService, FileService, ...
│   │   └── Support/              # small in-house helpers (e.g. PublicCode)
│   ├── database/migrations/      # schema (memes table w/ 11-char public code)
│   ├── routes/api.php            # GET /api/memes, GET /api/memes/{code}, auth
│   ├── tests/                    # PHPUnit — mirrors app/ (Principle VII)
│   │   ├── Feature/              # e.g. Http/Controllers/MemeControllerTest.php
│   │   └── Unit/                 # e.g. Services/MemeServiceTest.php
│   ├── .env.example
│   ├── composer.json
│   └── pint.json                 # lint config (vendor/bin/pint --test in CI)
│
├── frontend/                     # React 18 + Vite SPA
│   ├── src/
│   │   ├── pages/                # HomePage, MemePage, Login/Register, Account
│   │   ├── components/           # Layout, TopMenu, MemeList, MemeItem, ...
│   │   ├── services/             # http client, MemeService, UserService
│   │   ├── hooks/                # e.g. useTheme (prefers-color-scheme)
│   │   ├── types/                # shared TS types (if TS)
│   │   └── main.{jsx,tsx}        # router + app entry
│   ├── tests/                    # Vitest — mirrors src/ (Principle VII)
│   ├── index.html
│   ├── vite.config.{js,ts}
│   ├── .eslintrc / eslint config # `npm run lint` must resolve (CI)
│   └── package.json              # incl. lint + test (vitest) scripts
│
├── docs/                         # conventions, design specs, plans, screenshots
├── .github/workflows/ci.yml      # backend + frontend lint/test jobs
└── .specify/                     # Spec Kit (constitution, templates, scripts)
```

Notes:
- **Tests mirror source** under each stack's `tests/` dir, per Constitution
  Principle VII (e.g. `app/Services/MemeService.php` →
  `tests/Unit/Services/MemeServiceTest.php`).
- **Names are suggestions** — "Meme"/"public code" track the constitution's
  vocabulary; the prototype's equivalents are "Trashpost"/`{hash}`.
- Each stack scaffolds with the lint/test tooling CI invokes: backend Pint +
  PHPUnit (+ `pcov` on the runner); frontend ESLint + Vitest. Adding anything
  beyond those baselines is a Principle I dependency decision.

## Workflow

Use the Spec Kit slash commands for feature work (specify, plan, tasks, implement,
analyze, clarify, checklist, constitution). The `git` extension automates feature
branches and commits. A plan's Constitution Check must pass before implementation.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
`specs/002-database-schema/plan.md` (feature: Persistent Database Schema (Posts + Users)).
<!-- SPECKIT END -->
