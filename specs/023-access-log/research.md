# Phase 0 Research: HTTP Access Log

**Feature**: `023-access-log` | **Date**: 2026-08-14

The spec arrived with its five clarifications already resolved, so no `NEEDS CLARIFICATION`
markers were carried into Technical Context. What follows are the thirteen design decisions
the plan depends on, each investigated against this repository's actual code rather than
against Laravel in the abstract.

---

## D1 — Where the recorder runs in the middleware stack

**Decision**: `RecordAccessLog` is registered with `$middleware->prepend(...)` in
`bootstrap/app.php`, making it the **outermost frame of the global stack** — ahead of
`TrustProxies`, `HandleCors`, `PreventRequestsDuringMaintenance`, `ValidatePostSize`,
`TrimStrings` and `ConvertEmptyStringsToNull`. It records in its after-phase, after
`$next($request)` returns and before the response leaves the pipeline.

**Rationale**:

- FR-001 demands an entry for requests a guard rejected. Route middleware (`throttle`,
  `verified`) and the group middleware this repo appends (`EnsureAccountEnabled`, which
  answers `401` for a disabled account) all run *inside* the global stack, so an outermost
  frame sees their responses; anything registered in the `api` group after them does not.
- FR-001's "server error" case works because the kernel pipes through
  `Illuminate\Routing\Pipeline`, whose `handleException` renders a thrown `Throwable` into a
  response **while unwinding the pipeline**. The after-phase of an outer middleware therefore
  receives the real `500`, not an exception. This is why "record on the way out" does not
  need a `try/finally` around `$next`.
- FR-001a — "durably stored before the response is delivered" — is satisfied by construction:
  a middleware's after-phase runs before `Response::send()`. No queue, no `terminate()` hook
  (terminable middleware runs *after* the response is flushed, which would break FR-001a and
  SC-002a outright).
- Being ahead of `TrimStrings`/`ConvertEmptyStringsToNull` is irrelevant in practice, because
  the recorder reads input on the way *out*, by which point those have already mutated the
  request instance in place. Noted so nobody expects untrimmed values in the history.

**Alternatives considered**: terminable middleware (`terminate()`) — rejected, it runs after
delivery and directly contradicts FR-001a/SC-002a. An event listener on
`RequestHandled` — rejected, it fires only for requests that reach the router, missing the
maintenance/post-size/CORS rejections. Appending to the `api` group — rejected, it never sees
a rejection issued by a middleware ahead of it.

---

## D2 — Establishing the account "as of the moment the request arrived"

**Decision**: A second, deliberately trivial middleware, `CaptureAccessLogActor`, is appended to
both the `api` and `web` groups. In the `api` group it must be appended **before** the existing
`EnsureAccountEnabled` line in `bootstrap/app.php` (append order in that file is the order in the
group). The `web` group has no such anchor — `EnsureAccountEnabled` is appended to `api` only
(`bootstrap/app.php:51`) — so there the requirement is simply that it be *appended*, which puts
it after Laravel's stock `StartSession` and is all it needs. It does one thing:

```
$request->attributes->set('access_log.user_id', $request->user()?->getAuthIdentifier());
```

`RecordAccessLog` reads that attribute in its after-phase and records `null` when it is
absent.

**Rationale**: At D1's depth the session has not been started (Sanctum's
`EnsureFrontendRequestsAreStateful` injects the `web` group — `StartSession` included — from
inside the `api` group), so no account is resolvable on the way in. Resolving it on the way
out returns the *end* state, which for `POST /api/login`, `POST /api/register` and the
recovery-link reset is an account that did not exist on the request as it arrived — precisely
the attribution FR-008b forbids. Stashing at the first point where the session is live gives
the arrival-time answer with one uniform rule and no per-endpoint special case (FR-008a).
Placing it ahead of `EnsureAccountEnabled` means a disabled account's `401` is still
attributed to that account, which is exactly the row an operator investigating a disabled
account wants.

