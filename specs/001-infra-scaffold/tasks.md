---
description: "Task list for Project Infrastructure Scaffold"
---

# Tasks: Project Infrastructure Scaffold

**Input**: Design documents from `/specs/001-infra-scaffold/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/health.md, quickstart.md

**Tests**: INCLUDED. Unlike most features, the seed tests are themselves the deliverable here
(FR-004/FR-005: ≥1 meaningful passing test per stack at ≥90% coverage). Test tasks are written
first and must FAIL before the corresponding implementation task makes them pass.

**Organization**: Tasks are grouped by user story (P1 → P2 → P3) to enable independent
implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story the task belongs to (US1, US2, US3)
- All file paths are repository-root-relative

## Path Conventions

Decoupled two-app web layout (plan.md "Structure Decision"): `backend/` (Laravel API) and
`frontend/` (React + Vite + TS SPA) at the repository root, with a root `docker-compose.yml`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Stand up the raw two-app skeletons and shared root scaffolding everything else builds on.

- [ ] T001 [P] Initialize a Laravel 11.x slim skeleton in `backend/` (PHP 8.3; baseline deps only — framework + dev tooling `laravel/pint`, `phpunit/phpunit`, `nunomaduro/collision`, `fakerphp/faker`; do NOT run `php artisan install:api`, do NOT add Sanctum). Commit `backend/composer.json` + `backend/composer.lock`. (research.md R1, R2)
- [ ] T002 [P] Initialize a Vite React 18 + TypeScript skeleton in `frontend/` (Node 20; runtime `react`, `react-dom`, `vite`, `@vitejs/plugin-react`; dev `typescript`, `typescript-eslint`, `eslint` + React plugins, `vitest`, `@vitest/coverage-v8`, `@types/react`, `@types/react-dom`). Create `frontend/index.html`. Commit `frontend/package.json` + `frontend/package-lock.json`. (research.md R5, R6, R10)
- [ ] T003 [P] Create the `docker/` directory and a root `.gitignore` covering OS/editor cruft (per-stack ignores are added in Phase 2).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Lint/test/coverage configuration, route wiring, and env templates that every user
story depends on. The backend env example + `.gitignore` live here because CI's backend prepare
step (`cp .env.example .env && php artisan key:generate`) needs them for US1 to ever go green.

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete.

- [ ] T004 Wire API routing manually in `backend/bootstrap/app.php` via `->withRouting(api: __DIR__.'/../routes/api.php', ...)` and create an (initially empty) `backend/routes/api.php`. No `install:api`, no Sanctum. (research.md R2, contracts/health.md)
- [ ] T005 [P] Add `backend/pint.json` with a PSR-12-aligned preset encoding `docs/CODING_CONVENTIONS.md` (4-space, `declare(strict_types=1)`). CI runs `vendor/bin/pint --test`. (research.md R6 equivalent; data-model.md)
- [ ] T006 [P] Configure `backend/phpunit.xml` with `Unit` + `Feature` testsuites and `<source><include><directory>app</directory></source>` for honest project-wide coverage. (research.md R3)
- [ ] T007 [P] Create `backend/.env.example` (placeholders only: blank `APP_KEY`, `DB_*` pointing at the dev/CI MySQL) and `backend/.gitignore` (ignore `/vendor`, `.env`, etc.). (research.md R8; FR-006)
- [ ] T008 [P] Add `frontend/tsconfig.json` with `strict: true` targeting modern ESM. (research.md R10)
- [ ] T009 [P] Add `frontend/eslint.config.js` (flat config: `typescript-eslint` recommended + React rules + project conventions of 2-space/semicolons/camelCase) and a `lint` script (`eslint .`) in `frontend/package.json`. Must report no errors on the minimal scaffold. (research.md R6; spec edge case)
- [ ] T010 [P] Configure `frontend/vite.config.ts` with `@vitejs/plugin-react` and Vitest using the `v8` coverage provider, `coverage.include` scoped to source under test, and line threshold 90; add a `test` script in `frontend/package.json`. (research.md R5)
- [ ] T011 [P] Create `frontend/.gitignore` (ignore `node_modules`, `dist`, `.env`).

**Checkpoint**: Both stacks can be linted and the test runners execute (with zero tests). User-story work can begin.

---

## Phase 3: User Story 1 - CI pipeline turns green (Priority: P1) 🎯 MVP

**Goal**: Ship one meaningful, passing test per stack so Pint/ESLint are clean and both stacks
clear the ≥90% Clover/v8 coverage gate, turning the existing CI workflow green.

**Independent Test**: Push the branch; observe the `Backend (Laravel)` and `Frontend (React)`
CI jobs both pass, with the coverage gate reporting ≥90% (SC-001, SC-002).

### Tests for User Story 1 (write FIRST — must FAIL before implementation)

- [ ] T012 [P] [US1] Write failing `backend/tests/Unit/Support/PublicCodeTest.php` covering `generate()` (output always satisfies `isValid()`) and `isValid()` edge cases (length ≠ 11, lowercase/illegal chars, empty/non-string). (data-model.md; research.md R4)
- [ ] T013 [P] [US1] Write failing `backend/tests/Feature/Http/HealthTest.php` asserting `GET /api/health` returns `200` with exact JSON `{"status":"ok"}`. (contracts/health.md)
- [ ] T014 [P] [US1] Write failing `frontend/tests/lib/publicCode.test.ts` covering the mirror `isValid` happy path + edge cases (length, illegal chars, empty). (data-model.md; research.md R5)

### Implementation for User Story 1

- [ ] T015 [US1] Implement `backend/app/Support/PublicCode.php` with `generate(): string` (11 chars from `[A-Z0-9-]`) and `isValid(string): bool` (`^[A-Z0-9-]{11}$`), `declare(strict_types=1)`. Makes T012 pass. (data-model.md; research.md R4)
- [ ] T016 [US1] Implement the `GET /api/health` route in `backend/routes/api.php` returning `{"status":"ok"}`. Makes T013 pass. (depends on T004; contracts/health.md)
- [ ] T017 [P] [US1] Implement `frontend/src/lib/publicCode.ts` (pure `isValid` mirror of the backend contract). Makes T014 pass. (data-model.md)
- [ ] T018 [P] [US1] Add a minimal placeholder `frontend/src/App.tsx` and `frontend/src/main.tsx` entry (no router, no API call — independence per Clarifications 2026-06-08).

### Verification for User Story 1

- [ ] T019 [US1] Run backend gate locally: `vendor/bin/pint --test` (clean) and `php artisan test --coverage-clover=coverage.clover` then `python3 .github/scripts/check_coverage.py backend/coverage.clover 90` (≥90%). If `app/Models/User.php` leaves a coverage gap, add a minimal `backend/tests/Unit/Models/UserTest.php` (factory create / fillable assertion). (research.md R3; quickstart.md B)
- [ ] T020 [US1] Run frontend gate locally: `npm run lint` (no errors) and `npx vitest run --coverage --coverage.thresholds.lines=90` (passes, ≥90%). (quickstart.md C)
- [ ] T021 [US1] Commit and push the branch; confirm both `Backend (Laravel)` and `Frontend (React)` CI jobs are green including the coverage gate. (quickstart.md E; SC-001, SC-002)

**Checkpoint**: CI is green. The foundation is observably correct and the MVP is delivered.

---

## Phase 4: User Story 2 - New contributor runs the backend locally in one command (Priority: P2)

**Goal**: A single documented command brings up the backend, MySQL, and the Node toolchain with
runtime major versions matching CI (PHP 8.3 / MySQL 8.0 / Node 20).

**Independent Test**: On a machine with only Docker installed, run `docker compose up` and confirm
the backend answers `GET /api/health` with `200`, can reach the DB, and the frontend dev server serves.

### Implementation for User Story 2

- [ ] T022 [P] [US2] Author a hand-written root `docker-compose.yml` with three services pinned to CI versions: `php:8.3` (backend via `php artisan serve`), `mysql:8.0`, `node:20` (Vite dev server). No Laravel Sail. (research.md R7, R9; FR-008)
- [ ] T023 [P] [US2] Add supporting Dockerfiles/entrypoints under `docker/` for the php and node services as needed by the compose file. (research.md R7)
- [ ] T024 [US2] Configure the backend's compose env (and `backend/.env.example` `DB_HOST` etc.) so the backend connects to the `mysql` service; ensure `php artisan key:generate` runs in the dev flow. (depends on T007, T022)
- [ ] T025 [US2] Validate per quickstart.md A: `docker compose up` starts all three services, `curl http://localhost:8000/api/health` → `{"status":"ok"}`, and PHP/MySQL/Node major versions match CI. (FR-007, FR-008, SC-003, SC-004)

