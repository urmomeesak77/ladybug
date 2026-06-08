# Implementation Plan: Persistent Database Schema (Posts + Users)

**Branch**: `002-database-schema` | **Date**: 2026-06-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-database-schema/spec.md`

## Summary

Establish Ladybug's persistent relational schema by faithfully copying the **live**
Trashpost prototype tables (`trashposts` + `users`) into Ladybug's own MySQL database
named **`trashdb`**, delivered as reversible **Laravel migrations**. The one intentional
enhancement over the prototype is replacing the loose `user` string with a nullable
foreign key `trashposts.user_id` → `users.id`. The legacy `temp`/`oldfile` columns and the
stale `text` column are excluded. Data persistence across container removal and image
uninstall (`docker rmi`) is guaranteed by the existing durable named Docker volume. Data
import is **out of scope** (manual operator task). Tests assert table existence, columns,
unique constraints (`hash`, `email`), nullable FK behaviour, and migration reversibility,
keeping coverage ≥ 90%.

## Technical Context

**Language/Version**: PHP 8.3 (composer platform pin; `require` floor `^8.2`)

**Primary Dependencies**: Laravel 12 (Eloquent ORM + migrations); no new dependencies

**Storage**: MySQL 8.0 (runtime, database `trashdb`); SQLite in-memory (test runner)

**Testing**: PHPUnit 11 via `php artisan test`; `RefreshDatabase` against SQLite `:memory:`

**Target Platform**: Linux container (dev `docker-compose`), CI runner (Ubuntu)

**Project Type**: Web application — decoupled `backend/` (Laravel API) + `frontend/` (React); this feature touches `backend/` only

**Performance Goals**: N/A (schema feature; no request-path code)

**Constraints**: Migrations MUST be reversible and portable across MySQL (runtime) and
SQLite (tests); `hash` is `varchar(10)` `utf8mb4_bin` on MySQL (case-sensitive, unique);
no raw SQL; secrets via env only; coverage ≥ 90%

**Scale/Scope**: 2 tables (one new `trashposts`, one amended `users`); 1 new model
(`Trashpost`), 1 amended model (`User`); compose + env config rename to `trashdb`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Minimal Dependencies (NON-NEGOTIABLE) | ✅ PASS | No new npm/Composer packages. Uses Eloquent + migrations already in the baseline stack. |
| II. Coding Conventions | ✅ PASS | Migrations/models use `declare(strict_types=1)`, PSR-12, typed signatures, functions < 30 lines, braces on single-line bodies. |
| III. Browser-Native Navigation | ➖ N/A | No UI/navigation in this feature. |
| IV. Theme & Accessibility | ➖ N/A | No UI in this feature. |
| V. Stable Meme Identifiers | ⚠️ DOCUMENTED EXCEPTION | Spec mandates the prototype's `hash` (10 chars, `[A-Za-z0-9_-]`, `utf8mb4_bin`, case-sensitive), deviating from the 11-char `[A-Z0-9-]` rule. Explicit owner decision — see Complexity Tracking. |
| VI. Security & Input Validation | ✅ PASS | ORM/migrations only (no string-concatenated SQL); DB credentials from env; `.env.example` updated with placeholders; no secrets committed. |
| VII. Test Coverage & Organization | ✅ PASS | New/changed model code covered by tests under `tests/` mirroring `app/`; overall coverage stays ≥ 90%. Migration files are excluded from the coverage `source` set (`phpunit.xml` includes `app` only). |
| Tech & Architecture Constraints | ✅ PASS | MySQL via Eloquent; schema changes via Laravel migrations; backend-only change. |

**Initial gate result**: PASS with one documented exception (Principle V). Re-checked
after Phase 1 design — still PASS (no new violations introduced; see end of document).

## Project Structure

### Documentation (this feature)

```text
specs/002-database-schema/
├── plan.md              # This file (/speckit-plan command output)
├── spec.md              # Feature specification (pre-existing)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── schema.md        # The DB schema contract (table DDL)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created here)
```

### Source Code (repository root)

```text
backend/
├── app/
│   └── Models/
│       ├── User.php                 # AMEND: add hash, posts() hasMany relationship
│       └── Trashpost.php            # NEW: table=trashposts, fillable, casts, SoftDeletes, user() belongsTo
├── database/
│   └── migrations/
│       ├── 0001_01_01_000000_create_users_table.php   # AMEND: add hash (varchar(10), unique, driver-aware utf8mb4_bin)
│       └── 2026_06_08_000000_create_trashposts_table.php  # NEW: trashposts + nullable FK user_id
├── tests/
│   ├── Unit/
│   │   └── Models/
│   │       ├── UserTest.php         # AMEND: add hash fill/relationship assertions
│   │       └── TrashpostTest.php    # NEW: fillable, casts, soft delete, relationship
│   └── Feature/
│       └── Database/
│           └── SchemaTest.php       # NEW: tables/columns exist, unique hash/email, nullable FK, reversibility
├── .env.example                     # AMEND: DB_DATABASE=trashdb
└── config/database.php              # no change (env-driven)

docker-compose.yml                    # AMEND: MYSQL_DATABASE/DB_DATABASE -> trashdb (volume already durable)
```

**Structure Decision**: Web-application layout (Option 2). Only the Laravel `backend/`
is touched; no frontend changes. Tests mirror source per Constitution Principle VII
(`app/Models/Trashpost.php` → `tests/Unit/Models/TrashpostTest.php`); the cross-table
schema/constraint behaviour lives in a Feature test under `tests/Feature/Database/`.

## Complexity Tracking

> Filled because the Constitution Check records one violation that must be justified.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Principle V — `hash` is 10 chars over `[A-Za-z0-9_-]` (`utf8mb4_bin`, case-sensitive) instead of 11 chars over `[A-Z0-9-]` (uppercase) | The schema must be a faithful copy of the **live** prototype so existing `hash` values copy over verbatim and old shareable links keep working after the manual import. Explicit, recorded owner decision (spec Resolved Decisions §1, FR-005). | A constitution-compliant 11-char uppercase code would change every existing identifier, break all old prototype links, and force lossy remapping during the manual import — defeating the feature's purpose (zero-loss copy of existing content). |
