# Feature Specification: Persistent Database Schema (Posts + Users)

**Feature Branch**: `002-database-schema`

**Created**: 2026-06-08

**Status**: Draft

**Input**: User description: "create database. check mysql in port 3306 for trash db, trashpost table. copy that over to this project. also users table. make sure this project db is permanent and wont be delete is docker image uninstalled"

## Context & Source of Truth

The existing **Trashpost** prototype (`C:\projects\trash`) already defines the two tables
this feature replicates. A live MySQL server is running and reachable on host port **3306**
(confirmed: `mysqld`, the prototype's `trash` database). **The authoritative schema is the LIVE
table structure on port 3306, NOT the prototype's migration files** — the live `trashposts` table
has drifted from its migration (it gained `metadata`, `temp`, `oldfile` and no longer has the
migration's `text` column). The live structure (verified via `SHOW COLUMNS`) is:

- `trashposts` table —
  `id` (PK), `hash` (`varchar(10)`, unique, `utf8mb4_bin`), `title` (`varchar(255)`),
  `type` (`varchar(255)`), `file` (`varchar(255)`), `youtube` (`varchar(255)`),
  `user` (`varchar(255)`), `comment` (`text`), `metadata` (`text`),
  `created_at` (default CURRENT_TIMESTAMP), `updated_at` (on update CURRENT_TIMESTAMP),
  `activated_at`, `deleted_at`, `temp` (`varchar(255)`), `oldfile` (`varchar(255)`).
- `users` table — `id`, `hash` (`varchar(10)`, unique), `name`, `email` (unique),
  `email_verified_at`, `password`, `remember_token`, `created_at`, `updated_at`. (Live = migration.)

> **`temp` and `oldfile` are intentionally EXCLUDED** from the new schema (owner decision) — they
> are leftover working/legacy columns, not real domain data. They exist in the live source table
> but are not part of the new `trashdb` schema.

Ladybug already ships a dev `docker-compose.yml` with a MySQL 8.0 service backed by the named
Docker volume `mysql-data` (`ladybug_mysql-data`). This feature establishes Ladybug's own schema
in a database named **`trashdb`** and guarantees its data survives container/image removal.

### Resolved decisions (from clarification)

1. **Prototype schema, verbatim.** The tables keep the prototype's names — **`trashposts`** and
   **`users`** — and their columns, including the **`hash`** public identifier exactly as the
   prototype defines it: **10 characters, `utf8mb4_bin` collation, unique**. The prototype column
   names/types are the reference for every retained column (hash, title, type, file, youtube,
   owning user, comment, metadata, lifecycle timestamps); `temp` and `oldfile` are excluded. The `hash` alphabet is **`[A-Za-z0-9_-]`** (letters,
   digits, hyphen, underscore), case-sensitive.
   - ⚠️ **Constitution conflict:** the 10-char `hash` over `[A-Za-z0-9_-]` deviates from
     Constitution Principle V (11-char `[A-Z0-9-]`, uppercase only). This is an explicit owner
     decision; the plan's Constitution Check MUST record it as a documented exception (Complexity
     Tracking).
2. **Data import is MANUAL (out of scope).** This feature delivers the **schema only**. Copying
   existing rows from the prototype's live `trash` database into `trashdb` is performed **manually
   by the operator** (e.g., `mysqldump`/SQL) — there is no automated import command, seeder, or
   migration-embedded import. The unique `hash` is preserved verbatim by the manual copy, so old
   links keep working and duplicate inserts are rejected by the unique constraint.
3. **Database name is `trashdb`**, persisted by a durable named Docker volume so data survives
   container removal and image uninstall (`docker rmi`).

## Clarifications

### Session 2026-06-08

- Q: How should a post link to its owning user? → A: Use a nullable foreign key `trashposts.user_id` → `users.id` (the one intentional enhancement over the prototype's loose `user` string). Mapping the prototype's `user` string to a `user_id` is handled during the manual import.
- Q: Automated import or manual? → A: **Manual.** This feature delivers only the schema (Laravel migrations) + durable persistence; the operator imports data by hand. No import command/seeder is built.
- Q: Which schema is authoritative — the migration file or the live table? → A: The **live** `trashposts` table on port 3306. It includes `metadata` (absent from the migration) and has no `text` column.
- Q: Keep the live `temp` and `oldfile` columns? → A: No — drop them. They are leftover working/legacy columns; the new schema omits them entirely.
- Q: How is the schema delivered? → A: As **Laravel migration files** in `backend/database/migrations/` (one per table, with `up()`/`down()`), applied by `php artisan migrate`.
- Q: Should the tables use constitution vocabulary (`memes`) or the prototype names? → A: Use the prototype's table names exactly — `trashposts` and `users` — and the prototype's column names.
- Q: Should the public identifier follow the constitution (11-char `[A-Z0-9-]`) or the prototype? → A: Use the prototype's `hash` exactly — 10 characters, `utf8mb4_bin`, unique. This is an explicit deviation from Constitution Principle V and must be recorded as a documented exception at plan time.
- Q: Preserve the prototype's original code for old links? → A: Yes — the 10-char `hash` is the unique column and is copied verbatim by the manual import, so old `hash` links keep working. No separate legacy column needed.
- Q: What characters are allowed in the `hash`? → A: `[A-Za-z0-9_-]` — letters, digits, hyphen, and underscore (`_`), case-sensitive, 10 characters.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Post and account data has a home (Priority: P1)

As the Ladybug application, I need persistent tables to store uploaded posts (memes) and
registered user accounts, so that content and accounts created in the app are saved and can be
read back across requests and restarts.

**Why this priority**: Nothing in the product (feed, single-post page, auth) can store or read
data without these tables. This is the foundational slice.

**Independent Test**: Apply the schema to a fresh database, insert one post row and one user row,
read them back, and confirm all columns and constraints (unique code, unique email) behave as
specified.

**Acceptance Scenarios**:

1. **Given** an empty Ladybug database, **When** the schema is applied, **Then** a posts table and
   a users table exist with all columns, types, nullability, and unique constraints described in
   Context above.
2. **Given** the schema is applied, **When** a post is inserted with a `hash` already used by
   another post, **Then** the database rejects it (uniqueness enforced).
3. **Given** the schema is applied, **When** a user is inserted with an email already in use,
   **Then** the database rejects it (uniqueness enforced).
4. **Given** a post row exists, **When** it is read back, **Then** every stored field (title, type,
   file, youtube link, owning user, comment, metadata, and the lifecycle timestamps) is returned
   unchanged.

---

### User Story 2 - Data survives infrastructure teardown (Priority: P1)

As the project owner, I need the database contents to persist even if the Docker containers are
stopped/removed and the Docker **images are uninstalled**, so that I never lose stored posts and
accounts to a routine environment rebuild.

**Why this priority**: Explicitly requested ("make sure this project db is permanent and wont be
delete[d] [if] docker image uninstalled"). Data loss on a rebuild is unacceptable.

**Independent Test**: Insert rows, stop and remove the database container, remove
(`docker rmi`) the MySQL image, bring the environment back up, and confirm the previously
inserted rows are still present.

**Acceptance Scenarios**:

1. **Given** rows exist in the database, **When** the containers are stopped and removed (without
   explicitly destroying the data store) and the MySQL image is removed, **Then** after bringing
   the environment back up the same rows are still readable.
2. **Given** a fresh checkout of the repository on a new machine, **When** the documented setup
   steps are followed, **Then** the schema is created automatically and is ready to accept data.
3. **Given** the environment is rebuilt, **When** the schema is re-applied, **Then** it does not
   duplicate or destroy existing tables/data (idempotent, version-tracked schema changes).

---

### User Story 3 - Reproducible, reviewable schema (Priority: P2)

As a developer, I need the schema defined as version-controlled, ordered, reversible change
units (not ad-hoc SQL run by hand), so the database can be recreated identically anywhere and
reviewed like any other code.

**Why this priority**: Required for CI, onboarding, and the constitution's "schema changes go
through migrations" rule. Important but depends on US1 existing first.

**Independent Test**: From a clean database, run the schema-change tooling forward to build every
table, then roll it back to empty, confirming each step is reversible.

**Acceptance Scenarios**:

1. **Given** a clean database, **When** the schema changes are applied in order, **Then** all
   tables are created and the applied-change ledger records them.
2. **Given** a fully built database, **When** the schema changes are rolled back, **Then** the
   tables are removed cleanly with no orphaned objects.

---

### Edge Cases

- **Hash format**: the `hash` is exactly the prototype's — 10 characters from `[A-Za-z0-9_-]`,
  `utf8mb4_bin`, unique. The schema MUST enforce the 10-char length and uniqueness.
- **Case-sensitive uniqueness**: `hash` values are case-sensitive (`utf8mb4_bin`); `abcdefghij`
  and `ABCDEFGHIJ` are distinct. Email uniqueness follows normal case-insensitive email
  expectations.
- **Manual data import**: copying existing rows from the prototype is a manual operator task, out
  of this feature's scope. Regardless of how rows are inserted, the `hash` and `email` unique
  constraints MUST reject duplicates, so a repeated manual import cannot create duplicate rows.
- **Partial/failed apply**: if a schema change fails midway, the tooling must leave the database in
  a known state (the failed step is recorded as not-applied), allowing a safe retry.
- **Nullable fields**: most post columns are nullable in the prototype — reading a post with only a
  YouTube link and no uploaded file (or vice versa) must succeed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a persistent **`trashposts`** table mirroring the **live**
  prototype columns (per the Context list): surrogate id, `hash`, `title`, `type`, `file`,
  `youtube`, owning-user reference, `comment` (text), `metadata` (text), and the timestamps
  `created_at`, `updated_at`, `activated_at`, `deleted_at`. There is no `text` column (the stale
  migration's `text` is excluded; the live table replaced it with `metadata`). The live `temp` and
  `oldfile` columns MUST NOT be created.
- **FR-001a**: The schema mirrors the prototype's structure with **one** intentional enhancement:
  the owning-user reference is a **nullable foreign key `trashposts.user_id` → `users.id`** instead
  of the prototype's free-text `user` string. A post MUST NOT reference a non-existent user;
  `user_id` is null when no owner applies. All other columns/types/nullability mirror the prototype.
- **FR-002**: The system MUST provide a persistent **users** table mirroring the prototype's
  `users` columns: surrogate id, name, `hash`, unique email, email-verified timestamp,
  password (hashed), remember token, and created/updated timestamps.
- **FR-003**: The `trashposts` table MUST enforce a **unique** constraint on `hash`; the `users`
  table MUST enforce **unique** constraints on email and on its `hash`.
- **FR-004**: `hash` values MUST be stored case-sensitively (`utf8mb4_bin`) so that values differing
  only by letter case are treated as distinct.
- **FR-005**: The public identifier MUST be the prototype's `hash` column exactly: **10 characters
  from `[A-Za-z0-9_-]`** (letters, digits, hyphen, underscore), **`utf8mb4_bin` collation, unique,
  case-sensitive**. Values violating the length or character set MUST be rejected. (This
  deliberately deviates from Constitution Principle V's 11-char `[A-Z0-9-]` rule — see the
  Constitution-conflict note in Resolved decisions; the plan MUST record the exception.)
- **FR-006**: Schema creation MUST be delivered as **Laravel migration files** under
  `backend/database/migrations/` (one migration per table: `create_trashposts_table`,
  `create_users_table`). Each migration MUST implement both `up()` and `down()` (reversible),
  be applied via `php artisan migrate` and tracked in the `migrations` ledger, and contain no
  hand-run/raw SQL. Re-running `migrate` MUST NOT destroy or duplicate existing data.
- **FR-007**: The database's stored data MUST persist across container stop/remove **and** removal
  of the database image; data MUST only be destroyed by an explicit, deliberate "wipe the data
  store" action, never by a routine environment or image rebuild.
- **FR-008**: The documented setup MUST allow a developer on a clean machine to obtain a working,
  schema-applied database by following the project's setup steps.
- **FR-009**: All database access introduced by this feature MUST use the ORM / parameterized
  queries only (no string-concatenated SQL), per the constitution.
- **FR-010**: Database credentials and connection settings MUST come from environment
  configuration only, with a committed example template and no real secrets in the repository.
- **FR-011**: The feature MUST include automated tests proving the tables exist and enforce their
  constraints (unique code, unique email, nullability), keeping overall coverage at or above the
  project's 90% threshold.
- **FR-012**: The tables MUST keep the prototype's names — **`trashposts`** and **`users`** — and
  the prototype's column names and types (including the 10-char `hash`). The schema is a faithful
  copy of the prototype, with the single deviation noted in FR-001a (the `user` string becomes a
  `user_id` foreign key).
- **FR-013**: Automated data import is **OUT OF SCOPE**. The feature MUST NOT build an import
  command, seeder, or migration-embedded import. Copying existing rows from the prototype's `trash`
  database into `trashdb` is a **manual operator task**; the schema MUST be shaped so a manual copy
  (preserving each `hash` verbatim) succeeds and is protected by the unique constraints.
- **FR-014**: Ladybug's database MUST be named **`trashdb`**.

### Key Entities *(include if feature involves data)*

- **Post (`trashposts` row)**: A single uploaded item in the feed. Holds a stable 10-char `hash`
  (the shareable identifier), an optional title, a content type, a reference to an uploaded file
  and/or a YouTube link, a nullable owning-user foreign key (`user_id` → `users.id`), optional
  `comment` and `metadata` text, and lifecycle timestamps (created, updated, activated,
  soft-deleted). Mirrors the live prototype `trashposts` row (minus the dropped `temp`/`oldfile`),
  with its loose `user` string upgraded to a `user_id` foreign key.
- **User (account)**: A registered account. Holds a name, a stable 10-char `hash`, a unique email,
  an email-verification timestamp, a hashed password, a remember token, and created/updated
  timestamps. Owns zero or more Posts via `trashposts.user_id`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Applying the schema to a brand-new, empty database produces both tables with 100% of
  the specified columns and constraints, verified by automated tests.
- **SC-002**: After inserting data, removing the database container, removing the database image,
  and rebuilding the environment, 100% of the previously inserted rows are still readable (zero
  data loss on image uninstall).
- **SC-003**: A developer starting from a clean repository checkout reaches a working,
  schema-applied database in under 10 minutes using only the documented setup steps.
- **SC-004**: Inserting a duplicate `hash` or duplicate email is rejected 100% of the time.
- **SC-005**: The schema can be applied forward and rolled back to empty repeatedly with no errors
  and no leftover database objects.
- **SC-006**: A manual copy of prototype rows into `trashdb` (preserving each `hash`) succeeds with
  zero schema errors, and attempting to insert a duplicate `hash` or `email` is rejected 100% of
  the time. (Automated import itself is out of scope.)

## Assumptions

- The target database for this feature is Ladybug's own MySQL instance (the existing
  `docker-compose.yml` `mysql` service), with its database named **`trashdb`**. The prototype's
  `trash` DB on port 3306 is the **schema reference** only; copying its rows is a manual operator
  task outside this feature.
- The compose `MYSQL_DATABASE` / `DB_DATABASE` settings change from `ladybug` to `trashdb`; this
  is a config update within this feature, not a separate effort.
- Persistence is achieved by a durable data store (named volume or host-mounted directory) that
  is independent of any container or image lifecycle; "image uninstall" (`docker rmi`) and
  container removal do not touch it. Only an explicit volume-destroy action removes data. The
  precise mechanism is an implementation detail of the plan, constrained by FR-007.
- The owning-user reference is a nullable foreign key `trashposts.user_id` → `users.id` (the one
  enhancement over the prototype's loose `user` string). Mapping the prototype's `user` string to a
  `user_id` is part of the manual import, not automated by this feature.
- Password values are stored already-hashed by the application layer; this feature defines the
  column, not the hashing.
- No feed/auth/API behavior is built here — this feature is limited to the **schema (Laravel
  migrations)** and **durable persistence**. Data import and all app behavior arrive separately.
