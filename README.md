# Ladybug

A meme-sharing site (think 9gag): upload images, videos, and YouTube links and
browse an endless feed. **React 18 + Vite + TypeScript** frontend talking to a
**Laravel (PHP 8.3) + MySQL** JSON API.

This repository is currently the **infrastructure scaffold** — two app skeletons
wired with their lint/test toolchains, a dev Docker environment, and one
meaningful tested unit per stack. Application features are built on top of it.

## Layout

```
backend/    Laravel API skeleton (PHP 8.3) — GET /api/health, App\Support\PublicCode
frontend/   React 18 + Vite + TypeScript SPA skeleton
docker/     Dockerfiles for the dev environment (php)
docker-compose.yml   dev-only: php 8.3 + mysql 8.0 + node 20
```

## One-command local environment

Requires **Docker Desktop** (Compose v2). No local PHP/Node needed.

```sh
docker compose up
```

This starts three services pinned to the versions CI uses:

| Service  | Image / build | Host port | Notes |
|----------|---------------|-----------|-------|
| backend  | `docker/php` (PHP 8.3) | `8000` | `php artisan serve`; seeds `.env` + app key on first run |
| mysql    | `mysql:8.0`   | `4444` → 3306 | database `ladybug`, root password `root` (dev only) |
| frontend | `node:20`     | `5173` | Vite dev server |

Verify the backend is live:

```sh
curl http://localhost:8000/api/health      # -> {"status":"ok"}
```

> On Windows, prefer `http://127.0.0.1:5173` for the frontend — `localhost` may
> resolve to IPv6 first and collide with another local dev server.

## Environment / secrets

Real secrets live only in `.env`, which is git-ignored. Committed `*.example`
files hold placeholders. The backend boots from the template:

```sh
cd backend
cp .env.example .env
php artisan key:generate
```

## Backend — lint, test, coverage (PHP)

CI runs these; reproduce them locally inside the dev image (no host PHP required):

```sh
# from repo root, with the dev image built (docker compose build backend)
docker run --rm -v "${PWD}/backend:/app" ladybug-php composer install
docker run --rm -v "${PWD}/backend:/app" ladybug-php php vendor/bin/pint --test
docker run --rm -v "${PWD}/backend:/app" ladybug-php php artisan test --coverage-clover=coverage.clover
python .github/scripts/check_coverage.py backend/coverage.clover 90
```

With a local PHP 8.3 + Composer you can instead run `composer install`,
`vendor/bin/pint --test`, and `php artisan test --coverage-clover=coverage.clover`
directly from `backend/`.

## Frontend — lint, test, coverage (Node 20)

```sh
cd frontend
npm ci
npm run lint
npx vitest run --coverage --coverage.thresholds.lines=90
```

Both stacks enforce **≥90% line coverage** in CI (`.github/workflows/ci.yml`).

## Spec Kit

Feature work follows the Spec Kit flow (specify → plan → tasks → implement).
See `specs/` for feature specs and `.specify/memory/constitution.md` for the
binding project constitution.
