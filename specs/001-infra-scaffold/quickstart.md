# Quickstart & Validation: Project Infrastructure Scaffold

How to bring the scaffold up locally and verify it satisfies the spec. This is a run/validation
guide — implementation details live in `tasks.md` and the code itself.

## Prerequisites

- **Docker Desktop** (Compose v2) — the only host requirement for the one-command path (SC-003).
- Git. (Native PHP/Node are optional; the compose path does not need them.)

## A. One-command local environment (validates US2 / FR-007, FR-008)

```sh
# from repo root
docker compose up
```

Expected:
- `mysql` (8.0), `php` (8.3, backend), and `node` (20, Vite dev server) services start.
- Backend reachable at its mapped port; frontend dev server reachable at its mapped port.

Validate:

```sh
# backend liveness (see contracts/health.md)
curl http://localhost:8000/api/health          # → {"status":"ok"}
```

| Check | Expected | Spec ref |
|-------|----------|----------|
| `docker compose up` starts all 3 services | running, healthy | FR-007, SC-004 |
| `GET /api/health` | `200` + `{"status":"ok"}` | contracts/health.md, US2 |
| Service versions | PHP 8.3 / MySQL 8.0 / Node 20 (match CI) | FR-008 |

## B. Backend lint + test + coverage (validates US1 / FR-002, FR-004, FR-005)

```sh
cd backend
composer install
cp .env.example .env && php artisan key:generate     # FR-006 path
vendor/bin/pint --test                                # lint — no violations
php artisan test --coverage-clover=coverage.clover    # tests pass
python3 ../.github/scripts/check_coverage.py coverage.clover 90   # gate ≥90%
```

Expected: Pint clean; `PublicCodeTest` + `HealthTest` pass; coverage line `coverage: XX.XX%
(min 90.00%)` with `coverage gate passed`.

## C. Frontend lint + test + coverage (validates US1 / FR-003, FR-004, FR-005)

```sh
cd frontend
npm ci
npm run lint                                          # ESLint — no errors
npx vitest run --coverage --coverage.thresholds.lines=90   # tests pass + gate
```

Expected: ESLint clean; `publicCode.test.ts` passes; Vitest reports line coverage ≥90% and exits 0.

## D. Secret hygiene (validates US3 / FR-006, SC-005)

| Check | Expected |
|-------|----------|
| `backend/.env.example` exists, placeholders only | yes |
| `git status` after `cp .env.example .env` | real `.env` is **ignored**, not staged |
| No real secret committed anywhere | confirmed |

## E. CI green (validates US1 / SC-001, SC-002)

Push the branch and confirm both GitHub Actions jobs pass:

| Job | Steps that must pass |
|-----|----------------------|
| `Backend (Laravel)` | install → Pint → test w/ coverage → coverage gate ≥90% |
| `Frontend (React)` | install → ESLint → Vitest w/ coverage ≥90% |

Overall CI status: **green**.

## Definition of done (maps to Success Criteria)

- [ ] Both CI jobs green (SC-001)
- [ ] ≥90% line coverage each stack (SC-002)
- [ ] Fresh clone → running backend in < 15 min via `docker compose up` (SC-003)
- [ ] Single command starts full local env (SC-004)
- [ ] No real secret in VCS; `.env.example` present (SC-005)
- [ ] Zero runtime deps beyond CI lint/test baseline (SC-006)
