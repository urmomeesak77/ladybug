# Implementation Plan: Project Infrastructure Scaffold

**Branch**: `001-infra-scaffold` | **Date**: 2026-06-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-infra-scaffold/spec.md`

## Summary

Stand up the two-app foundation the rest of Ladybug builds on: a `backend/` Laravel API
skeleton and a separate `frontend/` React + Vite SPA skeleton, each wired with the exact
lint/test toolchain the existing CI pipeline invokes, plus one real, meaningful test per stack
so coverage legitimately clears the ≥90% gate and CI turns green. On top of that, a
**development-only** `docker-compose` brings the backend, a MySQL 8.0 database, and the Node 20
toolchain up with one command, with runtime versions pinned to match CI (PHP 8.3 / MySQL 8.0 /
Node 20). No application features and no production image are in scope.

The approach favors hand-written, minimal configuration over generators that pull extra
dependencies (e.g. a hand-authored `docker-compose.yml` instead of Laravel Sail; a manually
wired `routes/api.php` instead of `php artisan install:api`, which would drag in Sanctum before
any auth feature needs it).

## Technical Context

**Language/Version**: PHP 8.3 (backend, matches CI `setup-php`); Node 20 + **TypeScript**
(`.ts`/`.tsx`, frontend, matches CI `setup-node`; resolved in Clarifications 2026-06-08).
Constitution floor is PHP 8.1+.

**Primary Dependencies**:
- Backend (baseline only): `laravel/framework` (current 11.x slim skeleton), dev tooling
  `laravel/pint`, `phpunit/phpunit`, `nunomaduro/collision`, `fakerphp/faker`. Sanctum and the
  image library are **deferred** to the features that need them (auth, uploads).
- Frontend (baseline only): `react`, `react-dom`, `vite`, `@vitejs/plugin-react`; dev tooling
  `typescript`, `typescript-eslint` (+ `eslint` and React plugins), `vitest`,
  `@vitest/coverage-v8`. Type packages `@types/react`, `@types/react-dom`.

**Storage**: MySQL 8.0 via Eloquent (provided by the dev compose; no schema/migrations authored
in this feature beyond the framework default).

**Testing**: Backend — PHPUnit with `pcov`/Clover coverage (`php artisan test
--coverage-clover`). Frontend — Vitest with the v8 coverage provider
(`vitest run --coverage --coverage.thresholds.lines=90`).

**Target Platform**: Linux CI runner (ubuntu-latest) and local Docker on the developer's
Windows host. Production deployment target is intentionally unselected.

**Project Type**: Web application — decoupled `backend/` (API) + `frontend/` (SPA).

**Performance Goals**: N/A for scaffolding. Non-functional target: a fresh-clone developer
reaches a running backend in < 15 minutes (SC-003).

**Constraints**: Zero runtime dependencies beyond the CI lint/test baseline (FR-010, Principle
I). Local runtime major versions must equal CI's (FR-008). No real secrets in VCS (FR-006).

**Scale/Scope**: Foundation only — 2 app skeletons, 1 health endpoint, 1 small tested support
unit per stack, 1 dev compose file, env templates, and a short setup README.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Relevance to this feature | Status |
|-----------|---------------------------|--------|
| I — Minimal Dependencies (NON-NEGOTIABLE) | Only the CI-invoked lint/test baseline + React/Vite runtime is installed. Hand-written compose (no Sail). Sanctum/image lib deferred. No new runtime deps. | ✅ Pass |
| II — Coding Conventions | Seed PHP uses `declare(strict_types=1)`, PSR-12, <30-line functions; seed TS uses 2-space, semicolons, camelCase. Configs (`pint.json`, `tsconfig.json`, TS-aware ESLint) encode the rules. | ✅ Pass |
| III — Browser-Native Navigation | No app views/routing in scope; SPA router wiring deferred to feature work. Not exercised. | ✅ N/A |
| IV — Theme & Accessibility | No UI in scope (skeleton renders a minimal placeholder). Not exercised. | ✅ N/A |
| V — Stable Meme Identifiers | Backend seed unit is an `App\Support\PublicCode` generator/validator (11-char `[A-Z0-9-]`), giving a *meaningful* tested unit that pre-builds Principle V infrastructure. | ✅ Pass (aligned) |
| VI — Security & Input Validation | `.env.example` with placeholders committed; real `.env`/secrets git-ignored. No raw SQL. | ✅ Pass |
| VII — Test Coverage & Organization | One real test per stack under each `tests/` tree mirroring source; both stacks ≥90% Clover/v8 line coverage enforced by the existing gate. | ✅ Pass |

**Gate result**: PASS — no violations, Complexity Tracking not required.

**Watch item**: Coverage source scope. Backend PHPUnit `<source><include>` covers `app/`; the
slim Laravel skeleton keeps `app/` tiny (`Providers/AppServiceProvider`, `Models/User`,
abstract `Controller`, plus our `Support/PublicCode`). Phase 0 confirms each is covered or has
no executable statements so the 90% line is cleared honestly, not by narrowing the gate.

## Project Structure

### Documentation (this feature)

```text
specs/001-infra-scaffold/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── health.md        # GET /api/health contract
├── checklists/
│   └── requirements.md  # spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/                          # Laravel API skeleton (PHP 8.3)
├── app/
│   ├── Http/Controllers/         # abstract Controller (framework default)
│   ├── Models/                   # User (framework default)
│   ├── Providers/                # AppServiceProvider (framework default)
│   └── Support/
│       └── PublicCode.php        # 11-char [A-Z0-9-] code generator/validator (seed unit)
├── bootstrap/app.php             # wires routes/api.php (manual, no install:api)
├── routes/
│   └── api.php                   # GET /api/health → { "status": "ok" }
├── tests/
│   ├── Feature/Http/HealthTest.php       # boots app, asserts /api/health
│   └── Unit/Support/PublicCodeTest.php   # covers PublicCode happy + edge paths
├── .env.example                  # placeholders only
├── .gitignore                    # ignores /vendor, .env, etc.
├── composer.json + composer.lock
├── phpunit.xml                   # <source><include>app</source>; coverage config
└── pint.json                     # lint config (vendor/bin/pint --test)

frontend/                         # React 18 + Vite + TypeScript skeleton (Node 20)
├── src/
│   ├── lib/
│   │   └── publicCode.ts         # mirror validator (seed unit, pure fn)
│   ├── App.tsx                   # minimal placeholder app
│   └── main.tsx                  # entry
├── tests/
│   └── lib/publicCode.test.ts    # covers publicCode happy + edge paths
├── .gitignore                    # ignores node_modules, dist, .env
├── index.html
├── package.json + package-lock.json
├── tsconfig.json                 # TS compiler config (strict)
├── vite.config.ts                # vite + vitest config (coverage: v8)
└── eslint.config.js              # flat ESLint config (typescript-eslint)

docker-compose.yml                # DEV ONLY: php 8.3 + mysql 8.0 + node 20
docker/                           # supporting dockerfiles/entrypoints for dev services
└── README (or root README section)# how to start env, copy .env, run lint/tests
```

**Structure Decision**: Decoupled two-app layout (Option 2 — web application), matching the
existing `.github/workflows/ci.yml` job working-directories (`backend/`, `frontend/`) and the
target layout in `CLAUDE.md`. This deliberately differs from the `C:\projects\trash` prototype,
which served React from inside Laravel's `resources/js/`. The dev `docker-compose.yml` lives at
the repo root so it can orchestrate both apps.

## Complexity Tracking

> No Constitution Check violations — section intentionally empty.
