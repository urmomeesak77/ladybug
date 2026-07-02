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
| mysql    | `mysql:8.0`   | `4444` → 3306 | database `trashdb`, root password `root` (dev only) — all configurable, see below |
| frontend | `node:20`     | `5173` | Vite dev server |

Verify the backend is live:

```sh
curl http://localhost:8000/api/health      # -> {"status":"ok"}
```

> On Windows, prefer `http://127.0.0.1:5173` for the frontend — `localhost` may
> resolve to IPv6 first and collide with another local dev server.

## Database & persistence

The schema lives in Laravel migrations (`backend/database/migrations/`) and the dev
database defaults to **`trashdb`** (override with `MYSQL_DATABASE`, see above).

**Fresh checkout** — on first start, when the datadir is empty, the `mysql` service
initialises the database named by `MYSQL_DATABASE`; apply the schema with:

```sh
docker compose up -d mysql backend
docker compose exec backend php artisan migrate
```

**Durable data lives OUTSIDE the repo, on a host bind-mount.** The MySQL datadir is
bind-mounted from `${LADYBUG_DATA_ROOT:-C:/docker_permanent}/ladybug-mysql` into the
container's `/var/lib/mysql` — a real host folder, **not** a Docker-managed named
volume. This survives not just `docker compose down` and `docker rmi mysql:8.0`, but
also **`docker compose down -v` and uninstalling Docker entirely** (a named volume
lives inside the WSL2 VM and is destroyed with it; a host folder is not). Relocate it
— along with the media tree and backups — by setting `LADYBUG_DATA_ROOT` in the root
`.env`; the whole tree is:

```
${LADYBUG_DATA_ROOT}/ladybug-mysql     MySQL datadir   (bind-mounted into the db)
${LADYBUG_DATA_ROOT}/ladybug-storage   media/storage   (bind-mounted into the backend)
${LADYBUG_DATA_ROOT}/ladybug-backups   .sql dumps      (scripts/backup-db.ps1)
```

**Backups & teardown.** Because the datadir persists through almost everything, take
a logical dump before any teardown anyway — `scripts/down.ps1` runs
`scripts/backup-db.ps1` (writes a timestamped `.sql` to `…/ladybug-backups`,
self-sourcing the db name and root password from the running container) before
stopping the stack.

**Destroying the data** now means removing the host folder directly (a deliberate,
explicit act — `down -v` no longer does it):

```sh
docker compose down                    # stops containers; datadir folder untouched
rm -rf C:/docker_permanent/ladybug-mysql   # or your LADYBUG_DATA_ROOT — DESTROYS the DB
```

## Environment / secrets

Real secrets live only in `.env`, which is git-ignored. Committed `*.example`
files hold placeholders. The backend boots from the template:

```sh
cd backend
cp .env.example .env
php artisan key:generate
```

### Configuring the dev MySQL service

The `mysql` service's database name, root password, and host port default to
`trashdb` / `root` / `4444`, so the stack runs with zero config. Override them by
copying the root `.env.example` to `.env` and editing:

| Var | Default | Effect |
|-----|---------|--------|
| `MYSQL_DATABASE` | `trashdb` | name of the database the `mysql` service creates |
| `MYSQL_ROOT_PASSWORD` | `root` | MySQL root password |
| `MYSQL_HOST_PORT` | `4444` | host port mapped to the container's `3306` |

These configure the MySQL **server** container only. The Laravel **app** reads its
own DB connection from `backend/.env` (`DB_DATABASE` / `DB_PASSWORD`), a separate
file: if you override `MYSQL_DATABASE` or `MYSQL_ROOT_PASSWORD`, mirror the change
into `backend/.env` by hand — they can't be auto-linked (injecting `DB_*` into the
backend container would override `phpunit.xml`'s SQLite test config and let tests
wipe the dev database). The same root `.env` also holds `LADYBUG_DATA_ROOT`, which
relocates all durable dev data (MySQL datadir, media, backups).

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
