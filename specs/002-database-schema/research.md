# Phase 0 Research: Persistent Database Schema

All NEEDS CLARIFICATION items from the spec were already resolved during clarification
(see spec.md → Clarifications). This document records the remaining **technical** decisions
needed to implement the schema portably and durably.

## R1. Where does the `users.hash` column live — amend `create_users_table` or add an alter migration?

- **Decision**: **Amend** the existing default `0001_01_01_000000_create_users_table.php`
  to add `hash` (`varchar(10)`, unique, driver-aware `utf8mb4_bin`) inside the same
  `Schema::create('users', ...)` call.
- **Rationale**: This is a greenfield project — no migration has run against a real
  (production) database, so editing the create migration is safe and is the canonical Spec
  Kit / Laravel idiom for a not-yet-shipped table. It honours FR-006's "one create migration
  per table" (the project already owns `create_users_table`) and avoids a redundant
  `add_hash_to_users_table` alter that would only exist to patch a same-feature file.
- **Alternatives considered**: A separate `add_hash_to_users` alter migration — rejected as
  needless ledger noise for a table introduced in the same greenfield line; the spec itself
  names the unit `create_users_table`.
- **Re-run safety (FR-006)**: `php artisan migrate` never re-applies a migration already in
  the `migrations` ledger, so existing data is never destroyed or duplicated. Editing the
  file only matters on a *fresh* build (`migrate:fresh`), which is the dev reset path.

## R2. `utf8mb4_bin` collation on the `hash` column vs. the SQLite test runner

- **Decision**: Apply the collation **driver-aware**: only attach `->collation('utf8mb4_bin')`
  when the connection driver is `mysql`. On SQLite (tests) the column is a plain
  `varchar`/`text`, whose default comparison is already **binary/case-sensitive**, so the
  case-sensitive-uniqueness behaviour is preserved in tests without an unsupported collation.
- **Rationale**: Laravel's SQLite grammar would emit `COLLATE utf8mb4_bin`, which SQLite does
  not recognise and which fails at migrate time. Guarding on
  `Schema::getConnection()->getDriverName() === 'mysql'` keeps one migration file working on
  both engines. SQLite's default `BINARY` collation makes `abcdefghij` ≠ `ABCDEFGHIJ`,
  matching the MySQL `utf8mb4_bin` behaviour the tests assert.
- **Alternatives considered**:
  - Run tests against MySQL — rejected: contradicts the existing `phpunit.xml`
    (`DB_CONNECTION=sqlite`, `:memory:`) and CI, and slows the suite for no schema benefit.
  - Drop the collation entirely — rejected: loses MySQL-level case-sensitive uniqueness, a
    stated requirement (FR-004).

## R3. `created_at` default / `updated_at` ON UPDATE behaviour, portably

- **Decision**: Use `->useCurrent()` on `created_at` (portable: `DEFAULT CURRENT_TIMESTAMP`
  on both MySQL and SQLite) and apply `->useCurrentOnUpdate()` to `updated_at`
  **driver-aware (MySQL only)**, mirroring the live table's
  `ON UPDATE CURRENT_TIMESTAMP`. `activated_at` and `deleted_at` are plain nullable
  timestamps.
- **Rationale**: The live MySQL table sets these defaults at the DB level, which matters for
  the **manual raw-SQL import** (rows inserted outside Eloquent still get timestamps). SQLite
  has no `ON UPDATE` clause, so guarding `useCurrentOnUpdate()` to MySQL keeps the migration
  portable. For app-layer inserts, Eloquent manages timestamps regardless.
- **Alternatives considered**: Plain `$table->timestamps()` — rejected: drops the DB-level
  defaults the live table has and that the manual importer relies on.

## R4. Foreign key `trashposts.user_id` → `users.id` and SQLite

- **Decision**: Define `user_id` as a nullable `foreignId` with a constrained FK to
  `users.id`, `nullOnDelete()`. Migration order guarantees `users` exists first
  (`0001_01_01_000000…` runs before `2026_06_08_000000_create_trashposts_table`).
- **Rationale**: Laravel's SQLite connection enables FK enforcement by default
  (`config/database.php` → `sqlite.foreign_key_constraints = true`), so the "a post MUST NOT
  reference a non-existent user" rule (FR-001a) is enforced in tests too. `nullOnDelete`
  preserves a post if its owner is deleted (owner reference is optional).
- **Alternatives considered**: `cascadeOnDelete` — rejected: deleting a user should not erase
  their posts; the relationship is intentionally loose/optional. Plain unconstrained
  `unsignedBigInteger` — rejected: loses referential integrity the spec requires.

## R5. `hash` exact-length / character-set validation (FR-005) at the schema layer

