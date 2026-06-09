# Data Migration Plan: Move Prototype Entries to Live

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Write the failing test before each implementation step.

**Goal:** Move the Trashpost prototype's existing **database entries** (users + posts) from
`C:\projects\trash` into the live Ladybug backend's `trashdb`, mapping the prototype schema onto
the feature-002 schema, so that the media seeded by feature 003 (`image/trash/...`) is backed by
real post records and the feed/meme pages have genuine content to serve.

**Why now:** Feature 003 placed ~8,704 image files on disk but nothing in the DB references them.
The `trashposts.file` column holds each post's media filename (e.g. `1dcmpenbnr.jpg`), which
resolves to the seeded tree via `App\Support\MediaPath`. Importing the rows is what makes the
seeded library *visible*. This is the data complement to the media seed.

**Architecture:** An idempotent Laravel Artisan ETL command,
`php artisan trashposts:import [--source=…] [--dry-run]`, that **extracts** from the prototype,
**transforms** prototype columns into the live schema, and **loads** via chunked upserts. It runs
once (re-runnable) on the developer workstation, mirroring the `media:seed` command's shape
(resolve source → process → verification report → exit code). It emits a report (per-table source
vs. dest counts, FK-resolution stats, media-linkage check, orphans) and exits non-zero on any
integrity failure.

**Source of truth (DECISION NEEDED — see Open Questions):** Recommended path is a **read-only
`legacy` MySQL connection** to the prototype database, configured in `config/database.php` and
gated by env (`LEGACY_DB_*`), so the import reads live rows directly. Fallback is a committed-out
NDJSON/SQL export the command can read offline. Either way the prototype DB is **never written**.

**Tech Stack:** PHP 8.3 / Laravel 12 (Artisan console + Eloquent/Query Builder), MySQL (live
`trashdb` + read-only `legacy` connection), PHPUnit 11 with sqlite fixtures (no live DB in tests).
No new dependencies (Principle I). Reuses `App\Support\MediaPath` for media-linkage verification.

**Scope note:** Backend-only, data-movement feature. It does **not** build the upload API, the
feed HTTP layer, or any UI. It depends on feature 002 (schema) and feature 003 (seeded media)
being in place. Media files themselves are out of scope (already on disk; this only links to them).

---

## Schema mapping (prototype → live)

### `users` (1:1 — import FIRST so posts can resolve their FK)

| Prototype column | Live column | Transform |
|------------------|-------------|-----------|
| `name` | `name` | copy |
| `hash` (10, utf8mb4_bin) | `hash` | copy verbatim — the stable account identifier and the join key |
| `email` | `email` | copy (unique) |
| `email_verified_at` | `email_verified_at` | copy |
| `password` | `password` | copy verbatim (already a Laravel bcrypt hash — do **not** re-hash) |
| `remember_token` | `remember_token` | copy |
| `created_at` / `updated_at` | `created_at` / `updated_at` | copy |
| `id` | — | **not reused**; live auto-assigns ids. Build an in-memory `hash → new id` map for FK resolution. |

### `trashposts`