**Checkpoint**: One-command local dev environment works and matches CI versions.

---

## Phase 5: User Story 3 - Contributor copies env template and configures secrets safely (Priority: P3)

**Goal**: A working config is derivable from committed example files with no real secret ever
committed.

**Independent Test**: Confirm example env files with placeholders exist, real `.env` is git-ignored,
and copying the example + `key:generate` boots the backend.

### Implementation for User Story 3

- [ ] T026 [P] [US3] If the frontend needs runtime env, add `frontend/.env.example` (placeholders only); confirm `frontend/.gitignore` excludes real `.env`. (research.md R8; FR-006)
- [ ] T027 [US3] Verify the backend env flow per quickstart.md D: `backend/.env.example` is placeholders-only, `cp .env.example .env && php artisan key:generate` boots the backend with no missing-config errors, and the real `.env` is git-ignored (not staged). (FR-006; SC-005)
- [ ] T028 [US3] Confirm no real secret or real env file is present anywhere in version control. (SC-005)

**Checkpoint**: Secret hygiene verified end-to-end.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation and final cross-cutting validation.

- [ ] T029 [P] Write the setup README (root README section or `docker/README`) documenting: how to `docker compose up`, how to copy the env template + generate the key, and how to run lint + tests + coverage for each stack. (FR-011)
- [ ] T030 Run the full quickstart.md validation (sections A–E) and check off its Definition-of-Done list.
- [ ] T031 Confirm zero runtime npm/Composer dependencies were added beyond the CI lint/test baseline; record the result. (FR-010, SC-006; Constitution Principle I)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately. T001/T002/T003 are fully parallel (separate trees).
- **Foundational (Phase 2)**: Depends on Setup. Backend config (T004–T007) needs T001; frontend config (T008–T011) needs T002. BLOCKS all user stories.
- **User Stories (Phase 3–5)**: All depend on Foundational completion. Proceed in priority order P1 → P2 → P3 (US2 and US3 build on the backend skeleton US1 exercises).
- **Polish (Phase 6)**: Depends on all targeted user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Depends only on Foundational. The MVP — independently verifiable via CI.
- **US2 (P2)**: Depends on Foundational + the backend skeleton/health route from US1 (compose serves and pings it).
- **US3 (P3)**: Depends on Foundational (backend `.env.example`/`.gitignore` from T007); validates and documents the hygiene story.

