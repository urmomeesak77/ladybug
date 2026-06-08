---
description: "Task list for feature: Persistent Database Schema (Posts + Users)"
---

# Tasks: Persistent Database Schema (Posts + Users)

**Input**: Design documents from `specs/002-database-schema/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/schema.md, quickstart.md

**Tests**: INCLUDED — the spec explicitly requires automated tests (FR-011, SC-001/004/005)
and the constitution mandates ≥90% coverage (Principle VII). Tests are written before
implementation (TDD) within each story.

**Organization**: Tasks are grouped by user story to enable independent implementation and
testing. This is a **backend-only** feature (Laravel migrations + models); no frontend changes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story the task serves (US1, US2, US3)
- File paths are relative to the repository root (`C:\projects\ladybug`)

## Path Conventions

- Backend Laravel app: `backend/`
- Migrations: `backend/database/migrations/`
- Models: `backend/app/Models/`
- Tests mirror source under `backend/tests/` (Constitution Principle VII)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Configure the database name (`trashdb`) that every story's verification runs against.

- [ ] T001 Rename the dev database to `trashdb` in `docker-compose.yml` (`mysql` service `MYSQL_DATABASE` and the `backend` service `DB_DATABASE`), changing the value from `ladybug` to `trashdb` (FR-014, research R7).
- [ ] T002 [P] Update `backend/.env.example` so `DB_DATABASE=trashdb` (no real secrets; placeholders only — FR-010, FR-014).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Ensure the test runner can apply the schema in isolation before any story tests are written.

**⚠️ CRITICAL**: All story test tasks depend on this phase.

- [ ] T003 Verify `backend/phpunit.xml` sets `DB_CONNECTION=sqlite` and `DB_DATABASE=:memory:` so `RefreshDatabase` applies the migrations per test against SQLite in-memory; confirm migration files are the only schema source and `app` is the only coverage `source` (research R2, plan Constitution Check VII).

**Checkpoint**: Database name configured and test harness confirmed — story work can begin.

---

## Phase 3: User Story 1 - Post and account data has a home (Priority: P1) 🎯 MVP

**Goal**: Provide persistent `trashposts` and `users` tables with all specified columns,
types, nullability, and unique constraints, plus the `Trashpost`/`User` Eloquent models.

**Independent Test**: Apply the schema to a fresh DB, insert one post row and one user row,
read them back, and confirm all columns and constraints (unique `hash`, unique `email`,
case-sensitive `hash`, nullable FK) behave as specified.

### Tests for User Story 1 (write first; must FAIL before implementation) ⚠️

- [ ] T004 [P] [US1] Schema feature test in `backend/tests/Feature/Database/SchemaTest.php`: assert `trashposts` and `users` exist with every expected column; assert excluded columns (`temp`, `oldfile`, `text`, free-text `user`) are ABSENT; assert `trashposts.hash`, `users.hash`, `users.email` reject duplicates; assert `hash` case-sensitive distinctness (`abcdefghij` ≠ `ABCDEFGHIJ`); assert `trashposts.user_id` rejects a non-existent user and allows null (FR-001, FR-002, FR-003, FR-004, FR-005, SC-001, SC-004).
- [ ] T005 [P] [US1] Trashpost model unit test in `backend/tests/Unit/Models/TrashpostTest.php`: assert `$table = 'trashposts'`, `$fillable` set, datetime casts, `SoftDeletes` (soft delete sets `deleted_at` and hides row from default queries), and `user()` `belongsTo` relationship (data-model.md).
- [ ] T006 [P] [US1] User model unit test (amend) in `backend/tests/Unit/Models/UserTest.php`: assert `hash` can be set and read, `password`/`remember_token` hidden, and `posts()` `hasMany` returns the user's `Trashpost` rows (data-model.md).

### Implementation for User Story 1

- [ ] T007 [US1] Amend `backend/database/migrations/0001_01_01_000000_create_users_table.php` to add a `hash` column inside the existing `Schema::create('users', ...)`: `varchar(10)`, `unique`, driver-aware `->collation('utf8mb4_bin')` only when driver is `mysql` (research R1, R2; contracts/schema.md).
- [ ] T008 [US1] Create migration `backend/database/migrations/2026_06_08_000000_create_trashposts_table.php` with `up()` building all columns per contracts/schema.md (`id`; nullable unique `hash` varchar(10), driver-aware `utf8mb4_bin`; nullable `title`/`type`/`file`/`youtube`; nullable `foreignId('user_id')->constrained('users')->nullOnDelete()`; nullable `comment`/`metadata` text; `created_at` `->useCurrent()`; `updated_at` `->useCurrent()` + driver-aware `->useCurrentOnUpdate()`; nullable `activated_at`/`deleted_at`) and `down()` `Schema::dropIfExists('trashposts')` (FR-001, FR-001a, FR-006; research R2/R3/R4).
- [ ] T009 [P] [US1] Create `backend/app/Models/Trashpost.php`: `declare(strict_types=1)`, `$table='trashposts'`, `$fillable=['hash','title','type','file','youtube','user_id','comment','metadata']`, `use SoftDeletes`, datetime casts for the four timestamps, and `user()` `belongsTo(User::class)` (data-model.md; PSR-12, functions <30 lines).
- [ ] T010 [US1] Amend `backend/app/Models/User.php`: add `posts()` `hasMany(Trashpost::class)`; keep `$fillable` as `['name','email','password']` (assign `hash` explicitly, not mass-assignable) and `$hidden`/`casts` unchanged (data-model.md).

**Checkpoint**: Schema applies on a fresh DB; both tables and models pass their tests — MVP complete and independently demoable.

---

## Phase 4: User Story 2 - Data survives infrastructure teardown (Priority: P1)

**Goal**: Guarantee stored data persists across container stop/remove AND MySQL image
removal (`docker rmi`), and that a clean checkout reaches a schema-applied DB via docs.

**Independent Test**: Insert rows, `docker compose down` (no `-v`), `docker rmi mysql:8.0`,
`docker compose up -d`, then confirm the rows are still readable (manual validation — infra,
not CI-testable).

### Implementation for User Story 2

- [ ] T011 [US2] Confirm `docker-compose.yml` mounts the durable named volume `mysql-data` at `/var/lib/mysql` on the `mysql` service (so containers/images can be removed without data loss); adjust if missing (FR-007, SC-002, research R6).
- [ ] T012 [P] [US2] Update the project setup docs (`README.md`) to cover: clean-checkout bring-up to a `trashdb` schema-applied DB, the note for pre-existing `mysql-data` volumes (create `trashdb` once / `migrate:fresh`), and that data is destroyed only by an explicit `docker compose down -v` / `docker volume rm` (FR-007, FR-008, SC-002, SC-003; quickstart §3).

**Checkpoint**: Persistence mechanism verified and documented; a new machine can reach a working DB from docs alone.

---

## Phase 5: User Story 3 - Reproducible, reviewable schema (Priority: P2)

**Goal**: The schema is delivered as ordered, reversible Laravel migrations that build
forward and roll back to empty with no orphaned objects.

**Independent Test**: From a clean DB, migrate forward to build every table, then roll back
to empty, confirming each step is reversible and leaves no leftover objects.

### Tests for User Story 3 (write first; must FAIL before implementation) ⚠️

- [ ] T013 [P] [US3] Migration reversibility test in `backend/tests/Feature/Database/MigrationReversibilityTest.php`: assert `trashposts` and `users` exist after migrate, `migrate:rollback` drops both with no leftover objects (FK removed before `users`), and a re-run rebuilds them cleanly (FR-006, SC-005; quickstart §4).

### Implementation for User Story 3

- [ ] T014 [US3] Verify/finish `down()` in both migrations so rollback drops cleanly in reverse timestamp order — `2026_06_08_000000_create_trashposts_table.php` (drops `trashposts`, removing the FK first) and `0001_01_01_000000_create_users_table.php` (drops `users`) — with `up()`/`down()` reversible and no raw SQL (FR-006, FR-009, SC-005).

**Checkpoint**: Migrations apply and roll back repeatably; schema is recreatable anywhere.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Enforce conventions, coverage, and end-to-end validation.

- [ ] T015 [P] Run `vendor/bin/pint --test` in `backend/` and fix any style violations in the new/changed files (Constitution Principle II; CI lint gate).
- [ ] T016 Run the coverage gate: `vendor/bin/phpunit --coverage-clover coverage.clover` in `backend/`, then `python ../.github/scripts/check_coverage.py coverage.clover` — confirm ≥90% (FR-011, Principle VII; quickstart §5).
- [ ] T017 Execute the `quickstart.md` end-to-end validation (bring up, migrate, constraint checks, persistence teardown, rollback) and confirm expected results (SC-001..SC-006).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all story tests.
- **User Stories (Phase 3+)**: Depend on Foundational. US1 is the schema/model core; US2 and US3 verify/document/test behaviour the US1 migrations provide.
- **Polish (Phase 6)**: Depends on all targeted stories being complete.

### User Story Dependencies

- **US1 (P1)**: Independent — delivers the tables and models (the MVP).
- **US2 (P1)**: Independent infra/doc verification; needs the `trashdb` config (T001) and benefits from US1 rows for manual validation, but its tasks don't modify US1 code.
- **US3 (P2)**: Reversibility test (T013) + `down()` verification (T014). Tests run against the migrations authored in US1, so US3 is most efficiently done after US1 but is independently checkable.

### Within Each User Story

- Tests are written first and must FAIL before implementation (TDD).
- Migrations before models where the model test needs the table.
- `create_users_table` (T007) before `create_trashposts_table` (T008) — FK target must exist (timestamp order guarantees this).

### Parallel Opportunities

- T002 (env file) runs parallel to T001 (compose).
- All US1 test tasks (T004, T005, T006) are parallel — different files.
- T009 (new `Trashpost.php`) is parallel to T010 (amend `User.php`) — different files.
- T012 (docs) is parallel to T011 (compose verify).
- T015 (lint) runs parallel to early polish; T016/T017 are sequential validation.

---

## Parallel Example: User Story 1

```bash
# Write all US1 tests together first (must fail before implementation):
Task: "Schema feature test in backend/tests/Feature/Database/SchemaTest.php"
Task: "Trashpost model unit test in backend/tests/Unit/Models/TrashpostTest.php"
Task: "User model unit test in backend/tests/Unit/Models/UserTest.php"

