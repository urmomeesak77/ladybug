# Quickstart: Validating the HTTP Access Log

**Feature**: `023-access-log` | **Date**: 2026-08-14

How to prove this feature works end to end. Every section maps to a numbered success criterion
in [spec.md](./spec.md) and states the command to run and the outcome to expect. The automated
half runs in CI; the manual half needs a real MySQL, because SC-002 and SC-006 are explicitly
**measured, not assumed** (FR-001b).

Read [contracts/configuration.md](./contracts/configuration.md) for the settings referenced
here and [data-model.md](./data-model.md) for the column names.

---

## Prerequisites

- Docker Desktop running. There is **no local PHP** in this project — everything goes through
  containers (project convention).
- The dev stack up: `docker compose up -d` from the repo root.
- Migrations applied against the dev database. Worth checking explicitly, since a merged
  migration can sit unrun against dev MySQL for a long time undetected:

  ```powershell
  docker compose exec backend php artisan migrate:status
  docker compose exec backend php artisan migrate
  ```

- A shell into the dev database for the read path — this feature ships no viewer (FR-030), so
  direct SQL **is** the read path:

  ```powershell
  docker compose exec mysql mysql -uroot -proot trashdb
  ```

- Backend PHP edits need `docker compose restart backend` (dev opcache runs with
  `validate_timestamps=0`), and the env switch is read at startup, so **every change to
  `ACCESS_LOG_*` requires a restart** before it takes effect.

---

## 1. Automated suite

```powershell
scripts\test-backend.ps1
```

Use the script, not `artisan test`: it mirrors the tree into a container-local volume and runs
there (0:43 vs 5:04 over the Windows bind mount, same tests, same assertion count).

Covers:

| Test | Criteria |
|---|---|
| `tests/Unit/Support/AccessLogRedactorTest.php` | FR-013–019, SC-005a — name matching, nesting, placeholder, per-value truncation and its marker, UTF-8 coercion of binary input |
| `tests/Unit/Services/AccessLogServiceTest.php` | FR-025, FR-027, FR-027c, FR-029 — a write failure is caught and reported, chunked pruning, idempotence, the window override, an interrupted run left resumable, and a deleted account's rows surviving with `user_id` nulled |
| `tests/Feature/Http/Middleware/RecordAccessLogTest.php` | FR-001–012, FR-020–022, FR-026, SC-005b — one row per request across 2xx/3xx/404/500, a body rejected for its size still recorded, both address fields, the switch, excluded paths, an unchanged response |
| `tests/Feature/Http/Middleware/CaptureAccessLogActorTest.php` | FR-008, FR-008a, FR-008b — signed-in requests carry the account, a sign-in carries none |
| `tests/Feature/Console/Commands/AccessLogPruneCommandTest.php` | FR-027, SC-007 — both sides of the window, re-run changes nothing, `schedule:list` shows the entry |

Coverage must stay ≥90% (Constitution Principle VII); the CI Clover gate
(`.github/scripts/check_coverage.py`) enforces it.

**Note on the test database**: the suite runs on SQLite `:memory:` and `Tests\TestCase`
hard-aborts on anything else. The MySQL-only halves of the migration (prefix indexes) are
therefore *not* exercised by unit tests — section 3 below is where they get verified.

---

## 2. SC-001 — every request appears exactly once

With recording on (the default), drive a mixed run against the dev stack: load the feed, sign
in and upload, request a nonexistent meme, and trigger an error path.

```sql
SELECT COUNT(*) FROM access_logs;

SELECT created_at, method, path, status, duration_us, remote_addr, forwarded_for, user_id
FROM access_logs ORDER BY id DESC LIMIT 20;
```

Expect: one row per request; `remote_addr`, `path`, `method`, `created_at`, `status` and
`duration_us` all non-empty on every row; no duplicates; the 404 and the 500 both present with
the status the visitor actually received.

Both address fields, with the forwarded value forged deliberately:

```powershell
curl.exe -H "X-Forwarded-For: 203.0.113.9" http://localhost:8000/api/posts
```

```sql
SELECT remote_addr, forwarded_for FROM access_logs ORDER BY id DESC LIMIT 1;
```

Expect `forwarded_for = '203.0.113.9'` **and** `remote_addr` still the real peer — the forged
value never displaces the observed one (FR-002a). A request sent without the header leaves
`forwarded_for` empty, and the two are never conflated.

---

## 3. SC-002 / SC-002a — the latency budget, measured

This is the criterion that cannot be reasoned about, only measured, and it must be measured
against **real MySQL** with the shipped write path (FR-001b), because six indexes on a
write-heavy table are the dominant cost ([data-model.md](./data-model.md) → Indexes).

1. `ACCESS_LOG_ENABLED=false` in `backend/.env`, `docker compose restart backend`, run the same
   scripted set of ~200 requests, record median and p95.
2. `ACCESS_LOG_ENABLED=true`, restart, repeat.