### Within User Story 1

- Tests (T012–T014) are written first and must FAIL before implementation.
- T015 makes T012 pass; T016 (needs T004) makes T013 pass; T017 makes T014 pass.
- Verification (T019–T021) runs after implementation. T021 (CI green) is last.

### Parallel Opportunities

- **Setup**: T001, T002, T003 in parallel.
- **Foundational**: backend config T005/T006/T007 in parallel after T001+T004; frontend config T008/T009/T010/T011 in parallel after T002. The entire backend and frontend config tracks are parallel to each other.
- **US1**: T012/T013/T014 in parallel (different files). Backend impl (T015/T016) runs parallel to frontend impl (T017/T018) — separate stacks.
- **US2**: T022 and T023 in parallel.
- **Cross-stack**: The backend track and the frontend track are independent throughout US1 and can be staffed by two developers.

---

## Parallel Example: User Story 1

```bash
# Write the three seed tests together (they must fail first):
Task: "Write failing backend/tests/Unit/Support/PublicCodeTest.php"
Task: "Write failing backend/tests/Feature/Http/HealthTest.php"
Task: "Write failing frontend/tests/lib/publicCode.test.ts"

# Then implement the two stacks in parallel:
Task: "Implement backend/app/Support/PublicCode.php + routes/api.php health route"
Task: "Implement frontend/src/lib/publicCode.ts + minimal App.tsx/main.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (raw skeletons).
2. Complete Phase 2: Foundational (lint/test/coverage config, route wiring, backend env).
3. Complete Phase 3: User Story 1 (seed units + tests, both stacks green).
4. **STOP and VALIDATE**: Push and confirm CI is green with ≥90% coverage.
5. This is a shippable foundation — every later Ladybug feature can build on it.

### Incremental Delivery

1. Setup + Foundational → both stacks lintable/testable.
2. US1 → CI green (MVP).
3. US2 → one-command local dev env matching CI versions.
4. US3 → verified secret hygiene + setup docs.

### Parallel Team Strategy

After Foundational, one developer takes the backend track and another the frontend track through
US1; US2 (compose) and US3 (env hygiene/docs) follow once the skeletons exist.

---

## Notes

- [P] = different files, no dependency on incomplete tasks.
- Tests here are required deliverables (FR-004/005), not optional — keep each stack at ≥90% honestly (research.md R3), never by narrowing the coverage scope.
- Do NOT add Sanctum, an image library, DOM testing libs, or any dependency beyond the CI baseline (Principle I / FR-010) — defer those to the features that need them.
- Commit after each task or logical group; the `git` extension auto-commits after this command.
