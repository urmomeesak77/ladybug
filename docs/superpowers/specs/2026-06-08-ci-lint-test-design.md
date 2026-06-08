# CI Pipeline (Lint + Test) — Design

**Date:** 2026-06-08
**Status:** Approved (design); pending spec review
**Scope:** Workflow-only. CI (lint + test) only — no CD/deploy.

## Summary

Add a GitHub Actions CI pipeline that lints and tests both stacks of the
Ladybug meme-sharing site — the Laravel (PHP) backend and the React + Vite
frontend — and enforces the constitution's ≥90% coverage gate (Principle VII).

The repository currently has **no application code** (no `composer.json`,
no `package.json`, no scaffolded projects, no tests). This work authors the
workflow only; it does not scaffold the apps. The pipeline is therefore
**expected to be red until `backend/` and `frontend/` are scaffolded** with
their standard lint/test tooling and at least one passing test per stack. It
goes green once that code lands.

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| Deliverable | Workflow only (no app scaffold created now) |
| CI vs CD | CI only — lint + test, no deployment |
| Repo layout | `backend/` (Laravel) + `frontend/` (React + Vite) |
| Coverage gate | Enforce **≥90%**, fail the build (Principle VII) |
| CI platform | GitHub Actions (`github.com/urmomeesak77/ladybug`) |
| Structure | **Approach A** — one workflow file, two parallel jobs |

## Architecture

Single workflow file: `.github/workflows/ci.yml`.

- **Triggers:** `push` to `master`, and `pull_request`.
- **Concurrency:** group per ref, `cancel-in-progress: true` (supersede stale runs).
- **Permissions:** `contents: read` (least privilege).
- **Jobs:** `backend` and `frontend` run in parallel; failure in either is
  attributable to its stack.

### Job: `backend` (Laravel / PHP)

- Working directory: `backend/`.
- Runner: `ubuntu-latest`.
- PHP: **8.3** via `shivammathur/setup-php`, with the **`pcov`** coverage
  extension. Composer cache enabled.
- **MySQL service container** (constitution mandates MySQL via Eloquent) wired
  to the test database; backend env points at it.
- Steps:
  1. Checkout.
  2. Setup PHP (+ pcov) and Composer cache.
  3. `composer install --no-interaction --prefer-dist`.
  4. Copy `.env.example` → `.env`; `php artisan key:generate`.
  5. **Lint:** `vendor/bin/pint --test` (fails on style violations; reports
     only, no rewrite).
  6. **Test + coverage:** `php artisan test --coverage-clover=coverage.clover`.
  7. **Coverage gate:** a small standalone Python script
     (`.github/scripts/check_coverage.py`, stdlib only) parses `coverage.clover`
     (`coveredstatements / statements`) and exits non-zero below **90%**. Python
     is preinstalled on `ubuntu-latest`, and a stdlib script is unit-testable
     locally — preferable to an inline `php -r` one-liner.

### Job: `frontend` (React / Vite)

- Working directory: `frontend/`.
- Runner: `ubuntu-latest`.
- Node: **20** via `actions/setup-node`, npm cache keyed on
  `frontend/package-lock.json`.
- Steps:
  1. Checkout.
  2. Setup Node 20 (+ npm cache).
  3. `npm ci`.
  4. **Lint:** `npm run lint` (ESLint).
  5. **Test + coverage:** `npx vitest run --coverage` with a **90% lines**
     threshold. Vitest enforces the threshold natively and fails the build
     itself — no extra gate step needed.

## Assumed tooling (no new dependencies introduced)

This is workflow-only, so it adds **no** runtime dependency and triggers no
Principle I approval. The workflow only *invokes* tools that the standard
scaffolds already ship:

- **Backend:** Laravel Pint (lint) and PHPUnit (test) — both bundled with a
  default Laravel install. `pcov` is provided by the CI runner, not the app.
- **Frontend:** ESLint, Vitest, and `@vitest/coverage-v8` — the conventional,
  minimal test setup for a Vite + React project.

When the apps are scaffolded, they must include this tooling and a
`lint` npm script for the workflow's commands to resolve.

## Error handling & failure modes

- **Empty repo (current):** jobs fail fast (missing `composer.json` /
  `package-lock.json`). Expected and acceptable per the workflow-only scope.
- **Lint failure:** non-zero exit from Pint/ESLint fails the job.
- **Test failure:** non-zero exit from PHPUnit/Vitest fails the job.
- **Coverage below 90%:** backend gate script exits non-zero; Vitest threshold
  fails the frontend job.
- **MySQL not ready:** service container healthcheck gates the test step.

## Out of scope

- Any deployment / CD step (deferred until a deploy target exists).
- Scaffolding the Laravel or React projects.
- Path-filtered / conditional jobs (both jobs always run for now, keeping
  required status checks simple). A future optimization.
- Branch-protection configuration (documented as a follow-up, not automated).

## Future follow-ups

- Wire the two jobs as required status checks in branch protection.
- Add a CD job once a hosting target and secrets are chosen.
- Consider `paths:` filters if job runtime becomes a concern.