| Prototype column | Live column | Transform |
|------------------|-------------|-----------|
| `hash` (10, utf8mb4_bin) | `hash` | copy verbatim — the public code and the idempotency key |
| `title` | `title` | copy |
| `type` | `type` | copy |
| `file` | `file` | copy verbatim — filename links to seeded media via `MediaPath::imageRelativePath` |
| `youtube` | `youtube` | copy |
| `user` (string, nullable) | `user_id` (FK→users) | **resolve**: look up the user by the prototype `user` key; `null` when the post is anonymous or no match is found (count as `unresolvedUser`) |
| `comment` | `comment` | copy |
| `metadata` | `metadata` | copy (prototype's evolved column; if a row only has legacy `text`, fall back to it) |
| `created_at` / `updated_at` / `activated_at` / `deleted_at` | same | copy verbatim — **preserve soft-deletes** (`deleted_at`) and `activated_at` |
| `id` | — | not reused; `hash` is the stable identifier |

**Idempotency keys:** `users.hash` (and `users.email`), `trashposts.hash`. Re-running upserts on
these keys — no duplicates, no corruption.

---

## File Structure

- Create: `backend/app/Console/Commands/ImportTrashpostsCommand.php` — the ETL command.
- Create: `backend/app/Support/LegacyImport.php` (optional) — pure transform helpers (column map,
  user-key resolution), kept I/O-free and unit-testable like `MediaPath`.
- Amend: `backend/config/database.php` — add a read-only `legacy` connection.
- Amend: `backend/.env.example` — `LEGACY_DB_CONNECTION/HOST/PORT/DATABASE/USERNAME/PASSWORD`
  placeholders (configurable, not secrets; real values live only in `.env`).
- Create: `backend/tests/Feature/Console/ImportTrashpostsCommandTest.php` — sqlite-fixture ETL test.
- Create: `backend/tests/Unit/Support/LegacyImportTest.php` — transform/mapping unit test (if helper added).

---

### Task 1: Read-only legacy connection + env (config)

- [ ] Add a `legacy` connection to `config/database.php` driven by `LEGACY_DB_*` env, defaulting
      to MySQL, intended read-only (the command never issues writes against it).
- [ ] Add the `LEGACY_DB_*` placeholders to `.env.example` with an explanatory comment.
- [ ] **Verify:** `php artisan tinker` (or a tiny test) can `DB::connection('legacy')->getPdo()`
      against the prototype, or the offline-export fallback path loads.

### Task 2: Transform helpers (TDD, if `LegacyImport` is extracted)

- [ ] **Failing test** `LegacyImportTest`: prototype row arrays map to live column arrays
      (`text`→`metadata` fallback, untouched `hash`/timestamps, `user` key passed through for
      resolution). Confirm RED.
- [ ] Implement `LegacyImport` pure mappers to pass. PSR-12, `declare(strict_types=1)`, <30-line
      functions, comments explain *why*. Confirm GREEN.

### Task 3: Users import (TDD)

- [ ] **Failing test** in `ImportTrashpostsCommandTest` using a sqlite `legacy` fixture: users are
      upserted into the live `users` table on `hash`; passwords copied verbatim (not re-hashed);
      re-run inserts 0. Confirm RED.
- [ ] Implement the users phase: chunked read from `legacy`, upsert on `hash`, build the
      `hash → live id` map. Confirm GREEN.

### Task 4: Trashposts import + FK resolution (TDD)

- [ ] **Failing test**: posts upsert on `hash`; `user` resolves to `user_id` (anonymous/missing →
      null, counted); `metadata`/timestamps/`deleted_at` preserved (soft-deleted rows imported
      `withTrashed`); re-run inserts 0. Confirm RED.
- [ ] Implement the posts phase reusing the user map. Confirm GREEN.

### Task 5: Media-linkage + verification report (TDD)

- [ ] **Failing test**: report lists per-table source vs. dest counts, `unresolvedUser` count,
      and `missingMedia` (posts whose `file` has no seeded image under
      `MediaPath::imageRelativePath('original', code, ext)` on the `public` disk); exit code is 0
      only when counts match and there are no FK/media integrity failures (or a documented,
      `--allow-orphans` style allowance). Confirm RED.
- [ ] Implement verification + report + exit code (mirror `SeedMediaCommand`). Confirm GREEN.

### Task 6: Dry-run + real run

- [ ] `--dry-run` reports without writing (transaction rollback or write-guard).
- [ ] **Run for real** against the prototype: report shows users + posts counts matching source,
      0 unresolved beyond expected anonymous posts, 0 unexpected `missingMedia`, exit 0.
- [ ] **Idempotent re-run:** inserts 0, report OK, exit 0.

### Task 7: Polish

- [ ] `vendor/bin/pint --test` clean on new files.
- [ ] `php artisan test` green; coverage ≥ 90% (`.github/scripts/check_coverage.py`).
- [ ] Document the import command in `backend/README.md` (alongside the `media:seed` section).

---

## Verification (acceptance)

- Live `users` count == prototype `users` count; every post's resolved `user_id` exists (no
  dangling FK).
- Live `trashposts` count == prototype `trashposts` count (including soft-deleted, via
  `withTrashed`); `deleted_at`/`activated_at` preserved.
- 100% of imported posts whose `type` is an image have their `file` resolve to a seeded media file
  under `image/trash/...` (reusing `MediaPath`); youtube-only posts (`file` null) are exempt.
- Re-running the import changes nothing (idempotent).
- Prototype DB is unchanged (read-only).

## Edge cases

- **Anonymous posts** (`user` null) → `user_id` null; expected and counted, not an error.
- **Post references a user not present** → `user_id` null + `unresolvedUser` tally; surfaced in report.
- **Orphan media reference** (`file` set but no image on disk) → `missingMedia` tally; decide
  fail vs. warn via `--allow-orphans`.
- **youtube-only / `file` null** posts → valid; skip media linkage.
- **Duplicate `hash`** across re-runs → upsert (no dupes); duplicate within source → report + skip.
- **Collation** — `hash` is `utf8mb4_bin` (case-sensitive); preserve case exactly when matching.
- **Timestamps** — copy verbatim; do not let `useCurrent()` overwrite historical `created_at`.

## Open Questions / Decisions Needed (before implementing)

1. **Source access:** live read-only MySQL connection to the prototype DB, or an offline
   dump/NDJSON export? (Affects Task 1.) — *Recommend read-only `legacy` connection.*
2. **`user` column semantics:** confirm against real rows whether prototype `trashposts.user`
   holds the user **hash**, **name**, or **email** — this is the join key for `user_id`.
3. **`metadata` vs `text`:** the prototype *migration* created `text` but the model exposes
   `metadata`; confirm the actual live prototype column name and pick the mapping accordingly.
4. **Orphan policy:** should a post whose media is missing on disk fail the import or just warn?
5. **Id preservation:** confirm we do **not** need to preserve original numeric ids (the 11/10-char
   `hash` is the stable public identifier and the join key) — recommended: don't preserve ids.
