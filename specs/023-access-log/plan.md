# Implementation Plan: HTTP Access Log

**Branch**: `023-access-log` | **Date**: 2026-08-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/023-access-log/spec.md`

## Summary

Record one durable row per application-handled HTTP request — addresses, path, method,
parameters, cookies, body, account, elapsed time, response code and size — in a new MySQL
`access_logs` table, written **synchronously before the response is delivered**, with a
name-based redaction list that keeps credentials and session identifiers out of the store, a
per-value size cap, an on/off env switch that defaults to on, and a daily self-scheduled
pruning command bounded by a 30-day retention window.

Technical approach: two purpose-built middleware plus one service, no new dependency.

- `RecordAccessLog` is **prepended to the global middleware stack** — the outermost frame —
  so it observes every request the application handles, including ones a guard rejects and
  ones that end in an unhandled exception (`Illuminate\Routing\Pipeline` renders those into a
  response while unwinding, so the after-phase still sees the real status). Its after-phase
  builds and writes the row, then returns the untouched response.
- `CaptureAccessLogActor` is appended to the `api` and `web` groups, ahead of
  `EnsureAccountEnabled`, and stashes the authenticated account id on the request as it
  *arrives*. This is what makes FR-008a/FR-008b true: reading `$request->user()` in the
  outer after-phase would attribute a sign-in to the account it created.
- `AccessLogService` owns the write and the prune; `AccessLogRedactor` owns redaction,
  per-value truncation and UTF-8 coercion; `AccessLogPruneCommand` (`access-log:prune`)
  wraps the prune for operators and for the scheduler entry in `routes/console.php`.

The whole write is wrapped in `try/catch (Throwable)` + `report()`, so a broken store
degrades to "answered but not recorded" and never to a visitor-facing failure.

## Technical Context

**Language/Version**: PHP 8.2+ (runtime image is PHP 8.3), Laravel 12

**Primary Dependencies**: None added. Laravel's own HTTP kernel, Eloquent, config, console
scheduler. Frontend is untouched by this feature.

**Storage**: MySQL 8.0 via Eloquent — one new table, `access_logs`. Tests run on
SQLite `:memory:` (`Tests\TestCase` hard-aborts on anything else), so the migration keeps the
MySQL/SQLite split the `comments` migration established.

**Testing**: PHPUnit via `scripts\test-backend.ps1` (container-local mirror; there is no local
PHP). Unit tests for the redactor and the service, feature tests through real HTTP requests
for the middleware pair, console tests for the prune command.

**Target Platform**: Linux containers — php-fpm behind the stack's nginx in production, `php
artisan serve` behind the dev nginx locally.

**Project Type**: Web application; this feature is **backend-only** (FR-030: no page, no
endpoint, no navigation entry).

**Performance Goals**: SC-002 — enabling recording adds ≤5 ms median and ≤15 ms p95 to a
request, measured against a real MySQL store, not estimated (FR-001b). SC-008/SC-011 — the
operator/viewer queries answer in <5 s over 1,000,000 rows, which is what the index set in
[data-model.md](./data-model.md) is sized for.

**Constraints**: The write is on the critical path (FR-001a), so it must be a single INSERT
with no extra round trips and no second connection handshake. It must be bounded (FR-025a):
an unreachable store degrades, it never holds a response open. Recording must not alter one
byte of any response (FR-026). Uploaded file bytes must never enter the row (FR-017), and
neither may a password or a session id in readable form (FR-013, SC-003).

**Scale/Scope**: One migration, one model, two middleware, one service, one support class,
one console command, one config file, one scheduler registration, one production compose
service (the scheduler runner), env documentation in three `.env.example` files, and their
mirrored tests. Sized for a 1,000,000-row history on a 1 vCPU / 960 MiB production box.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design — see below.*

| Principle | Verdict | Notes |
|---|---|---|
| **I. Minimal Dependencies (NON-NEGOTIABLE)** | ✅ PASS | Zero new Composer or npm packages. Storage is the existing MySQL/Eloquent, the switch is the existing config/env mechanism, the schedule is Laravel's own scheduler, the redactor is ~80 lines in-house. The new production `ladybug-scheduler` compose service reuses the **existing** `ladybug-php` image — a second container off one image, not a new dependency. |
| **II. Coding Conventions Adherence** | ✅ PASS | PSR-12, 4-space, `declare(strict_types=1)`, typed signatures, PHP functions under 30 lines (the row builder is decomposed into `AccessLogRedactor` calls precisely to stay under it), braces on single-line bodies, comments explain *why*. No debug output — the failure path uses `report()`, never `var_dump`/`error_log`. |
| **III. Browser-Native Navigation & Deep Linking** | ➖ N/A | No frontend surface and no route is added (FR-030). |
| **IV. Theme & Accessibility Respect** | ➖ N/A | No UI. |
| **V. Stable Meme Identifiers** | ➖ N/A | Access-log rows are never addressed from outside the process (FR-028/FR-030), so they need no public code. The `user_id` reference is an internal FK, not a URL component — no DB id is exposed anywhere, consistent with the project's standing rule. |
| **VI. Security & Input Validation** | ✅ PASS, and is the point of US2 | Every recorded value is untrusted input: the forwarded-for header is stored **verbatim as a claim** and never used for any decision (FR-002a); the direct peer comes from the connection (`REMOTE_ADDR`), never a header. Writes go through Eloquent (parameterized). Nothing is ever rendered, so there is no output-escaping context to get wrong — and nothing is exposed over HTTP at all. Secrets stay in env; three `.env.example` files document the new settings with defaults (FR-024). Redaction (FR-013–016) is the control that keeps the table from becoming a credential dump. |
| **VII. Test Coverage & Organization** | ✅ PASS | ≥90% line coverage, enforced by the existing CI Clover gate. Tests mirror source: `tests/Unit/Support/AccessLogRedactorTest.php`, `tests/Unit/Services/AccessLogServiceTest.php`, `tests/Feature/Http/Middleware/RecordAccessLogTest.php`, `tests/Feature/Console/Commands/AccessLogPruneCommandTest.php`. Edge cases are drawn straight from the spec's Edge Cases list — binary body, oversized value, missing table, deleted account, excluded path, forged forwarded-for. |
| **VIII. Responsive, Multi-Device Layout** | ➖ N/A | No UI. |

**Post-Phase-1 re-check**: PASS, unchanged. Phase 1 added no dependency, no route, and no
frontend file. Three design choices needed justification and are recorded in
[Complexity Tracking](#complexity-tracking) below.

## Project Structure

### Documentation (this feature)

```text
specs/023-access-log/
├── plan.md              # This file
├── spec.md              # Feature specification (input)
├── research.md          # Phase 0 output — the 13 design decisions
├── data-model.md        # Phase 1 output — access_logs table, columns, indexes
├── quickstart.md        # Phase 1 output — how to validate each success criterion
├── contracts/
│   ├── configuration.md # The env/config surface and its defaults (FR-020–024)
│   ├── redaction.md     # The single sensitive-name list (FR-013–016)
│   └── prune-command.md # `php artisan access-log:prune` + the schedule entry (FR-027)
└── tasks.md             # Phase 2 output — created by /speckit-tasks, NOT by this command
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── Console/Commands/
│   │   └── AccessLogPruneCommand.php        # NEW — `access-log:prune [--days=]`
│   ├── Http/Middleware/
│   │   ├── RecordAccessLog.php              # NEW — global, outermost; builds + writes the row
│   │   └── CaptureAccessLogActor.php        # NEW — api/web group; stashes the arrival-time account
│   ├── Models/
│   │   └── AccessLog.php                    # NEW — write-once model, JSON casts, no $fillable
│   ├── Services/
│   │   └── AccessLogService.php             # NEW — record() and prune(); the only writer
│   └── Support/
│       └── AccessLogRedactor.php            # NEW — sensitive-name redaction, per-value
│                                            #       truncation, UTF-8 coercion
├── bootstrap/app.php                        # EDIT — prepend RecordAccessLog (global);
│                                            #        append CaptureAccessLogActor (api + web)
├── config/
│   ├── access_log.php                       # NEW — enabled, excluded_paths, retention,
│   │                                        #       value_limit, sensitive lists, prune schedule
│   └── database.php                         # EDIT — PDO::ATTR_TIMEOUT on the mysql connection
├── database/migrations/
│   └── 2026_08_14_000000_create_access_logs_table.php   # NEW
├── routes/console.php                       # EDIT — daily Schedule::command('access-log:prune')
├── .env.example                             # EDIT — the new settings + the FR-032 scope note
└── tests/
    ├── Feature/
    │   ├── Console/Commands/AccessLogPruneCommandTest.php   # NEW
    │   └── Http/Middleware/
    │       ├── RecordAccessLogTest.php                      # NEW
    │       └── CaptureAccessLogActorTest.php                # NEW
    └── Unit/
        ├── Services/AccessLogServiceTest.php                # NEW
        └── Support/AccessLogRedactorTest.php                # NEW

