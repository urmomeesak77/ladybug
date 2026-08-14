# Tasks: HTTP Access Log

**Input**: Design documents from `/specs/023-access-log/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Test tasks ARE included. Constitution Principle VII makes them mandatory (≥90% line
coverage, enforced by the CI Clover gate), and [quickstart.md](./quickstart.md) §1 names the five
test files this feature ships. They are written **before** the code they cover.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested and
delivered independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: The user story the task belongs to (US1–US4)
- Every task names an exact file path

## Path Conventions

Two-app layout. This feature is **backend-only** — `frontend/` is not touched (FR-030).

- Backend source: `backend/app/`, `backend/config/`, `backend/database/`, `backend/routes/`
- Backend tests: `backend/tests/` mirroring `backend/app/` (Principle VII)
- Deployment: `deploy/`, runbook `docs/DEPLOYMENT.md`

**Toolchain reminder**: there is no local PHP. Run the suite with `scripts\test-backend.ps1`
(container-local mirror, 0:43 vs 5:04), and artisan through
`docker compose exec backend php artisan …`. Backend PHP edits need
`docker compose restart backend` (dev opcache runs `validate_timestamps=0`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The configuration surface every story reads, and the connection bound the write
depends on.

- [X] T001 Create `backend/config/access_log.php` returning `enabled` (`env('ACCESS_LOG_ENABLED', true)`), `excluded_paths` (comma-split of `env('ACCESS_LOG_EXCLUDED_PATHS', 'api/health,up')`), `retention_days` (`max(1, (int) env('ACCESS_LOG_RETENTION_DAYS', 30))`), `value_limit` (`(int) env('ACCESS_LOG_VALUE_LIMIT', 65536)`), `prune_enabled` (`env('ACCESS_LOG_PRUNE_ENABLED', true)`), `prune_cron` (`env('ACCESS_LOG_PRUNE_CRON', '0 3 * * *')`), plus empty-for-now `sensitive` / `sensitive_prefixes` arrays filled in T017 — keys and defaults exactly per `specs/023-access-log/contracts/configuration.md`
- [X] T002 [P] Add `PDO::ATTR_TIMEOUT => (int) env('DB_CONNECT_TIMEOUT', 2)` to the `mysql` connection's `options` in `backend/config/database.php`, placed **outside** the existing `array_filter(...)` call (that value is `extension_loaded('pdo_mysql') ? array_filter([...]) : []`, and `array_filter` without a callback would silently drop an explicit `DB_CONNECT_TIMEOUT=0` — research D12). Add a `why` comment pointing at FR-025a and D12's honest limit: it bounds connect, not a mid-statement stall

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The table and the model every story writes to or deletes from.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 Create migration `backend/database/migrations/2026_08_14_000000_create_access_logs_table.php` with the exact column set from `specs/023-access-log/data-model.md` (`id`, `created_at`, `remote_addr` varchar(45), `forwarded_for` varchar(255) default `''`, `method` varchar(10), `path` varchar(2048), `status` smallint unsigned, `duration_us` bigint unsigned, `response_bytes` nullable, `user_id` nullable FK → `users.id` `nullOnDelete`, `user_agent` varchar(1024) nullable, `referer` varchar(2048) nullable, `query`/`input`/`cookies`/`files` json nullable, `body` longtext nullable), **no `updated_at`**, and the six indexes — branching on `Schema::getConnection()->getDriverName() === 'mysql'` to issue raw prefix indexes for `path(191)` and `forwarded_for(64)` and plain `$table->index([...])` on SQLite, the same split `2026_07_23_000000_create_comments_table.php` already uses
- [X] T004 [P] Create `backend/app/Models/AccessLog.php` — `$table = 'access_logs'`, `public $timestamps = false` with `created_at` assigned explicitly, `array` casts on `query`/`input`/`cookies`/`files`, **no `$fillable`** (the service assigns properties directly, research D9), and a `user()` `belongsTo` relation declared for a future viewer (FR-031) that nothing in this feature loads. Because nothing loads it, it is uncovered code the Principle VII Clover gate (T040) still counts — T007 carries one assertion over it so the gate is not paying for an untested method. **Done differently**: the coverage landed in `backend/tests/Unit/Models/AccessLogTest.php`, written first per the project's TDD convention — it covers the table's column set, the six index definitions, `$timestamps = false` preserving an explicitly assigned arrival time, the empty `$fillable`, the JSON casts, the `user()` relation and the FR-029 `nullOnDelete` behaviour. T007 may keep its own FR-029/relation assertions or drop them as duplicates

**Checkpoint**: `access_logs` exists and is writable through Eloquent — user stories can begin.

---

## Phase 3: User Story 1 - Operator reviews the site's request history (Priority: P1) 🎯 MVP

**Goal**: One durable row per application-handled HTTP request, written synchronously before the
response is delivered, carrying both address fields, path, method, parameters, cookies, body,
arrival-time account, elapsed time, response code and size.

**Independent Test**: Drive a mixed run against the dev stack — guest feed load, signed-in
upload, a nonexistent meme, a deliberate 500 — then `SELECT` from `access_logs` and confirm each
request is present exactly once with a non-empty `remote_addr`, `path`, `method`, `created_at`,
`status` and `duration_us`, and with `forwarded_for` verbatim (empty when the request carried no
header). Quickstart §2.

### Tests for User Story 1 ⚠️

> Write these FIRST and confirm they FAIL before implementing T009–T013.

- [X] T005 [P] [US1] Create `backend/tests/Feature/Http/Middleware/RecordAccessLogTest.php` — exactly one row per request across 200/302/404/500 (route a deliberate `Throwable` to prove the after-phase sees the rendered 500, research D1), a guard-rejected request (a `403`/`401` from an inner middleware) still recorded, both address fields populated independently with a forged `X-Forwarded-For` landing in `forwarded_for` while `remote_addr` stays the real peer (FR-002a), `query`/`input`/`cookies`/`files` shapes, `duration_us > 0`, `response_bytes` (including the `NULL` case for a response with no content string), `user_agent`/`referer`, and the response returned byte-identical (FR-026). Add SC-005b: a POST whose body exceeds `post_max_size` is refused by `ValidatePostSize` — which sits *inside* the prepended recorder (D1) — and must still produce exactly one row carrying that rejection's status, path and method, with `input` and `files` empty because PHP discarded the body before anything could parse it
- [X] T006 [P] [US1] Create `backend/tests/Feature/Http/Middleware/CaptureAccessLogActorTest.php` — a signed-in request records that account, `POST /api/login` and `POST /api/register` record `user_id` NULL even on success while the submitted `email` is recorded in full (FR-008a/FR-008b), `POST /api/logout` records the account that was authenticated on arrival, and a disabled account's `401` from `EnsureAccountEnabled` is still attributed to that account (research D2). Use real cookie-carrying requests, not `actingAs()` — the middleware ordering this asserts is invisible to `actingAs()`
- [X] T007 [P] [US1] Create `backend/tests/Unit/Services/AccessLogServiceTest.php` covering `record()` — a row is inserted with the values handed in, and a store failure (drop/rename the table, or force a `QueryException`) is swallowed and passed to `report()` while the caller sees no exception (FR-025, research D11). Also assert **FR-029** here, which otherwise has no automated coverage at all: hard-delete a user that owns entries and confirm its rows survive with `user_id` now `NULL` — this is what proves the `nullOnDelete` FK is actually enforced under the suite's SQLite connection rather than merely declared in the migration. One assertion over the `user()` relation belongs here too (T004): load a row's user and confirm it resolves, so the FR-031 forward-compat method is covered rather than dragging the Clover gate down
- [X] T008 [P] [US1] Create `backend/tests/Unit/Support/AccessLogRedactorTest.php` covering the shaping half — `allFiles()` flattened to `{field, name, mime, size}` with no bytes (FR-017), invalid UTF-8 coerced so `json_encode` cannot fail (FR-019), per-value truncation at `value_limit` cut on a character boundary with the ` …[truncated]` suffix, a neighbouring small value left whole and **unmarked** (SC-005a), and the column-width caps on `path`/`forwarded_for`/`user_agent`/`referer` also marked rather than silent. Pin the marker's arithmetic in both directions, because the two caps budget it oppositely (data-model.md rules 3–4): a value-limit cut lands at `value_limit + 15` bytes (the 15-byte marker appended **beyond** the cap), while a column-width cut lands at **exactly** the column width (value trimmed to `width − 15` first). Assert the second at each of the four column widths — `'strict' => true` in `config/database.php` means an overshoot there rejects the whole row and loses the entry to a swallowed `QueryException`

### Implementation for User Story 1

- [X] T009 [US1] Create `backend/app/Support/AccessLogRedactor.php` as a class of `static` methods (conventions v1.3) with the shaping half: UTF-8 coercion via `mb_convert_encoding($v, 'UTF-8', 'UTF-8')`, per-value truncation at `config('access_log.value_limit')` on a character boundary with the ` …[truncated]` marker held as **one** private constant (15 bytes: space, U+2026, `[truncated]`) so no call site can spell it differently, a column-width capper reused for `path`/`forwarded_for`/`user_agent`/`referer` that reserves the marker's length **inside** the width rather than appending past it — take it from the constant's `strlen`, never a literal 15 (data-model.md rule 4 — appending past a `varchar` under `'strict' => true` rejects the row and loses the entry), and `files()` flattening `$request->allFiles()` to `{field, name, mime, size}` without ever reading the bytes. Keep every method under 30 lines (Principle II); the redaction pass lands in T018
- [X] T010 [US1] Create `backend/app/Services/AccessLogService.php` with `record(Request $request, Response $response, float $startedAt, ?int $userId): void` — build the row, assign properties on a fresh `AccessLog` (no mass assignment), `save()`, everything wrapped in `try { … } catch (Throwable $e) { report($e); }` so a broken store degrades to "answered but not recorded" (FR-025, D11). Exactly one INSERT, no extra round trip, no `users` lookup (SC-002). **Done differently — read with T012**: this task's signature and T012's prose disagree about which file selects the columns (T010 hands the service a `Request`/`Response`; T012 has the middleware read them). The signature won, because it is the more concrete contract and because it makes the row-building unit-testable without an HTTP round trip. So `AccessLogService::build()` owns every column selection — including the FR-005a/D5 body rule — and `RecordAccessLog` owns only the timer, the actor read, the call and the untouched return. US2's T019 should therefore be read against `AccessLogService::rawBody()`, which is still the single place that rule is stated
- [X] T011 [P] [US1] Create `backend/app/Http/Middleware/CaptureAccessLogActor.php` — sets `$request->attributes->set('access_log.user_id', $request->user()?->getAuthIdentifier())` on the way in and returns `$next($request)` untouched; a docblock records *why* it exists (the outer frame runs before the session starts, and reading the user on the way out would attribute a sign-in to the account it just created — FR-008b)
- [X] T012 [US1] Create `backend/app/Http/Middleware/RecordAccessLog.php` — captures `microtime(true)` and the arrival `created_at` in the before-phase (D3: never `LARAVEL_START`, which is process-global and wrong under PHPUnit), calls `$next($request)`, then in the after-phase reads `remote_addr` from `$request->server->get('REMOTE_ADDR')` (never `$request->ip()`, which `trustProxies(at: '*')` makes forgeable — D4), `forwarded_for` from the raw `X-Forwarded-For` header defaulting to `''`, and selects the body columns per FR-005a/D5 (`query` ← `$request->query()`, `input` ← `isJson() ? json()->all() : post()`, `body` ← `getContent()` **only** when the content type is neither form-encoded, multipart nor JSON, `files` ← the redactor's file shaping). Fill the remaining columns data-model.md requires and T005 asserts, none of which are implied by the two above: `method`, `path` (Laravel's `path()`, query string excluded), `status` ← `$response->getStatusCode()`, `duration_us` ← the elapsed microseconds as an integer, `user_agent`/`referer` from their headers, and `response_bytes` ← `Content-Length` when present, else `strlen()` of the content, else **`NULL`** — a `StreamedResponse` or `BinaryFileResponse` has no content string (`getContent()` returns `false`), and `NULL` means "not measurable" where `0` would be a lie. Never invoke a streamed response's callback to measure it. Hands them to `AccessLogService::record()` and returns the response **unmodified** (FR-026). **Done differently**: the column selection this task describes lives in `AccessLogService::build()` — see T010's note for why — and `RecordAccessLog` is the thin outer frame that captures the entry microtime, reads the actor attribute and returns the response untouched. Two smaller departures inside that build: `created_at` is derived from the **same** `microtime(true)` as the duration rather than captured a second time, so the arrival time and the elapsed time can never disagree; and `response_bytes` prefers a declared `Content-Length` only when it is numeric, so a malformed header falls through to measuring rather than storing garbage
- [X] T013 [US1] Register both middleware in `backend/bootstrap/app.php` — `$middleware->prepend(RecordAccessLog::class)` so it is the outermost global frame (D1), and `$middleware->appendToGroup('api', CaptureAccessLogActor::class)` / `appendToGroup('web', …)` (D2). The `api` line must sit **above the existing `EnsureAccountEnabled` append** (currently `bootstrap/app.php:51`), since append order is group order, so a disabled account's `401` is still attributed to that account. The `web` line has **no such anchor** — `EnsureAccountEnabled` is appended to `api` only — so there it just needs to be appended, which already places it after Laravel's stock `StartSession`. Add the `why` comments in the style of the surrounding registrations
- [X] T014 [US1] Apply the migration to the dev database and walk quickstart §2: `docker compose exec backend php artisan migrate:status` then `migrate`, restart the backend, drive the mixed run, and confirm from SQL that every request produced exactly one row with both address fields distinct and a forged `X-Forwarded-For` never displacing `remote_addr`. **Result (2026-08-14)**: migration already at batch 13; five requests (feed 200, unknown meme 404, `api/health` 200, bad sign-in 401, feed with a forged header 200) produced exactly five rows, each with a non-empty `remote_addr`/`path`/`method`/`created_at`/`status`/`duration_us`. Both address fields stayed independent: `remote_addr` was the nginx container (`172.18.0.4`) on every row, while the forged request recorded `forwarded_for = '203.0.113.9, 172.18.0.1'` — the forgery is kept verbatim as a claim, appended to by the real proxy, and never displaces the observed peer (FR-002a). The `api/login` row holds `input` as parsed fields with **no** raw `body` beside them (D5) and, as the checkpoint warns, the password still in readable form until US2. One case the dev stack cannot show: nginx always sets `X-Forwarded-For`, so the "header absent → empty string" path is only exercisable in the suite (`RecordAccessLogTest`), not through `localhost:8000`. `api/health` was recorded, as expected before T022 adds the exclusion

**Checkpoint**: US1 is complete — the history exists and answers SC-001. Secrets are *not* yet
redacted, so do not point this at production traffic until US2 lands.

---

## Phase 4: User Story 2 - Secrets never come to rest in the history (Priority: P2)

**Goal**: The single name-based sensitive list, applied identically to `query`, `input` and
`cookies` at every nesting depth, so no password, session id, CSRF token or one-time link token
is ever stored in readable form.

**Independent Test**: Run a full authentication journey (register, verify, sign in, change
password, request recovery, reset, sign out), then search the entire history for the plaintext
passwords and for the browser's session cookie value — both return zero — while those rows remain
present with paths and response codes intact. Quickstart §4.

### Tests for User Story 2 ⚠️

- [X] T015 [P] [US2] Extend `backend/tests/Unit/Support/AccessLogRedactorTest.php` with the redaction half — case-insensitive exact match against `sensitive`, prefix match against `sensitive_prefixes` (`remember_web_…`), recursion into nested arrays (`user[password]`, a nested JSON document), the key surviving with the literal `[redacted]` rather than being removed (FR-014), non-listed keys recorded in full (FR-016), and the fixed **redact → coerce → truncate** order proven by a 100 KB password producing a short placeholder and never a 64 KB partial secret. **Added beyond the brief**: a `DataProvider` case per entry of the default `sensitive` list, spelled out in the test rather than read back from `config('access_log.sensitive')` — a name silently dropped from the config file now fails a test instead of quietly widening what comes to rest; a matched key holding a *structure* is withheld whole (recursing into it would record `password[first]`, which is still the password); a prefix matches only at the start of a name; and the three per-deployment cookie names are asserted under **renamed** values, since a redaction rule that fails open is the failure mode that matters
- [X] T016 [P] [US2] Extend `backend/tests/Feature/Http/Middleware/RecordAccessLogTest.php` with end-to-end secret assertions — a real `POST /api/login` row holds `email` in full and `password` as `[redacted]`; a signed-in request's `cookies` map holds `[redacted]` for the resolved `config('session.cookie')`, `XSRF-TOKEN` and `config('remember.cookie')`; a signed verification link's `signature` query parameter is `[redacted]`; and a `POST /api/login` row carries **no** raw `body` column value (D5 — a raw body next to the parsed map would defeat the whole story). **Note on the cookie case**: the extra cookies are attached with `withCookie`, not `withUnencryptedCookie`. The `api` group runs `EncryptCookies`, which nulls any cookie it cannot decrypt — so a test-injected plaintext cookie records as `NULL` and proves nothing about the FR-016 "kept in full" half. Sent encrypted, they are decrypted **in place** before the recorder's after-phase reads the bag, which is also the honest shape: by the time the row is built, a real browser's session cookie is sitting there in plaintext. That is exactly what the RED run showed before T018 landed — a live 40-char session id recorded verbatim

### Implementation for User Story 2

- [X] T017 [US2] Fill the `sensitive` and `sensitive_prefixes` arrays in `backend/config/access_log.php` with the full default list from `specs/023-access-log/contracts/redaction.md` (`password`, `password_confirmation`, `current_password`, `new_password`, `token`, `_token`, `remember_token`, `api_token`, `access_token`, `refresh_token`, `id_token`, `secret`, `client_secret`, `authorization`, `signature`, `code`, `state`, `credential`; prefixes `['remember_web_']`), each entry keeping its short `why` comment
- [X] T018 [US2] Add the redaction pass to `backend/app/Support/AccessLogRedactor.php` — recurse arrays by key, lower-case the key for matching, replace matched values with the literal `[redacted]`, and resolve the three per-deployment cookie names from config at call time (`config('session.cookie')`, `XSRF-TOKEN`, `config('remember.cookie')`) rather than hard-coding them, since `config/remember.php` derives its name from `APP_NAME` and a hard-coded literal would fail open. Wire it as the **first** step of the pipeline in the redact → coerce → truncate order, applied uniformly to `query`, `input` and `cookies` (FR-015). **Shape**: `map()` is now literally `shape(redact($values))`, so the order is one expression that cannot drift, and the uniformity across the three maps is structural — `map()` is the only entry point the service uses for all three. The two lists are resolved **once per map** in `redact()` and carried down through `withhold()` rather than re-read from config at each leaf: still per-call (so a renamed deployment matches), without paying for it on every key
- [X] T019 [US2] Confirm the D5 body rule holds in `backend/app/Http/Middleware/RecordAccessLog.php` — the raw `body` column is populated **only** for content types that are neither form-encoded, multipart nor JSON, so a form or JSON credential is fully represented by the redacted parsed map and never by an opaque string the name-based redactor cannot reach; fix the selection if T016 exposes a gap. **Result**: no gap, and no code change. Per T010's note the rule lives in `AccessLogService::rawBody()`, not the middleware; T016's `test_a_sign_in_stores_no_raw_body_beside_the_redacted_map` passed on the RED run — i.e. before the redaction pass existed — which is the right outcome, since D5 was already satisfied by US1. T020 confirmed it against MySQL: `body` is `NULL` on every row of the authentication journey
- [X] T020 [US2] Run the US2 hard gate from quickstart §4 against the dev stack — the full authentication journey through the SPA with a distinctive password, then the `LIKE '%<password>%'` and session-cookie searches across `query`/`input`/`body`/`cookies` returning **0**, with the surrounding rows still carrying their paths, status codes, and the submitted `email` in full (FR-008b). **Result (2026-08-14)**: the journey was driven against `localhost:8000` with curl carrying a real cookie jar and the SPA's `Origin`/`X-XSRF-TOKEN` (register → login → change password → forgot → reset-link check → logout) rather than clicked through the SPA — same requests, same recorded rows, and it pins the reset `token` case the SPA cannot reach without a live mailbox. All three searches returned **0**: the password (`LIKE` across `query`/`input`/`body`/`cookies`), the submitted reset token, and the browser's session cookie value. All six rows present with their paths and statuses; `email` in full on every row that submitted one; `password`, `current_password` and `token` all `[redacted]`; `online-trash-session` and `XSRF-TOKEN` `[redacted]`; `body` `NULL` throughout (D5). One reading that looks wrong and is not: the `api/login` row of that run carries `user_id = 47`, because registering signs the account in, so the login request genuinely **arrived** authenticated — FR-008a, not a violation of FR-008b. A second sign-in from a clean cookie jar recorded `user_id = NULL` with the address in full, which is the case FR-008b actually describes

**Checkpoint**: US1 and US2 both work — the history is now safe to keep.

---

## Phase 5: User Story 3 - Operator can switch logging off without a code change (Priority: P2)

**Goal**: One configuration switch, defaulting to on when absent; off writes nothing, erases
nothing, and leaves every response byte-identical. Plus the excluded-paths list that keeps health
probes out of the history.

**Independent Test**: With `ACCESS_LOG_ENABLED` absent entirely, make a request and confirm it was
recorded. Set it to `false`, restart, repeat, and confirm zero new rows, all previously recorded
rows still present, and normal responses. Turn it back on and confirm recording resumes.
Quickstart §5.

### Tests for User Story 3 ⚠️

- [ ] T021 [P] [US3] Extend `backend/tests/Feature/Http/Middleware/RecordAccessLogTest.php` with the switch and exclusion cases — the config key absent entirely still records (US3 scenario 1, default-on), `access_log.enabled = false` writes no new row while previously written rows remain (FR-021, US3 scenario 3) and the response is unchanged, a path matching `access_log.excluded_paths` writes no row while a neighbouring path does, and the `$request->is()` wildcard form (`admin/*`) matches as documented

### Implementation for User Story 3

- [ ] T022 [US3] Add the guards to `backend/app/Http/Middleware/RecordAccessLog.php` — when `config('access_log.enabled')` is false, or `$request->is(...config('access_log.excluded_paths'))` matches, return `$next($request)` having touched neither request nor response on either phase, so FR-021's "byte-for-byte what it would be with the feature absent" holds by construction
- [ ] T023 [P] [US3] Document the new settings in `backend/.env.example` — `ACCESS_LOG_ENABLED`, `ACCESS_LOG_EXCLUDED_PATHS`, `ACCESS_LOG_RETENTION_DAYS`, `ACCESS_LOG_VALUE_LIMIT`, `ACCESS_LOG_PRUNE_ENABLED`, `ACCESS_LOG_PRUNE_CRON` and `DB_CONNECT_TIMEOUT`, each with its default stated inline (FR-024), plus the FR-018b sizing consequence (worst-case entry = value count × limit) and the FR-032 scope-boundary note verbatim from `contracts/configuration.md`
- [ ] T024 [P] [US3] Add the same block with production-appropriate values to `deploy/backend.env.example`, including the FR-032 scope note — an operator reads only one of these files, so it cannot be documented in the dev template alone
- [ ] T025 [US3] Walk quickstart §5 against the dev stack — remove the key entirely and restart (records), set `ACCESS_LOG_ENABLED=false` and restart (zero new rows, prior rows intact, responses unchanged), set it back and restart (recording resumes), and confirm `api/health` and `up` produced zero rows

**Checkpoint**: US1–US3 complete. The feature is shippable; the history is unbounded until US4.

---

## Phase 6: User Story 4 - The history stays bounded (Priority: P3)

**Goal**: One pruning routine, chunked and resumable, invocable by an operator and registered on
the application's own daily schedule — with a process in production that actually drives that
schedule.

**Independent Test**: Seed rows on both sides of the retention window, run the routine, confirm
only the older rows are gone, re-run and confirm nothing changes, and confirm `schedule:list`
shows `access-log:prune` at `0 3 * * *` on a deployment where nobody configured it. Quickstart §8.

### Tests for User Story 4 ⚠️

- [ ] T026 [P] [US4] Create `backend/tests/Feature/Console/Commands/AccessLogPruneCommandTest.php` — seeded rows on both sides of the window with only the older ones deleted, a second run deleting 0 and still exiting 0 (SC-007 idempotence), `--days=N` honouring the override, a changed `access_log.retention_days` honoured with no code change (US4 scenario 3), the reported output line, and `schedule:list` showing the entry with its cron expression (US4 scenario 4)
- [ ] T027 [P] [US4] Extend `backend/tests/Unit/Services/AccessLogServiceTest.php` with `prune()` — chunked deletion looping past a single 1000-row pass, the total returned, a cutoff computed **once per invocation** so a long run cannot chase `now()` forward, the `max(1, …)` clamp on a retention window below 1, and rows exactly on the boundary left alone (strictly-older comparison). Add the **FR-027c** case, which T028 currently only claims structurally: interrupt a run partway (seed more than one chunk's worth of expired rows and abort after the first pass) and assert the history is left consistent — the deleted chunk is gone, the untouched old rows are still there and still older than the cutoff, no newer row was harmed — then run again and confirm it finishes the work with no repair step and no persisted cursor

### Implementation for User Story 4

- [ ] T028 [US4] Add `prune(int $days): int` to `backend/app/Services/AccessLogService.php` — compute the cutoff once as `now()->subDays($days)`, then delete in passes of 1000 (`->where('created_at', '<', $cutoff)->limit(1000)->delete()`) looping until a pass deletes nothing, returning the total. Each pass commits on its own so an interrupted run has simply done less (FR-027c) and concurrent runs are safe (no lock, no lease)
- [ ] T029 [US4] Create `backend/app/Console/Commands/AccessLogPruneCommand.php` with signature `access-log:prune {--days= : Override the configured retention window}`, defaulting to `config('access_log.retention_days')`, calling `AccessLogService::prune()` — the same method the schedule calls, so FR-027b's "no second deletion rule" is structural — printing `Deleted N access log entries older than D days.` and exiting `0` including when nothing was deleted
- [ ] T030 [US4] Register the schedule in `backend/routes/console.php` — `Schedule::command('access-log:prune')->cron(config('access_log.prune_cron'))->withoutOverlapping()` guarded by `config('access_log.prune_enabled')`, with a `why` comment for the 03:00 default (it keeps the daily delete off the `docs/DEPLOYMENT.md` §6 backup window on a 1 vCPU box)
- [ ] T031 [US4] Add the `ladybug-scheduler` service to `deploy/docker-compose.prod.yml` per `contracts/prune-command.md` — the **existing** `ghcr.io/urmomeesak77/ladybug-php:${LADYBUG_TAG:-latest}` image with `command: ["php", "artisan", "schedule:work"]`, `restart: unless-stopped`, the same `backend.env` and `data/storage` mounts as `ladybug-php`, `depends_on` mysql healthy, and **not** attached to the `edge` network. No scheduler is added to `docker-compose.yml` or `docker-compose.e2e.yml`
- [ ] T032 [US4] Update `docs/DEPLOYMENT.md` — the new `ladybug-scheduler` service and how to verify it is up after a deploy, the 30-day retention window and how to change it, the manual `access-log:prune` invocation, the FR-018b storage-sizing consequence, and the FR-032 note that nginx-answered media and static traffic never appears in the history
- [ ] T033 [US4] Walk quickstart §8 against the dev stack — backdate seeded rows in SQL on both sides of the window, run `access-log:prune` and `--days=7`, confirm the 100%/100% split and that a second run changes nothing, confirm `schedule:list` shows the entry, and confirm requests are served **and recorded** normally while a run is in flight (US4 scenario 5)

**Checkpoint**: All four user stories are independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: The success criteria that must be measured rather than reasoned about, and the
project's binding gates.

- [ ] T034 [P] Measure SC-002/SC-002a against **real MySQL** per quickstart §3 (FR-001b makes this non-optional) — run ~200 mixed requests with `ACCESS_LOG_ENABLED=false`, restart, repeat with it true, and confirm median +≤5 ms and p95 +≤15 ms; if the deltas exceed budget, re-examine the index set in `data-model.md` first, not the redactor. Record the measured numbers in this task's completion note
- [ ] T035 [P] Verify SC-005/SC-005b/SC-005a per quickstart §6 against the dev stack — the criterion no other task claims. Upload a video at the site's real ceiling (`CreatePostRequest` caps `video` at `max:20480`, i.e. 20 MiB, and both php.ini set `post_max_size=26M`) and confirm exactly one row whose `files` holds only `{field, name, mime, size}`, no file bytes anywhere, and a total row size under 64 KB (SC-005). Then push a file **past** that ceiling and confirm the 413 still produced one row with empty `input`/`files` (SC-005b). Then send one oversized text value beside a small one and confirm the asymmetry SC-005a needs — the big one cut and marked, the small one whole and unmarked. Finish with the FR-019 binary case: post raw bytes under an unparseable content type and confirm the row is written and readable rather than lost
- [ ] T036 [P] Verify SC-006 per quickstart §7 — `docker compose stop mysql`, re-run the scripted set, confirm every request receives its normal response and status while each failure is reported once into `storage/logs/laravel.log`, and confirm the added latency is bounded by `DB_CONNECT_TIMEOUT`. Note the acknowledged limit: this exercises connect, not a mid-statement stall (research D12)
- [ ] T037 [P] Verify SC-008/SC-011 per quickstart §9 against ~1,000,000 seeded rows — each of the six operator/viewer queries under 5 s, with `EXPLAIN` confirming the intended index is chosen and no filesort appears, and `SHOW INDEX FROM access_logs` confirming the six indexes with `path(191)` and `forwarded_for(64)` prefixes (the SQLite test suite cannot exercise this half)
- [ ] T038 [P] Verify SC-009/SC-010 per quickstart §10 — `git diff --stat master -- backend/routes/` shows no route change, no response body or header anywhere exposes access-log content, fetching 50 files under `/storage/` plus the SPA assets yields zero rows, and `api/health`/`up` yield zero rows
- [ ] T039 [P] Verify FR-029 per quickstart §11 — hard-delete an account that has entries via `DELETE /api/admin/users/{hash}` and confirm its rows remain with `user_id` now NULL rather than being deleted or blocking the deletion. This is the MySQL half of what T007 asserts on SQLite; both are wanted, since the FK is only enforced where the connection enforces it
- [ ] T040 Run the binding CI gates locally — `docker compose run --rm backend vendor/bin/pint --test` and `scripts\test-backend.ps1` with coverage, confirming ≥90% line coverage on the new files (Principle VII) and that no new Composer or npm dependency was added (Principle I)
- [ ] T041 Confirm the constitution's manual-verification gate per quickstart §11's closing section — boot `docker-compose.e2e.yml` and run the existing Playwright suite, observing the site behaves identically with recording on and off (this feature adds no frontend file and changes no response — FR-026)
- [ ] T042 Dispatch the `commit-quality-verifier` agent over the staged diff and commit only on PASS

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: needs T001 (the model and migration read nothing from config, but the service written next does) — **blocks all user stories**
- **US1 (Phase 3)**: depends on Phase 2. No dependency on any other story
- **US2 (Phase 4)**: depends on Phase 2. Edits files US1 created (`AccessLogRedactor`, `RecordAccessLog`, `RecordAccessLogTest`), so in practice it follows US1 — it is independently *testable* but not independently *authorable*
- **US3 (Phase 5)**: depends on Phase 2 and on `RecordAccessLog` existing (T012). Independent of US2 and US4
- **US4 (Phase 6)**: depends on Phase 2 only. **Genuinely parallel to US1–US3** — `prune()`, the command, the schedule entry and the compose service share no file with the capture path except `AccessLogService`, which US4 extends rather than rewrites
- **Polish (Phase 7)**: depends on all four stories

### Within Each User Story

- Tests are written first and confirmed failing, then implementation (project TDD convention)
- Support/shaping helpers before the service, the service before the middleware, middleware before its registration
- Automated tests before the manual quickstart walk that closes the story

### Parallel Opportunities

- **Phase 1**: T002 is `[P]` — a different file from T001
- **Phase 2**: T004 is `[P]` — the model does not depend on the migration file being written
- **US1**: T005–T008 are all `[P]` (four separate test files). T011 is `[P]` against T009/T010 — a different file with no shared symbol
- **US2**: T015 and T016 are `[P]` (different test files)
- **US3**: T023 and T024 are `[P]` (two different env templates)
- **US4**: T026 and T027 are `[P]` (different test files)
- **Phase 7**: T034–T039 are all `[P]` — six independent verification runs against different criteria
- **Across stories**: once Phase 2 is done, US4 can be built by a second person in parallel with US1→US2→US3

## Parallel Example: User Story 1

```text
# The four US1 test files, written together before any implementation:
Task: "Create backend/tests/Feature/Http/Middleware/RecordAccessLogTest.php"
Task: "Create backend/tests/Feature/Http/Middleware/CaptureAccessLogActorTest.php"
Task: "Create backend/tests/Unit/Services/AccessLogServiceTest.php"
Task: "Create backend/tests/Unit/Support/AccessLogRedactorTest.php"
```

## Parallel Example: Phase 7 verification

```text
Task: "Measure SC-002 latency delta against real MySQL (quickstart §3)"
Task: "Verify SC-005/SC-005a/SC-005b upload and truncation sizes (quickstart §6)"
Task: "Verify SC-006 degradation with mysql stopped (quickstart §7)"
Task: "Verify SC-008/SC-011 query plans over 1M rows (quickstart §9)"
Task: "Verify SC-009/SC-010 boundaries (quickstart §10)"
Task: "Verify FR-029 deleted-account behaviour (quickstart §11)"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup (T001–T002)
2. Phase 2: Foundational (T003–T004) — **blocks everything**
3. Phase 3: User Story 1 (T005–T014)
4. **STOP and VALIDATE**: quickstart §2 — every request present exactly once, both address
   fields distinct
5. The history now exists and answers SC-001. It is **not yet safe to keep** — do not point it at
   production traffic before US2

### Incremental Delivery

1. Setup + Foundational → the table exists
2. US1 → the history is captured → validate SC-001
3. US2 → the history is safe to keep → **hard gate on shipping**: SC-003 must return zero matches
4. US3 → the operator has a switch → validate SC-004
5. US4 → the history is bounded → validate SC-007
6. Polish → measure SC-002/SC-006/SC-008/SC-011 and pass the CI gates

### Parallel Team Strategy

With two developers, after Phase 2:

- Developer A: US1 → US2 → US3 (one sequential chain through `RecordAccessLog` and the redactor)
- Developer B: US4 (the prune method, the command, the schedule entry, the compose service and
  the runbook — no shared file with A's chain beyond appending one method to `AccessLogService`)

---

## Notes

- **Ship order is not priority order for safety**: US2 is P2 but is a hard gate. US1 alone stores
  passwords in readable form. Do not deploy the MVP checkpoint to production.
- The SQLite test suite cannot exercise the MySQL-only halves of this feature — the prefix indexes
  (T003) and the SC-002/SC-008 measurements. T034 and T037 are the only place those are verified,
  which is why they are tasks and not assumptions.
- `Tests\TestCase` hard-aborts on any database but SQLite `:memory:` — keep `DB_*` out of the test
  path entirely.
- No new Composer or npm dependency is introduced by any task here (Principle I). The
  `ladybug-scheduler` service in T031 is the **existing** `ladybug-php` image with a different
  command, not a new image and not a new dependency.
- Commit after each task or logical group; stop at any checkpoint to validate the story
  independently.
