# Design: Env-configurable MySQL in the dev stack

**Date:** 2026-07-02
**Status:** Approved (pre-implementation)
**Scope:** `docker-compose.yml`, root `.env` / `.env.example`, `scripts/backup-db.ps1`,
`backend/.env` + `backend/.env.example`.

## Problem

`docker-compose.yml` hardcodes the dev MySQL database name (`trashdb`), the root
password (`root`), and the host port (`4444`). These should be configurable through
the environment, following the same `${VAR:-default}` + root `.env` pattern the stack
already uses for `LADYBUG_DATA_ROOT`, so the values can be changed in one place
without editing tracked files.

## Constraints (non-negotiable)

1. **Never inject `DB_*` into the `backend` service's process env.** Real container
   env vars override `phpunit.xml`'s SQLite `<env>` config (real env wins even with
   `force="true"`), which previously caused `php artisan test` (`RefreshDatabase`) to
   run against — and wipe — the live dev database. The `backend` service must keep its
   DB config out of the process env; the app reads MySQL from `backend/.env`.
2. **`backend/.env` cannot be auto-derived from the root compose vars.** Laravel's
   phpdotenv only nests `${VAR}` referencing vars *within the same file* and has no
   `:-` default syntax; it cannot read the root `.env`. Combined with constraint (1),
   the root `.env` (compose-only) and `backend/.env` (app) are two independent files
   that must simply **agree**. Consistency here is manual + documented, not automatic.
3. **Defaults preserve current behavior.** With no `.env` overrides, the stack must
   behave exactly as it does today (`trashdb` / `root` / host port `4444`).

## Changes

### 1. Root `.env` / `.env.example`

Add three compose-only variables (documented alongside the existing
`LADYBUG_DATA_ROOT`), with defaults matching today's hardcoded values:

```
MYSQL_DATABASE=trashdb
MYSQL_ROOT_PASSWORD=root
MYSQL_HOST_PORT=4444
```

Document that these configure the `mysql` *service*, and that `MYSQL_DATABASE` /
`MYSQL_ROOT_PASSWORD` overrides must be mirrored into `backend/.env`
(`DB_DATABASE` / `DB_PASSWORD`) by hand — see constraint (2).

### 2. docker-compose.yml (`mysql` service)

Reuse the mysql image's own env-key names as the substitution vars so the block reads
naturally:

- `MYSQL_DATABASE: ${MYSQL_DATABASE:-trashdb}`
- `MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:-root}`
- ports: `"${MYSQL_HOST_PORT:-4444}:3306"`
- healthcheck: `["CMD", "mysqladmin", "ping", "-p${MYSQL_ROOT_PASSWORD:-root}"]`

Update the top-of-file / mysql-service comments to point at the new vars and the
`backend/.env` sync requirement. The `backend` service's `DB_*` split and its
explanatory comment are left untouched (constraint 1).

### 3. scripts/backup-db.ps1

The script cannot rely on the root `.env` being loaded into the PowerShell
environment (compose auto-loads it; a shell does not). So the dump self-sources the
database name and password from **inside the container**, where the mysql image
guarantees `$MYSQL_DATABASE` and `$MYSQL_ROOT_PASSWORD` are set:

```
docker compose exec -T mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --no-tablespaces --databases "$MYSQL_DATABASE"'
```

This is always correct regardless of overrides and keeps the password off the host
command line. Notes:

- Quoting: the inner `sh -c '...'` is single-quoted in PowerShell so `$MYSQL_*`
  expand inside the container, not on the host. The existing
  `cmd /c "$dump > `"$outFile`""` redirect stays (byte-clean UTF-8 output).
- Output **filename** prefix (currently `trashdb_<stamp>.sql`) is cosmetic host-side
  metadata. Add a `-Database` param resolving param → `$env:MYSQL_DATABASE` →
  `trashdb`, used only for the filename prefix and the retention glob. The actual
  dumped database always comes from the container env, so a mismatch here only affects
  the filename, never correctness.
- Retention glob loosens from `trashdb_*.sql` to `$Database`-prefixed
  (`"$($Database)_*.sql"`), so pruning still targets this script's own dumps.

### 4. backend/.env and backend/.env.example

No value changes (they already match the defaults: `DB_DATABASE=trashdb`,
`DB_PASSWORD=root`). Add comments to the `DB_*` block stating that `DB_DATABASE` and
`DB_PASSWORD` must match the root `.env`'s `MYSQL_DATABASE` / `MYSQL_ROOT_PASSWORD`,
and briefly why they can't be auto-linked (constraints 1 and 2). `backend/.env` is
gitignored; `backend/.env.example` is tracked — comment both.

## Testing / verification

No automated tests (this is dev-infra config, outside both stacks' `tests/`). Verify
manually:

1. **Defaults unchanged:** with no root `.env` override, `docker compose config`
   renders `trashdb` / `root` / `4444:3306` and the healthcheck `-proot`, identical
   to today.
2. **Override applies:** set `MYSQL_DATABASE`, `MYSQL_ROOT_PASSWORD`, `MYSQL_HOST_PORT`
   in a root `.env`; `docker compose config` reflects the overrides in the env,
   port mapping, and healthcheck.
3. **Backup script:** `docker compose config` interpolation is not needed by the
   script; confirm `backup-db.ps1` produces a valid dump (>1 KB, exit 0) with defaults,
   and a correctly-named dump of the overridden database when overridden.

## Out of scope

- CI does not depend on this compose file; no CI changes.
- No change to how the `backend` service resolves its DB connection.
- No new dependencies.