Both middleware share the same `Request` object throughout the pipeline, so the attribute set
inside the group is visible to the outer frame — `attributes` is Symfony's own per-request
bag and survives the whole pipeline.

**Consequence to accept**: a request rejected *before* the group runs (maintenance mode, a
post-size rejection) records no account even if it carried a valid session cookie. That is a
rare, non-authenticated-by-the-framework case and is the correct conservative answer — the
application never established who the visitor was.

**Alternatives considered**: decoding the session cookie in the outer middleware — rejected,
it re-implements `StartSession` and the encrypter for no gain and would break under
`SESSION_ENCRYPT`. Comparing before/after auth state — rejected, unreliable and unreadable.

---

## D3 — Measuring elapsed time

**Decision**: `microtime(true)` captured in `RecordAccessLog`'s before-phase; the duration is
stored as an integer count of **microseconds**.

**Rationale**: FR-009 asks for sub-millisecond resolution; microseconds as an unsigned integer
sort and range-query cleanly and avoid float rounding in SQL. Measuring from the outermost
middleware measures the time the application spent producing the response, which is what
FR-009 asks for and what the assumption in the spec's Placement note describes.

`LARAVEL_START` (from `public/index.php`) would additionally include framework boot, but it is
a **process-global constant**: under the PHPUnit kernel, where many requests run in one
process, every request after the first would report a duration measured from process start.
A metric that is wrong in exactly the environment where it is asserted is worse than one that
excludes ~1 ms of boot, so the simple entry timestamp wins. Same reasoning rules out
`$request->server('REQUEST_TIME_FLOAT')`.

---

## D4 — The two address fields

**Decision**: `remote_addr` ← `$request->server->get('REMOTE_ADDR')`; `forwarded_for` ←
`$request->headers->get('X-Forwarded-For')` stored verbatim, unparsed, empty string when
absent. Neither is derived from the other.

