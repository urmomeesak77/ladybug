# Quickstart & Validation: Persistent Database Schema

Run-and-verify guide proving the `trashdb` schema works, persists, and is reversible. For
the exact columns/types see [contracts/schema.md](./contracts/schema.md); for the domain
model see [data-model.md](./data-model.md).

## Prerequisites

- Docker + Docker Compose installed.
- Repository checked out; working dir = repo root (`C:\projects\ladybug`).
- No real secrets needed — dev credentials come from `docker-compose.yml` / `.env.example`.

## 1. Bring up the database and apply the schema (US1, US3 — SC-001, SC-003)

```bash
docker compose up -d mysql backend
# Inside the backend container (or a one-off run), apply migrations:
docker compose exec backend php artisan migrate
```

**Expected**: migrations run without error; the `migrations` ledger lists
`…create_users_table` and `…create_trashposts_table`. The database is named **`trashdb`**.

Verify the tables exist with the expected columns:

```bash
docker compose exec mysql mysql -uroot -proot trashdb -e "SHOW TABLES; DESCRIBE trashposts; DESCRIBE users;"
```

**Expected**: `trashposts` and `users` present; `trashposts` has `hash`, `title`, `type`,
`file`, `youtube`, `user_id`, `comment`, `metadata`, and the four timestamps — and **no**
`temp`, `oldfile`, `text`, or free-text `user` column. `users` has a unique `hash`.

## 2. Constraints behave (US1 — SC-004)

```sql
-- unique hash rejects duplicates
INSERT INTO trashposts (hash) VALUES ('abcdefghij');
INSERT INTO trashposts (hash) VALUES ('abcdefghij');   -- expect: duplicate-key error

-- case-sensitive: differs only by case => allowed (distinct under utf8mb4_bin)
INSERT INTO trashposts (hash) VALUES ('ABCDEFGHIJ');   -- expect: success

-- unique email rejects duplicates
INSERT INTO users (name,hash,email,password) VALUES ('a','u000000001','a@x.io','x');
INSERT INTO users (name,hash,email,password) VALUES ('b','u000000002','a@x.io','x'); -- expect: error

-- FK rejects a non-existent owner
INSERT INTO trashposts (hash,user_id) VALUES ('zzzzzzzzzz', 999999); -- expect: FK error
```

## 3. Data survives container removal AND image uninstall (US2 — SC-002)

```bash
# Insert a marker row first (see step 2), then:
docker compose down                # stop & remove containers (NOT -v: volume kept)
docker rmi mysql:8.0               # uninstall the MySQL image
docker compose up -d mysql         # pull/recreate; same named volume reattaches
docker compose exec mysql mysql -uroot -proot trashdb -e "SELECT hash FROM trashposts;"
```

**Expected**: the previously inserted rows are still present — zero data loss. Data is only
destroyed by an explicit `docker compose down -v` / `docker volume rm ladybug_mysql-data`.

> Note: on a pre-existing `mysql-data` volume created before this feature (database
> `ladybug`), create `trashdb` once: `docker compose exec mysql mysql -uroot -proot -e
> "CREATE DATABASE IF NOT EXISTS trashdb;"` then re-run migrations. Fresh checkouts get
> `trashdb` automatically from `MYSQL_DATABASE`.

## 4. Reversibility (US3 — SC-005)

```bash
docker compose exec backend php artisan migrate:rollback   # drops trashposts then users
docker compose exec backend php artisan migrate            # rebuilds cleanly
```

**Expected**: rollback removes both tables with no orphaned objects (no leftover FK); the
forward run rebuilds them identically. Repeatable with no errors.

## 5. Automated tests (FR-011 — SC-001/004/005, coverage ≥ 90%)

```bash
cd backend
composer test            # or: php artisan test
```

**Expected**: green. Tests cover (against SQLite `:memory:` via `RefreshDatabase`):
- tables and all expected columns exist; excluded columns absent;
- `trashposts.hash`, `users.hash`, `users.email` reject duplicates;
- `hash` case-sensitive distinctness;
- `trashposts.user_id` rejects a non-existent user and allows null;
- `Trashpost`/`User` model fillable, casts, soft delete, and the `user()`/`posts()` relationships;
- migrations roll back and re-apply cleanly.

Coverage gate (matches CI):

```bash
cd backend
vendor/bin/phpunit --coverage-clover coverage.clover
python ../.github/scripts/check_coverage.py coverage.clover   # expects ≥ 90%
```

## 6. Manual data import (out of scope — operator task, SC-006)

This feature delivers schema only. To copy prototype rows, the operator dumps from the
prototype `trash` DB (host port 3306) and loads into `trashdb`, preserving each `hash`
verbatim and mapping the old `user` string to a `user_id`. The unique constraints reject any
duplicate `hash`/`email`, so a repeated import cannot create duplicates. No import command or
seeder is provided.