# Then the two models in parallel (different files):
Task: "Create Trashpost model in backend/app/Models/Trashpost.php"
Task: "Amend User model in backend/app/Models/User.php"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (`trashdb` config).
2. Complete Phase 2: Foundational (confirm SQLite test harness).
3. Complete Phase 3: User Story 1 (migrations + models + tests green).
4. **STOP and VALIDATE**: insert/read a post and a user; confirm constraints.
5. This is a shippable schema slice.

### Incremental Delivery

1. Setup + Foundational → ready to build schema.
2. US1 → tables + models (MVP, tests green).
3. US2 → verify + document durable persistence.
4. US3 → reversibility test + `down()` verification.
5. Polish → lint, coverage gate, quickstart validation.

---

## Notes

- [P] tasks = different files, no incomplete dependencies.
- Migration files are excluded from the coverage `source` set (`phpunit.xml` covers `app` only); model code is covered by US1 model tests.
- `utf8mb4_bin` collation and `ON UPDATE CURRENT_TIMESTAMP` are applied on MySQL only; SQLite degrades to portable binary/case-sensitive comparison (research R2/R3).
- Data import is OUT OF SCOPE (FR-013) — no seeder, import command, or migration-embedded import.
- Commit after each task or logical group; verify tests fail before implementing.
