# Phase 1 Data Model: HTTP Access Log

**Feature**: `023-access-log` | **Date**: 2026-08-14

One new table. No existing table, column, or model changes.

---

## Entity: Access Log Entry → `access_logs`

One row per HTTP request the **application** handled (FR-001). Rows are **write-once**: they
are inserted by `AccessLogService::record()` and are never updated by anything, ever. They
leave the table only via `AccessLogService::prune()` (FR-027) or the `user_id` FK nulling
itself when an account is hard-deleted (FR-029).

The entry carries **no public identifier** — no `hash`, no code. Constitution Principle V
applies to memes, which are addressable; an access-log row is never addressed from outside the
process (FR-028, FR-030), so giving it a public handle would create the very surface the spec
forbids.

### Columns

| Column | Type (MySQL) | Null | Source | Requirement |
|---|---|---|---|---|
| `id` | `bigint unsigned` PK, auto-inc | no | — | internal only, never exposed |
| `created_at` | `timestamp` | no | arrival time, UTC | FR-007 |
| `remote_addr` | `varchar(45)` | no | `$request->server->get('REMOTE_ADDR')` | FR-002(a) |
| `forwarded_for` | `varchar(255)` | no, default `''` | `X-Forwarded-For` **verbatim** | FR-002(b), FR-002a |
| `method` | `varchar(10)` | no | `$request->getMethod()` | FR-003 |
| `path` | `varchar(2048)` | no | `$request->path()` | FR-003 |
| `status` | `smallint unsigned` | no | `$response->getStatusCode()` | FR-010 |
| `duration_us` | `bigint unsigned` | no | microseconds, D3 | FR-009 |
| `response_bytes` | `bigint unsigned` | yes | `Content-Length`, else `strlen(content)` | FR-011 |
| `user_id` | `bigint unsigned` FK → `users.id` | yes | arrival-time account (D2) | FR-008, FR-008a |
| `user_agent` | `varchar(1024)` | yes | `User-Agent` header | FR-011 |
| `referer` | `varchar(2048)` | yes | `Referer` header | FR-011 |
| `query` | `json` | yes | parsed query string, redacted | FR-004 |
| `input` | `json` | yes | form fields or JSON document, redacted | FR-005 |
| `body` | `longtext` | yes | raw body **only** for unparseable content types (D5) | FR-005 |
| `cookies` | `json` | yes | cookie map, redacted | FR-006 |
| `files` | `json` | yes | `[{field, name, mime, size}]`, **never bytes** | FR-017 |

There is deliberately **no** `updated_at`: nothing updates an entry, and a column implying
otherwise would invite it.

### Field notes

- **`created_at` is the moment the request *arrived***, not the moment the row was written —
  it is captured in the recorder's before-phase alongside the timer (D3). Ordering the history
  by it therefore orders requests by arrival, which is what an operator reconstructing an
  incident expects. Stored in UTC, consistent with the rest of the site (`config('app.timezone')
  = 'UTC'`).
- **`remote_addr` is never empty**, and `varchar(45)` is the IPv6 textual maximum
  (`0000:…:255.255.255.255`).
- **`forwarded_for` defaults to the empty string, not `NULL`.** SC-001 asks for "entries whose
  request carried none have that field empty", and an empty string states "the header was
  absent" without the three-valued-logic trap `NULL` brings to `WHERE forwarded_for <> …`
  queries. It is stored raw and unparsed — a multi-hop chain (`a, b, c`) is kept whole.