- **Decision**: The schema enforces what DDL can express: `varchar(10)` (max length 10) +
  `unique` + `utf8mb4_bin` (case-sensitive uniqueness). **Exact-length-10** and the
  `[A-Za-z0-9_-]` **character set** are application-layer validation, applied wherever codes
  are minted/accepted — **out of scope for this schema-only feature** (the spec builds "no
  app behavior… only the schema").
- **Rationale**: MySQL `varchar(10)` caps length but cannot require *exactly* 10 chars or a
  character set without a `CHECK`/`REGEXP_LIKE` constraint, which is MySQL-only (unsupported
  on the SQLite test runner) and exceeds the "schema only, no app behavior" scope. The
  uniqueness and case-sensitivity acceptance scenarios (FR-003, FR-004) are fully testable on
  both engines today; full format validation arrives with the code-minting feature.
- **Alternatives considered**: MySQL `CHECK (REGEXP_LIKE(hash,'^[A-Za-z0-9_-]{10}$'))` —
  rejected for this feature: not portable to the test runner, untested in CI, and beyond the
  schema-only scope. Recorded so the follow-up feature owns it.
- **Note on `App\Support\PublicCode`**: the existing 11-char `PublicCode` helper is the
  Constitution Principle V code and is **left untouched**. The prototype `hash` is a distinct,
  10-char identifier; no generator/validator for it is built here (schema-only).

## R6. Durable persistence across container removal and `docker rmi` (FR-007, US2)

- **Decision**: Persistence is provided by the **existing named Docker volume** `mysql-data`
  (`ladybug_mysql-data`) mounted at `/var/lib/mysql`. No change to the persistence mechanism
  is needed; the feature documents and verifies it and renames the database to `trashdb`.
- **Rationale**: Docker named volumes are independent of both container and image lifecycles.
  `docker compose down` (without `-v`) and `docker rmi mysql:8.0` remove containers/images but
  **never** touch the volume; data is destroyed only by an explicit `docker compose down -v`
  or `docker volume rm`. This exactly satisfies FR-007 ("destroyed only by a deliberate wipe").
- **Alternatives considered**: Host bind-mount (`./data:/var/lib/mysql`) — rejected: a named
  volume is already in place, is cross-platform (Windows host), and avoids host-permission
  issues; switching adds risk for no benefit.

## R7. Database rename `ladybug` → `trashdb`

- **Decision**: Update `MYSQL_DATABASE` and the backend `DB_DATABASE` in
  `docker-compose.yml`, and `DB_DATABASE` in `backend/.env.example`, from `ladybug` to
  `trashdb`. `config/database.php` is env-driven and needs no edit.
- **Rationale**: FR-014 mandates the name `trashdb`. Changing the compose env var makes a fresh
  volume initialise the `trashdb` database automatically; an already-initialised `mysql-data`
  volume keeps its existing databases, so on an existing dev volume the operator creates
  `trashdb` once (documented in quickstart) or recreates the volume. New checkouts get
  `trashdb` automatically.
- **Alternatives considered**: Keep `ladybug` and create `trashdb` as a second database —
  rejected: contradicts FR-014 and the spec's explicit single-database name.

## R8. Schema reference source (live table vs. migration)

- **Decision**: Treat the spec's recorded **live** `trashposts` structure (port 3306,
  verified via `SHOW COLUMNS` during clarification) as authoritative, **excluding** `temp`
  and `oldfile`, and replacing the stale `text` column with `metadata`. No live re-query is
  performed during planning — the spec captured the verified structure and the external 3306
  prototype DB is the schema reference only (Ladybug's own MySQL runs on host port 4444).
- **Rationale**: The spec already froze the authoritative column list; re-querying adds no
  information and the prototype DB is not Ladybug's target. The migration encodes that list.
- **Alternatives considered**: Re-derive from the prototype's migration file — rejected: the
  spec states the live table drifted from its migration (gained `metadata`; lost `text`).

## Resolved column list (authoritative for implementation)

`trashposts`: `id` (PK), `hash` (varchar(10), unique, utf8mb4_bin on MySQL, nullable per
prototype), `title`, `type`, `file`, `youtube` (all nullable varchar(255)), `user_id`
(nullable FK → users.id), `comment` (text, nullable), `metadata` (text, nullable),
`created_at` (DEFAULT CURRENT_TIMESTAMP), `updated_at` (ON UPDATE CURRENT_TIMESTAMP on
MySQL), `activated_at` (nullable), `deleted_at` (nullable, soft delete). **Excluded**:
`temp`, `oldfile`, `text`, and the prototype's free-text `user` string (replaced by `user_id`).

`users`: `id` (PK), `name`, `hash` (varchar(10), unique), `email` (unique),
`email_verified_at` (nullable), `password`, `remember_token`, `created_at`, `updated_at`.
