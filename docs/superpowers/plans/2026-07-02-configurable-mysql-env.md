# Env-configurable Dev MySQL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dev MySQL database name, root password, and host port configurable through the environment instead of being hardcoded in `docker-compose.yml`.

**Architecture:** Follow the stack's existing `${VAR:-default}` + root `.env` pattern (the one used for `LADYBUG_DATA_ROOT`). Compose reads three new vars with defaults that preserve today's behavior. `scripts/backup-db.ps1` stays correct under overrides by self-sourcing the DB name/password from inside the running container. `backend/.env` cannot be auto-linked (see constraints) so it stays a documented manual match.

**Tech Stack:** Docker Compose (v2), MySQL 8.0 image, PowerShell (backup script), Laravel dotenv (`backend/.env`).

## Global Constraints

- **Never inject `DB_*` into the `backend` service's process env** — real container env overrides `phpunit.xml`'s SQLite `<env>` (even with `force="true"`) and `RefreshDatabase` then wipes the live dev DB. The `backend` service block is left untouched.
- **`backend/.env` cannot be auto-derived from root compose vars** — Laravel's phpdotenv only nests `${VAR}` within the same file and has no `:-` defaults; it cannot read the root `.env`. Root `.env` (compose-only) and `backend/.env` (app) must agree manually.
- **Defaults must preserve current behavior** — with no overrides: database `trashdb`, root password `root`, host port `4444` (`4444:3306`).
- **No new dependencies.** No CI changes (CI does not depend on this compose file). No automated tests (dev-infra config lives outside both stacks' `tests/`).
- Var names — copied verbatim: `MYSQL_DATABASE`, `MYSQL_ROOT_PASSWORD`, `MYSQL_HOST_PORT`.

## File Structure

- `.env.example` (root) — add the three documented vars with defaults.
- `docker-compose.yml` — parameterize the `mysql` service (env, port, healthcheck) + update comments.
- `scripts/backup-db.ps1` — container-self-sourced dump + cosmetic `-Database` param.
- `backend/.env.example` (tracked) + `backend/.env` (gitignored, live) — add sync comments to the `DB_*` block; no value changes.

Verification is manual via `docker compose config` (renders interpolated compose) and a real backup run; there is no test file to create.

---

### Task 1: Add MySQL vars to root `.env.example`

**Files:**
- Modify: `.env.example`

**Interfaces:**
- Produces: root-level env vars `MYSQL_DATABASE`, `MYSQL_ROOT_PASSWORD`, `MYSQL_HOST_PORT` consumed by `docker-compose.yml` (Task 2) via `${VAR:-default}`.

- [ ] **Step 1: Append the MySQL config block to `.env.example`**

Add the following after the existing `LADYBUG_DATA_ROOT=C:/docker_permanent` line (keep the file's existing comment style — `#` prose above the values):

```
# --- Dev MySQL service config (docker-compose.yml `mysql` service only) ---
# Defaults below reproduce the original hardcoded values, so the stack runs
# with zero config. These configure the MySQL SERVER container. The backend
# APP reads its own DB connection from backend/.env, which is a SEPARATE file:
# if you override MYSQL_DATABASE or MYSQL_ROOT_PASSWORD here you MUST mirror
# them into backend/.env (DB_DATABASE / DB_PASSWORD) by hand -- they cannot be
# auto-linked (injecting DB_* into the backend container overrides phpunit.xml
# and lets tests wipe the dev DB).
MYSQL_DATABASE=trashdb
MYSQL_ROOT_PASSWORD=root
MYSQL_HOST_PORT=4444
```

- [ ] **Step 2: Verify the file parses as compose env**

Run: `docker compose --env-file .env.example config --quiet && echo OK`
Expected: prints `OK` (compose reads `.env.example` as an env file with no interpolation errors). Note: this uses `.env.example` explicitly; your real `.env` is unaffected.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "feat(infra): add configurable MySQL vars to root .env.example"
```

---

### Task 2: Parameterize the `mysql` service in `docker-compose.yml`

**Files:**
- Modify: `docker-compose.yml` (the `mysql` service: `environment`, `ports`, `healthcheck`, and header/service comments)

**Interfaces:**
- Consumes: `MYSQL_DATABASE`, `MYSQL_ROOT_PASSWORD`, `MYSQL_HOST_PORT` from Task 1 (defaults `trashdb` / `root` / `4444`).
- Produces: nothing consumed by later tasks (Task 3 sources from container env, not from compose).

- [ ] **Step 1: Parameterize the `mysql` `environment` block**

Replace:

```yaml
    environment:
      MYSQL_DATABASE: trashdb
      MYSQL_ROOT_PASSWORD: root
```

with:

```yaml
    environment:
      MYSQL_DATABASE: ${MYSQL_DATABASE:-trashdb}
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:-root}
```

- [ ] **Step 2: Parameterize the host port**

Replace:

```yaml
    ports:
      - "4444:3306" # host 4444 -> container 3306
```

with:

```yaml
    ports:
      - "${MYSQL_HOST_PORT:-4444}:3306" # host ${MYSQL_HOST_PORT:-4444} -> container 3306
```

- [ ] **Step 3: Parameterize the healthcheck password**

Replace:

```yaml
      test: ["CMD", "mysqladmin", "ping", "-proot"]
```

with:

```yaml
      test: ["CMD", "mysqladmin", "ping", "-p${MYSQL_ROOT_PASSWORD:-root}"]
```

- [ ] **Step 4: Update the file-header comment**

In the top-of-file comment block, after the `LADYBUG_DATA_ROOT` paragraph (ends "...in scripts/backup-db.ps1."), add a new paragraph:

```
#
# MySQL db name, root password, and host port are configurable via
# MYSQL_DATABASE / MYSQL_ROOT_PASSWORD / MYSQL_HOST_PORT (see .env.example);
# defaults reproduce the original trashdb / root / 4444 values. NOTE: the
# backend app reads its DB connection from backend/.env, a separate file --
# overriding the db name or password here means editing backend/.env to match.
```

- [ ] **Step 5: Verify defaults render unchanged (no `.env` override)**

Temporarily ensure no `MYSQL_*` overrides are in your active `.env`, then run:

Run: `docker compose config`
Expected: under `services.mysql`, `MYSQL_DATABASE: trashdb`, `MYSQL_ROOT_PASSWORD: root`, published port `4444` → target `3306`, and healthcheck test ending `-proot` — identical to before this change.

- [ ] **Step 6: Verify an override applies**

Run: `MYSQL_DATABASE=demo MYSQL_ROOT_PASSWORD=s3cr3t MYSQL_HOST_PORT=5555 docker compose config`
Expected: `MYSQL_DATABASE: demo`, `MYSQL_ROOT_PASSWORD: s3cr3t`, published port `5555`, healthcheck test ending `-ps3cr3t`.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(infra): drive dev MySQL name/password/port from env"
```

---

### Task 3: Make `backup-db.ps1` correct under overrides

**Files:**
- Modify: `scripts/backup-db.ps1` (param block, `$dump` command, filename, retention glob, `.NOTES`/comments)

**Interfaces:**
- Consumes: container env `$MYSQL_ROOT_PASSWORD` and `$MYSQL_DATABASE` (set by the mysql image from the compose `environment` in Task 2); optional host `$env:MYSQL_DATABASE` for the filename prefix.
- Produces: a `.sql` dump file named `<database>_<stamp>.sql`.

- [ ] **Step 1: Add a `-Database` param for the filename prefix**

In the `param(...)` block, after the `[string]$BackupDir` param (add a comma after it), add:

```powershell
    ,
    # Filename prefix + retention glob ONLY. The database actually dumped is
    # read from the container's own $MYSQL_DATABASE env (below), so this never
    # affects dump correctness -- only what the file is called. Resolution:
    #   1. -Database argument
    #   2. $env:MYSQL_DATABASE
    #   3. 'trashdb' (baked-in default)
    [string]$Database = $(if ($env:MYSQL_DATABASE) { $env:MYSQL_DATABASE } else { 'trashdb' })
```

- [ ] **Step 2: Source the dump's DB name + password from inside the container**

Replace:

```powershell
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $outFile = Join-Path $backupsDir "trashdb_$stamp.sql"

    # cmd's `>` writes the process's raw UTF-8 bytes; PowerShell's `>` would
    # re-encode to UTF-16 and corrupt the dump. -T disables the TTY so output
    # stays byte-clean. --single-transaction gives a consistent InnoDB snapshot.
    $dump = 'docker compose exec -T mysql mysqldump -uroot -proot --single-transaction --no-tablespaces --databases trashdb'
    cmd /c "$dump > `"$outFile`""
```

with:

```powershell
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $outFile = Join-Path $backupsDir "$($Database)_$stamp.sql"

    # cmd's `>` writes the process's raw UTF-8 bytes; PowerShell's `>` would
    # re-encode to UTF-16 and corrupt the dump. -T disables the TTY so output
    # stays byte-clean. --single-transaction gives a consistent InnoDB snapshot.
    # The dumped db name + root password are read from the container's OWN env
    # ($MYSQL_DATABASE / $MYSQL_ROOT_PASSWORD, set by the mysql image), so the
    # dump is correct no matter how those are overridden in the root .env --
    # single quotes keep the $VARs from expanding on the host. -p"$VAR" (no
    # space after -p) is the mysql client's inline-password form.
    $dump = 'docker compose exec -T mysql sh -c ' +
            "'" + 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --no-tablespaces --databases "$MYSQL_DATABASE"' + "'"
    cmd /c "$dump > `"$outFile`""
```

- [ ] **Step 3: Update the retention glob to match the new filename prefix**

Replace:

```powershell
    Get-ChildItem $backupsDir -Filter 'trashdb_*.sql' |
```

with:

```powershell
    Get-ChildItem $backupsDir -Filter "$($Database)_*.sql" |
```

- [ ] **Step 4: Update the `.SYNOPSIS` wording**

In the top comment block, replace the first `.SYNOPSIS` line:

```
  Dump the dev MySQL `trashdb` to a timestamped .sql file, then prune to the
```

with:

```
  Dump the dev MySQL database (name + root password read from the container's
  own env, so overrides in the root .env are respected) to a timestamped .sql
  file, then prune to the
```

- [ ] **Step 5: Lint-parse the script**

Run: `powershell -NoProfile -Command "[void][System.Management.Automation.Language.Parser]::ParseFile('scripts/backup-db.ps1',[ref]$null,[ref]$null); 'PARSE OK'"`
Expected: prints `PARSE OK` (no parser errors from the new quoting).

- [ ] **Step 6: Run a real backup against the default DB**

Prereq: stack up (`docker compose up -d mysql`) with default settings.

Run: `powershell -NoProfile -File scripts/backup-db.ps1`
Expected: prints `backup-db: wrote <path>\trashdb_<stamp>.sql (<N> bytes)` with N ≥ 1024 and exit 0; the file exists and its first bytes are a readable SQL header (e.g. `-- MySQL dump`), not UTF-16.

- [ ] **Step 7: Commit**

```bash
git add scripts/backup-db.ps1
git commit -m "feat(infra): source backup db name/password from container env"
```

---

### Task 4: Document the manual sync in `backend/.env.example` and `backend/.env`

**Files:**
- Modify: `backend/.env.example` (tracked)
- Modify: `backend/.env` (gitignored, live — not committed)

**Interfaces:**
- Consumes: nothing. Documentation-only; no value changes.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Add the sync comment above the `DB_*` block in `backend/.env.example`**

Insert immediately above the `DB_CONNECTION=mysql` line:

```
# DB connection for the Laravel APP. This is a SEPARATE file from the root
# docker-compose .env: DB_DATABASE and DB_PASSWORD must match the compose
# MYSQL_DATABASE / MYSQL_ROOT_PASSWORD (defaults trashdb / root). They can't be
# auto-linked -- injecting DB_* as the backend container's env overrides
# phpunit.xml's SQLite config and lets tests wipe the dev DB, so the sync is
# manual: change one, change the other.
```

- [ ] **Step 2: Add the same comment above the `DB_*` block in the live `backend/.env`**

Insert the identical comment block immediately above the `DB_CONNECTION=mysql` line in `backend/.env`. (No value changes; `backend/.env` is gitignored so it is not part of the commit.)

- [ ] **Step 3: Verify no value drift**

Run: `git diff backend/.env.example`
Expected: the diff adds only the comment lines above `DB_CONNECTION`; `DB_DATABASE=trashdb` and `DB_PASSWORD=root` are unchanged.

- [ ] **Step 4: Commit**

```bash
git add backend/.env.example
git commit -m "docs(infra): note backend/.env must match compose MYSQL_* vars"
```

---

## Self-Review

**Spec coverage:**
- Root `.env.example` vars → Task 1. ✓
- `docker-compose.yml` env/port/healthcheck/comments → Task 2. ✓
- `backup-db.ps1` container-sourced dump + `-Database` param + retention glob → Task 3. ✓
- `backend/.env` + `.env.example` sync comments → Task 4. ✓
- Constraint: `backend` service `DB_*` untouched → not modified in any task (explicit in Global Constraints + Task 2 scope). ✓
- Verification (defaults unchanged / override applies / backup works) → Task 2 Steps 5-6, Task 3 Steps 5-6. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". All code blocks are literal. ✓

**Type/name consistency:** Var names `MYSQL_DATABASE` / `MYSQL_ROOT_PASSWORD` / `MYSQL_HOST_PORT` used identically across Tasks 1-2; `$Database` param and `$MYSQL_DATABASE`/`$MYSQL_ROOT_PASSWORD` container vars consistent within Task 3; filename prefix `$($Database)_` matches retention glob `$($Database)_*.sql`. ✓