- **`path` excludes the query string** (Laravel's `path()`), which lives in `query`. Storing
  the query twice would double the redaction surface for no gain.
- **`status` is always present** because the recorder only ever sees a real `Response`
  (research D1); there is no "request that produced no status" case to model.
- **`duration_us` is an integer count of microseconds**, not a float or a decimal — FR-009 asks
  for sub-millisecond resolution and integers sort, sum, and range-query without rounding.
- **`response_bytes` is nullable on purpose**: a `StreamedResponse` or `BinaryFileResponse` has
  no content string and may carry no `Content-Length`. `NULL` means "not measurable", which is
  honest; `0` would be a lie.
- **`user_id` is nullable and `nullOnDelete`** — this is the whole of FR-029. Deleting an
  account (013 hard-deletes users) clears the reference on its entries instead of deleting them
  or blocking the deletion, exactly as `trashposts.user_id` and `comments.user_id` already
  behave. It is `NULL` for anonymous traffic, and — per FR-008b — also for sign-in,
  registration, and recovery-link reset requests, which arrive anonymous however they end.
- **The four JSON columns are `NULL` when there was nothing to record**, not `{}`. An absent
  cookie header and an empty cookie jar are the same thing to an operator, and `NULL` keeps the
  row smaller.
- **`body` is `longtext`, not `text`.** The default per-value cap is 65536 bytes and `TEXT`
  holds 65535, so a truncated-at-the-limit value plus its ` …[truncated]` marker would overflow
  `TEXT` by design. `longtext` also keeps a raised `ACCESS_LOG_VALUE_LIMIT` from silently
  corrupting writes.

### Validation and shaping rules

Applied by `AccessLogRedactor` before the model is touched — none of this is Eloquent
validation, because the row is machine-built and never user-submitted:

1. **Redaction** (FR-013–FR-016): any key whose lower-cased name is in
   `config('access_log.sensitive')`, or starts with an entry of
   `config('access_log.sensitive_prefixes')`, has its value replaced by the literal
   `[redacted]`. Applied to `query`, `input` and `cookies` at every nesting depth. See
   [contracts/redaction.md](./contracts/redaction.md).
2. **UTF-8 coercion** (FR-019): every string is passed through
   `mb_convert_encoding($v, 'UTF-8', 'UTF-8')` so `json_encode` can never fail and no row is
   lost to a binary payload.
3. **Per-value truncation** (FR-018, FR-018a): each value is independently capped at
   `config('access_log.value_limit')` bytes, cut on a character boundary, with the 15-byte
   ` …[truncated]` marker appended. Runs *after* redaction, so a placeholder is never truncated.
   The marker is appended **beyond** the cap, so a marked value occupies up to
   `value_limit + 15` bytes — see [contracts/redaction.md](./contracts/redaction.md) →
   Truncation marker for why that is the only reading SC-005a admits, and the `body` note below
   for the schema consequence.
4. **Column-width capping, marker included** (FR-018): `user_agent`, `referer`, `path` and
   `forwarded_for` are additionally capped at their **column** widths by the same helper, and a
   column-width cut is marked, never silent. Here the marker must be cut *out of* the budget
   rather than added to it: the value is trimmed to `columnWidth − 15` bytes before the marker
   is appended, so the stored string lands exactly at the column width. Doing it the other way
   — cap at 2048, then append — produces 2063 bytes for `path`, and `config/database.php` sets
   `'strict' => true`, so MySQL rejects the over-long value and the **entire row is lost** to a
   `QueryException` that `record()` correctly swallows (FR-025). A truncation rule that silently
   destroys the entry it was shaping is the one failure mode this step must not have; it is
   asserted in `AccessLogRedactorTest` against each of the four columns at exactly its width.
   (MySQL counts a `varchar(n)` in *characters*, not bytes, so cutting to `n − 15` **bytes** is
   safe by being strictly more conservative than the column requires. Either measure works;
   mixing them per column is what would not.)
5. **Files** (FR-017): `$request->allFiles()` is flattened to
   `{field, name, mime, size}` per file. The uploaded bytes are never read.
6. **Order matters and is fixed**: redact → coerce → truncate. Any other order either
   truncates a secret into a partial secret or cuts a byte sequence into an invalid one.

### Indexes

| Index | Purpose | Criterion |
|---|---|---|
| `(created_at, id)` | newest-first paging | SC-011, FR-031 |
| `(remote_addr, created_at)` | "every request from this address in the last hour" | SC-008, FR-012 |
| `(forwarded_for(64), created_at)` *(prefix on MySQL)* | the same question asked of the claimed address | SC-008, FR-012 |
| `(user_id, created_at)` | "every request by this account today" | SC-008, FR-012 |
| `(status, created_at)` | "every request that returned a server error yesterday" | SC-008, FR-012 |
| `(path(191), created_at)` *(prefix on MySQL)* | filter by endpoint | SC-011, FR-031 |

Each composite leads with the filter column and trails `created_at`, so the time-range half of
every SC-008 question is answered by the index rather than by a filesort.

**MySQL / SQLite split.** `varchar(2048)` under `utf8mb4` is 8192 bytes, well past InnoDB's
3072-byte index key limit, so `path` and `forwarded_for` can only carry **prefix** indexes on
MySQL. SQLite has no such limit and no prefix syntax. The migration branches on
`Schema::getConnection()->getDriverName() === 'mysql'` — issuing the prefixed indexes as raw
`CREATE INDEX` statements there and plain `$table->index([...])` on SQLite — exactly the
pattern `2026_07_23_000000_create_comments_table.php` already uses for its `utf8mb4_bin`
collation and `useCurrentOnUpdate`. Shortening `path` to fit a whole index was rejected: the
path is the most-read field in the history and must not be lossy.

**Write cost, acknowledged.** Six indexes is the dominant term in the SC-002 latency budget,
and it is the deliberate trade FR-031 demands — pay at write time so a viewer that does not
exist yet needs no new column and no backfill. This is why SC-002 must be *measured* against
real MySQL (FR-001b) rather than assumed; [quickstart.md](./quickstart.md) scripts that
measurement.

### State transitions

None. An entry is inserted once and never changes. The only lifecycle event is deletion by the
retention routine (FR-027), which selects purely on `created_at < now() - retention_days`.

---

## Entity: Account → `users` (existing, unchanged)

Referenced by `access_logs.user_id`. **No column is added and no model is edited.** The
relationship is optional (anonymous traffic has none) and non-blocking: the FK is
`nullOnDelete`, so deleting an account neither cascades to its entries nor is prevented by
them (FR-029).

`AccessLog` declares a `user()` `belongsTo` relation for the convenience of a future viewer
(FR-031). Nothing in this feature loads it — the recorder writes a raw id and never
touches the `users` table, which keeps the critical-path write to a single INSERT.

---

## Entity: Sensitive Field List → `config/access_log.php`

Not a table — a configuration array, and the single place FR-015's rule is defined. It is data,
not code, so an operator can extend it for their own deployment without a code change, and so
that the redactor has exactly one source. Its default contents and the reason each entry is on
it are in [contracts/redaction.md](./contracts/redaction.md).

---

## Volume and retention

| Quantity | Value | Source |
|---|---|---|
| Typical row | ~1–2 KB (short paths, small JSON maps, most requests carrying no body) | observed request shapes |
| Worst-case row | value count × `ACCESS_LOG_VALUE_LIMIT` | FR-018b — stated, not hidden |
| Retention | 30 days, configurable | FR-023 |
| Prune cadence | daily, `0 3 * * *`, configurable, enabled by default | FR-027a |
| Sizing target | 1,000,000 rows still answering SC-008/SC-011 in <5 s | SC-008, SC-011 |

FR-018b's consequence is the one an operator must plan against: a pathological request carrying
many large values yields a correspondingly large row, because no value is ever shortened to
make room for another. Storage planning is done against observed traffic, not against the
limit. This note belongs in `docs/DEPLOYMENT.md` as well as here.