deploy/
├── backend.env.example                      # EDIT — production values for the new settings
└── docker-compose.prod.yml                  # EDIT — NEW `ladybug-scheduler` service
                                             #        (`php artisan schedule:work`, same image)

docs/DEPLOYMENT.md                           # EDIT — the scheduler service, retention, and the
                                             #        "media/static traffic is out of scope" note

frontend/                                    # UNTOUCHED — no file changes (FR-030)
```

**Structure Decision**: The existing decoupled two-app layout is kept and only `backend/`
changes. Placement follows the conventions already in force in this repo: request-lifecycle
behaviour lives in `app/Http/Middleware/` (alongside `EnsureAccountEnabled`,
`CollectStaleSessions`), transaction/query logic in `app/Services/` (alongside
`ModerationService`, `PasswordService`), stateless helpers as single-purpose classes of
static methods in `app/Support/` (alongside `PasswordPolicy`, `SessionGarbageCollector`),
and operator entry points in `app/Console/Commands/` (alongside `MediaRepublishCommand`).
Tests mirror those paths exactly, per Principle VII.

## Complexity Tracking

> Three Phase-1 choices add structure beyond the obvious one-class solution. Each is recorded
> with the simpler alternative that was rejected and why.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| **Two middleware classes** (`RecordAccessLog` + `CaptureAccessLogActor`) instead of one | The recorder must be the *outermost* frame to see guard rejections and rendered exceptions (FR-001), but at that depth the session has not started, so no account is resolvable on the way in. The account must be the one present **as the request arrived** (FR-008a), and reading it on the way out would name the account a sign-in just created — exactly what FR-008b forbids. A tiny inner middleware stashes the arrival-time id on the request; the outer one reads the stash. | A single outer middleware reading `$request->user()` in its after-phase attributes every sign-in and registration to the resulting account, contradicting the recorded clarification and SC-003's reading of the history. A single *inner* middleware (group-appended) never runs for a request that `EnsureAccountEnabled`, CSRF, or the throttler rejected, losing FR-001's guarantee that guard-rejected requests are recorded. |
| **A new `ladybug-scheduler` service in the production compose stack** | FR-027a requires the prune to run automatically "on the application's own schedule … without host-level scheduling being configured separately". Nothing currently drives Laravel's scheduler: `ladybug-php` runs php-fpm as PID 1 and production sets `QUEUE_CONNECTION=sync` precisely because there is no worker. Without a process running `schedule:work`, the scheduler entry is dead code and the history is unbounded on an unattended deployment. | Documenting a host crontab is explicitly what FR-027a rules out. A lottery sweep on request (the `CollectStaleSessions` pattern this repo already uses) was considered and rejected: it puts a mass `DELETE` on a visitor's critical path, which fights FR-001b's latency budget, and it cannot honour "daily, at a configurable frequency". The new service reuses the existing image and adds ~30 MiB idle on the 960 MiB box. |
| **A connect timeout added to the shared `mysql` connection** (`PDO::ATTR_TIMEOUT`, new `DB_CONNECT_TIMEOUT`, default 2s) | FR-025a requires the write to be bounded so an unreachable store degrades to "answered but not recorded" rather than hanging the response. PDO's connect timeout is the only bound reachable from PHP, and it is a per-connection option — it cannot be scoped to one statement. | A dedicated second `access_log` connection would scope the timeout cleanly but opens a **second TCP + auth handshake on every logged request**, which is a direct hit to the SC-002 budget on the critical path — a worse trade than a bound the rest of the app also benefits from (today it is unbounded). The honest limitation, that this bounds *connect* and not a mid-statement stall, is written up in research D12 rather than papered over. |