**Rationale**: This repo sets `$middleware->trustProxies(at: '*')` (production binds to
loopback behind the host's own edge nginx). That makes `$request->ip()` return the
**forwarded** client address — so `ip()` is precisely the wrong call for FR-002(a), which
demands an address "derived from the connection itself and never from a request header, and
therefore not forgeable". `REMOTE_ADDR` in the server bag is untouched by `TrustProxies` and
remains the true peer: the nginx container in production, the real client in a direct dev
request. Storing the raw header alongside it satisfies FR-002(b) and FR-002a — the claim is
kept as evidence and is never consulted for a decision.

A forged `X-Forwarded-For` from a direct client therefore lands in `forwarded_for` with the
real peer in `remote_addr`, which is the edge case the spec calls out explicitly.

**Alternatives considered**: parsing the header's left-most entry into a single "client ip"
column — rejected by the clarification session (record both, let the operator judge), and it
would silently promote a forgeable value to fact.

---

## D5 — What is recorded from the body, and what is not

**Decision**: four separate JSON columns, never a raw dump of everything:

| Column | Source | Notes |
|---|---|---|
| `query` | `$request->query()` | the parsed query string |
| `input` | `$request->isJson() ? $request->json()->all() : $request->post()` | form fields or the JSON document |
| `body` | `$request->getContent()` — **only** when the content type is neither form-encoded, multipart, nor JSON | otherwise `null` |
| `files` | `$request->allFiles()` → `{field, name, mime, size}` per file | never any bytes (FR-017) |

All four pass through `AccessLogRedactor` (D6–D8) before storage.

**Rationale**: FR-005 asks for "the submitted form parameters and the request body", and
**FR-005a is the requirement-level statement of the carve-out this decision implements** — it was
added to the spec so the rule is normative rather than living only here. A **raw body stored next
to the parsed map defeats the whole of US2**: for `POST /api/login` the
raw body literally contains `password=hunter2`, and name-based redaction cannot reach inside
an opaque string. SC-003 ("a search of the entire history for the passwords used returns zero
matches") is therefore only satisfiable if the raw body is not stored for parseable content
types — where it is, by definition, fully represented by the redacted parsed map anyway. For
multipart, the raw body is the uploaded file, which FR-017 forbids outright and SC-005 measures.
For an unparseable type (`text/xml`, `application/octet-stream` with a text payload) the parsed
map is empty, so the raw body is the only record there is — it is stored, truncated and
UTF-8-coerced.

Repeated and nested parameter names (the spec's edge case) are preserved for free: Laravel's
parameter bags already hold `a[]=1&a[]=2` as an array, and the redactor recurses into arrays
by key, so the recorded structure mirrors what was actually submitted.

---

## D6 — Redaction: one name list, applied everywhere

**Decision**: a single `config('access_log.sensitive')` list of lower-cased names, plus a short
`sensitive_prefixes` list, applied identically to `query`, `input`, `body`-adjacent maps and
`cookies`, at every nesting depth, replacing the value with the literal string `[redacted]`.
The full default list and its per-entry justification live in
[contracts/redaction.md](./contracts/redaction.md).

**Rationale**: FR-015 requires one list so a rule "cannot be enforced in one place and
forgotten in another" — the same argument `App\Support\PasswordPolicy` won in 022, and the same
shape: one named constant/config consumed by every call site. Matching is case-insensitive on
the key name only; FR-016 keeps everything else in full, so a meme title, a comment body and a
feed cursor all survive.

The list must cover this codebase's actual secrets, not a generic template: `password` /
`password_confirmation` / `current_password` (007, 022), `token` / `_token` / `remember_token`,
the Google OAuth `code` and `state` (017), and `signature` — the signed-URL parameter on 008's
verification links, which is a one-time link token in FR-013's sense. Cookies add the resolved
`config('session.cookie')`, `XSRF-TOKEN`, `config('remember.cookie')`, and the
`remember_web_` prefix Laravel's recaller uses.

022's recovery token needs no rule at all and gets one anyway by name: it rides the URL
**fragment**, which browsers never transmit, so it cannot reach the server to be logged. That
property is now load-bearing for this feature too and is worth restating where the list is
documented.

**Alternatives considered**: content-based secret detection (entropy heuristics on values) —
rejected by the spec's own assumption, and it would both miss weak passwords and shred
legitimate high-entropy content like a meme hash.

---

## D7 — Per-value truncation

**Decision**: each recorded value is capped independently at `config('access_log.value_limit')`
bytes (default 65536). A value over the cap is cut on a UTF-8 character boundary at or below
the limit and the constant suffix ` …[truncated]` is appended. There is no per-entry ceiling.

**Rationale**: this is the clarified reading of FR-018/FR-018a and what SC-005a measures — the
copy is the limit's worth, marked, while its neighbours in the same request stay whole and
unmarked. Truncation runs **after** redaction so a redacted placeholder is never itself
truncated, and so a giant password field costs one short placeholder rather than 64 KB.

FR-018b's consequence (worst-case entry size = value count × limit) is real and is carried into
`docs/DEPLOYMENT.md` and `.env.example` rather than being silently absorbed, because it is the
number an operator sizing storage needs.

---

## D8 — Byte sequences that are not valid text

**Decision**: every recorded string is coerced with
`mb_convert_encoding($value, 'UTF-8', 'UTF-8')` before it reaches the model, replacing invalid
sequences. Non-string scalars (int, float, bool, null) are preserved as-is. Coercion runs
before truncation so the byte cut cannot itself create an invalid sequence.

**Rationale**: FR-019 requires that binary content cannot prevent a write. The concrete failure
it is guarding against: the columns are JSON (D9), Eloquent's `array` cast calls `json_encode`,
and `json_encode` **returns `false` on malformed UTF-8** — which would surface as an empty or
failed write for the whole row. Coercing at the boundary means the entry is always writable and
always readable. `JSON_INVALID_UTF8_SUBSTITUTE` would fix the encode but not the truncation or
the plain string columns, so the coercion is done once, uniformly, in the redactor.

---

## D9 — Storage shape

**Decision**: one table, `access_logs`, written through an `AccessLog` Eloquent model with
`array` casts on the JSON columns and **no `$fillable`** — the service assigns properties
explicitly. Rows are write-once: nothing in the codebase updates an entry after insert. Full
column list, types and the MySQL/SQLite split are in [data-model.md](./data-model.md).

**Rationale**: FR-012 requires durability in "the site's existing database", and Constitution
Technology Constraints require Eloquent/parameterized access. `$table->json()` maps to MySQL's
native `JSON` type and degrades to `text` on SQLite, so the same migration serves runtime and
the `:memory:` test database — the pattern the `comments` migration already established for
MySQL-only features (`utf8mb4_bin`, `useCurrentOnUpdate`).

Table name is the Eloquent plural `access_logs`, matching `trashposts` / `comments` / `users`,
even though the spec's prose says "access_log".

---

## D10 — Indexes, and the awkward `path` column

**Decision**: six indexes — four plain composites `(created_at, id)`, `(remote_addr, created_at)`,
`(user_id, created_at)` and `(status, created_at)`, plus two that are **prefix-limited on MySQL
only**: `(path(191), created_at)` and `(forwarded_for(64), created_at)`. `path` is
`string(2048)`.

**Rationale**: SC-008 and SC-011 name exactly the query set — newest-first paging, and filtering
by time range, either address field, path, account, or response code, each under 5 s over
1,000,000 rows. Leading the composite indexes with the filter column and trailing `created_at`
serves "…in the last hour / today / yesterday" without a filesort. FR-031's promise that a
future viewer needs "no new columns, no backfill, no re-shaping" is only credible if those
indexes ship now, so they do.

The `path` complication: a `varchar(2048)` under `utf8mb4` exceeds InnoDB's 3072-byte index
key limit, so it cannot be indexed whole on MySQL; SQLite has no such limit. The migration
branches on `Schema::getConnection()->getDriverName()` exactly as the `comments` migration does,
using a raw prefix index on MySQL and a plain index on SQLite. Truncating `path` to 191
characters instead was rejected — the path is the single most-read field in the history and
must not be lossy.

**Cost accepted**: six indexes on a write-heavy table is the dominant term in the SC-002
budget. This is the deliberate trade FR-031 asks for (pay at write time so the un-built viewer
is fast), and it is why SC-002 must be *measured* against real MySQL (FR-001b), which
[quickstart.md](./quickstart.md) scripts.

---

## D11 — Containing a failed write

**Decision**: `AccessLogService::record()` wraps everything in `try { … } catch (Throwable $e)
{ report($e); }` and returns void. The middleware ignores the outcome and returns the response
it already holds, untouched.

**Rationale**: FR-025 requires that a write failure never alters, delays or fails the visitor's
request, and that it surfaces "through the application's existing error reporting" — which in
this app is `report()` into `laravel.log`. Catching `Throwable` (not `Exception`) matters: the
spec's edge case "the table is missing before its migration has run" arrives as a
`QueryException`, but a misconfigured connection can surface as an `Error`. This also covers
the deploy window where the image is live and `migrate` has not finished.

`report()` is not `Log::error()` by accident — it routes through the app's configured handler,
respects `LOG_LEVEL`, and is what the rest of this codebase uses.

---

## D12 — Bounding the write (FR-025a)

**Decision**: add `PDO::ATTR_TIMEOUT => (int) env('DB_CONNECT_TIMEOUT', 2)` to the `mysql`
connection's `options` in `config/database.php`. The row insert stays on the **default**
connection.

**One placement detail that is easy to get wrong**: that `options` value is currently
`extension_loaded('pdo_mysql') ? array_filter([...]) : []`. The new entry belongs **outside** the
`array_filter(...)` call — `array_filter` with no callback drops falsy values, so an explicit
`DB_CONNECT_TIMEOUT=0` placed inside it would be silently discarded and the bound would quietly
revert to PDO's default rather than to the "no bound" the operator asked for. Keeping it outside
makes `0` mean what PDO says it means.

**Rationale and its honest limit**: PDO's timeout attribute is a *connection* option, not a
statement option — it cannot be scoped to one query. Two shapes were possible:

1. A dedicated `access_log` connection carrying its own tight timeout. Clean isolation, but it
   opens a **second TCP connect + auth handshake on every logged request**, on the critical
   path, against an SC-002 budget of 5 ms median. Rejected: it spends the budget it is meant to
   protect.
2. The shared connection with a bounded connect timeout. One handshake, and the bound helps the
   whole application — which today has *no* connect timeout at all, i.e. an unreachable MySQL
   can hang a request until the PHP-FPM request timeout.

Choice 2 is taken. What it genuinely bounds is the spec's main case, a store that is **down or
unreachable**: connect fails in ≤2 s, `record()` catches, the response goes out (FR-025). What
it does **not** bound is a store that accepts the connection and then stalls mid-statement —
PDO's MySQL driver exposes no read timeout, and MySQL's `max_execution_time` applies only to
read-only `SELECT`s, never to an `INSERT`. The mitigating argument, stated rather than hidden:
the write is a single-row `INSERT` into an append-only table with no unique key besides the
primary and no foreign-key contention on the hot path, so there is no realistic lock-wait for
it to stall on; a store slow enough to stall it is slow enough that the request's own queries
already have.

SC-006's "no request exceeds its normal completion time by more than the write's bound" is
therefore measured against `DB_CONNECT_TIMEOUT`, and that is the number documented in the env
files.

---

## D13 — Pruning: one routine, two ways to start it

**Decision**: `AccessLogService::prune(int $days): int` deletes in **chunks of 1000** in a loop
until a pass deletes nothing. `AccessLogPruneCommand` (`php artisan access-log:prune
[--days=]`) is the operator entry point; `routes/console.php` registers
`Schedule::command('access-log:prune')->cron(config('access_log.prune_cron'))` guarded by
`config('access_log.prune_enabled')`. Production gains a `ladybug-scheduler` compose service
running `php artisan schedule:work` off the existing `ladybug-php` image.

**Rationale**: chunked deletion is what makes FR-027's "safe to run while the site is serving
traffic" and FR-027c's "an interrupted run leaves work the next run completes" true — each
chunk commits on its own, so a killed run has simply done less, never left a half-state. Both
entry points call the same method, so FR-027b's "no second deletion rule that could drift" is
structural rather than a promise. Re-running after a clean run deletes zero rows and reports
success (SC-007's idempotence).

The scheduler service is the part that required a real decision. Nothing in this deployment
drives Laravel's scheduler today: `ladybug-php` runs php-fpm as PID 1, and production sets
`QUEUE_CONNECTION=sync` with an explicit comment that there is no worker to run. Without a
process calling `schedule:run` every minute, the registration is inert and FR-027a's "prunes
without an operator remembering to act" is false on the only deployment that matters. A host
crontab is what FR-027a rules out by name. The lottery-on-request pattern this repo already
uses for session GC (`CollectStaleSessions`) was the tempting reuse and was rejected: it puts
a mass `DELETE` on a visitor's critical path, against the very latency budget this feature is
already spending, and it cannot express "daily at a configurable frequency".

**Alternatives considered for the retention window**: a partitioned table with `DROP PARTITION`
would prune in O(1) instead of O(rows). Rejected — MySQL partitioning is invisible to Eloquent,
unsupported on SQLite (so untestable in this suite), and vastly disproportionate to a history
sized in the low millions.