Expect: median up by ≤5 ms and p95 up by ≤15 ms. If the deltas exceed that, the index set is
the first thing to re-examine, not the redactor.

SC-002a — "the entry is already retrievable at the instant the response is received" — follows
from the write preceding delivery (FR-001a), and is checked by querying for a request's row
immediately after its response returns: zero requests may observe a response whose row has not
landed.

Also verify the MySQL-only schema here, since the test suite cannot:

```sql
SHOW INDEX FROM access_logs;
```

Expect the six indexes from [data-model.md](./data-model.md), with `path` and `forwarded_for`
carrying **prefix** lengths (191 and 64).

---

## 4. SC-003 — no secret comes to rest (the hard gate)

Run a complete authentication journey through the SPA at `http://localhost:5173`: register,
verify, sign in, change the password, request a recovery link, reset the password, sign out.
Use a distinctive password so the search is unambiguous.

```sql
SELECT COUNT(*) FROM access_logs
WHERE query   LIKE '%<the password>%'
   OR input   LIKE '%<the password>%'
   OR body    LIKE '%<the password>%'
   OR cookies LIKE '%<the password>%';

SELECT COUNT(*) FROM access_logs
WHERE cookies LIKE '%<the session cookie value from the browser>%';
```

Expect **0** from both, while the rows for those requests are all present with their paths and
response codes intact:

```sql
SELECT path, status, JSON_EXTRACT(input, '$.email'), JSON_EXTRACT(input, '$.password')
FROM access_logs WHERE path LIKE 'api/%' ORDER BY id DESC LIMIT 10;
```

Expect the submitted `email` in full (FR-016 — it is what identifies the actor on a sign-in row,
per FR-008b) and `password` as the literal `[redacted]` (FR-014).

While here, confirm FR-008b directly: the `api/login` row has `user_id` **NULL** even on a
successful sign-in, and the `api/logout` row names the account that was signed in.

---

## 5. SC-004 — the switch

```powershell
# Absent from .env entirely -> recording is ON (US3 scenario 1)
docker compose restart backend
```

Set `ACCESS_LOG_ENABLED=false`, restart, re-run the scripted set. Expect: zero new rows,
**all previously recorded rows still present** (off stops writing, it does not erase — FR-021),
and responses identical to a run with the feature absent. Turn it back on, restart, confirm
recording resumes.

---

## 6. SC-005 / SC-005a / SC-005b — size behaviour

**Use the site's real ceiling, not an arbitrary large number.** `CreatePostRequest` caps `video`
at `max:20480` (20 MiB) and `image` at `max:10240`, and both `deploy/php/php.ini` and
`docker/php/uploads.ini` set `post_max_size=26M`. A file far above that never reaches the
application's file handling at all — PHP discards the body and `ValidatePostSize` answers `413` —
so it would prove nothing about FR-017. The two sizes test two different criteria and both are
wanted.

**At the ceiling (SC-005).** Upload a ~20 MiB video through `/upload`, then:

```sql
SELECT files, LENGTH(CONCAT_WS('', query, input, body, cookies)) AS approx_bytes
FROM access_logs WHERE path = 'api/posts' ORDER BY id DESC LIMIT 1;
```

Expect exactly one row; `files` holding only `{field, name, mime, size}`; no file bytes
anywhere; the row small (SC-005's 64 KB ceiling for this case) — bounded by *what is recorded*,
not by truncation.

**Past the ceiling (SC-005b).** Send something comfortably over `post_max_size` — a 100 MB file
is the natural choice — and expect a `413`:

```powershell
curl.exe -X POST http://localhost:8000/api/posts -F "video=@huge.mp4"
```

```sql
SELECT path, method, status, input, files FROM access_logs ORDER BY id DESC LIMIT 1;
```

Expect **one** row carrying that `413`, its path and its method, with `input` and `files` empty —
PHP dropped the body before anything could parse it, so there is nothing to record and that is
the correct answer, not a gap. This row exists only because `RecordAccessLog` is prepended ahead
of `ValidatePostSize` (research D1); if it is missing, the middleware is registered in the wrong
place.

**Per-value truncation (SC-005a).** Send one oversized value alongside a small one:

```powershell
curl.exe -X POST http://localhost:8000/api/posts -F "title=short" -F "description=@big.txt"
```

Expect the oversized value cut at the limit and carrying ` …[truncated]`, while `title` is
recorded in full and **unmarked** — that asymmetry is what proves the cap is per value
(FR-018a) and not shared across the entry. (The request itself fails validation; that is
irrelevant here — a `422` is recorded like any other outcome, and its `input` is what we came
for.) Check the arithmetic while here, since the two caps budget the marker in opposite
directions: a value-limit cut lands at `value_limit + 15` bytes, and a column-width cut on
`path`/`forwarded_for`/`user_agent`/`referer` lands at **exactly** the column width. Send a URL
longer than 2048 bytes and confirm the row was written at all — an over-long `path` under
`'strict' => true` is rejected by MySQL and loses the whole entry to a swallowed
`QueryException`, which looks identical to "the request was never recorded".

Binary safety (FR-019): post a body of raw bytes with an unparseable content type and confirm
the row is written and readable rather than lost.

---

## 7. SC-006 — a broken store degrades, never fails

```powershell
docker compose stop mysql
```

Re-run the scripted set. Expect: every request receives its normal response and status code —
no visitor-facing failure because the history could not be written (FR-025) — and each failure
reported once into `storage/logs/laravel.log` via `report()`.

Note the honest limit before testing the slow case: `DB_CONNECT_TIMEOUT` (default 2 s) bounds
**connect**, which is what a stopped container exercises. A store that accepts the connection
and then stalls mid-statement is not bounded from PHP; research D12 records why that residual
risk is accepted. Measure against the connect bound, not against a stall.

```powershell
docker compose start mysql
```

---

## 8. SC-007 — retention

```powershell
docker compose exec backend php artisan access-log:prune
docker compose exec backend php artisan access-log:prune --days=7
docker compose exec backend php artisan schedule:list
```

Seed rows on both sides of the window first (backdate `created_at` directly in SQL). Expect:
100% of rows older than the window gone, 100% of newer rows untouched, a second run changing
nothing and still exiting 0, and `schedule:list` showing `access-log:prune` at `0 3 * * *` on a
deployment where nobody configured it (US4 scenario 4).

Confirm requests are served and recorded normally *during* a run against a large history
(US4 scenario 5) — start the prune, hit the feed while it runs, check both the responses and the
new rows.

Production note: the schedule only fires because `deploy/docker-compose.prod.yml` runs the
`ladybug-scheduler` service. After deploying, verify it is up:

```
docker compose -f docker-compose.prod.yml ps ladybug-scheduler
```

---

## 9. SC-008 / SC-011 — the queries an operator (and a future viewer) will run

Against a history of ~1,000,000 rows, each of these must return in under 5 seconds using only
the shipped columns and indexes — no new column, no backfill (FR-031):

```sql
-- every request from this address in the last hour, asked of either address field
SELECT * FROM access_logs WHERE remote_addr = ? AND created_at >= NOW() - INTERVAL 1 HOUR
ORDER BY created_at DESC;
SELECT * FROM access_logs WHERE forwarded_for = ? AND created_at >= NOW() - INTERVAL 1 HOUR
ORDER BY created_at DESC;

-- every request by this account today
SELECT * FROM access_logs WHERE user_id = ? AND created_at >= CURDATE() ORDER BY created_at DESC;

-- every request that returned a server error yesterday
SELECT * FROM access_logs WHERE status >= 500
  AND created_at >= CURDATE() - INTERVAL 1 DAY AND created_at < CURDATE();

-- newest-first paging, and filtering by endpoint
SELECT * FROM access_logs ORDER BY created_at DESC, id DESC LIMIT 50;
SELECT * FROM access_logs WHERE path = ? ORDER BY created_at DESC LIMIT 50;
```

Check each with `EXPLAIN` and confirm the intended index is chosen and no filesort appears.

---

## 10. SC-009 / SC-010 — the boundaries hold

**Not reachable over HTTP.** This feature adds zero routes. Confirm:

```powershell
git diff --stat master -- backend/routes/
```

Expect no change to `routes/api.php` or `routes/web.php`, and no access-log content in any
response body or header anywhere on the site — public or admin.

**Media and static assets are out of scope** (FR-032). Fetch 50 files under `/storage/` and the
SPA's assets, then:

```sql
SELECT COUNT(*) FROM access_logs WHERE path LIKE 'storage/%';
```

Expect **0** — nginx answers those without involving PHP, so an application-level recorder
cannot see them. This is a designed boundary, not a gap; the env documentation must say so
(FR-032) or an operator will read the history as broken.

**Excluded paths.** Confirm the health probe produced no rows:

```sql
SELECT COUNT(*) FROM access_logs WHERE path IN ('api/health', 'up');
```

Expect **0**.

---

## 11. Deleted accounts (FR-029)

Delete an account that has entries (`DELETE /api/admin/users/{hash}`, the 013 hard delete), then:

```sql
SELECT id, path, user_id FROM access_logs WHERE user_id IS NULL ORDER BY id DESC LIMIT 20;
```

Expect its entries still present with `user_id` now `NULL` — the reference is cleared, the
history is not. Same behaviour as `trashposts.user_id` and `comments.user_id` already have.

---

## Manual verification checklist (Constitution)

The constitution's manual-verification gate covers navigation, theming, layout, upload and the
meme page. This feature touches none of them — it adds no frontend file and changes no response
(FR-026). The gate is satisfied by confirming exactly that: run the existing e2e suite and
observe the site behaves identically with recording on and off.

```powershell
docker compose -f docker-compose.e2e.yml up -d
cd frontend; npx playwright test
```
